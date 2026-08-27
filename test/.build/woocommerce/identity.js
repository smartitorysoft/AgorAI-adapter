"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyIdentity = verifyIdentity;
exports.describeFailure = describeFailure;
/**
 * Verifying who the shopper is, from a blob WordPress signed.
 *
 * The storefront never sends a bare user id — an unsigned id in a public
 * request body is a "show me someone else's order history" hole. The mu-plugin
 * signs `${id}|${exp}` with a secret shared with this adapter, and the whole of
 * the check below is why that is worth doing properly:
 *
 *  - expiry, with clock skew allowed, because WordPress and this container do
 *    not share a clock;
 *  - a MAXIMUM lifetime, because a forged token with `exp` ten years out would
 *    otherwise pass the expiry check forever — an attacker controls `exp` and
 *    it is covered by the signature they are trying to forge, so rejecting an
 *    absurd one cheaply narrows the target;
 *  - a constant-time comparison, so the signature cannot be recovered a byte at
 *    a time by timing the response.
 *
 * Every failure returns null rather than throwing. A shopper whose token is old
 * is a guest, and a guest chat is a working chat.
 */
const node_crypto_1 = require("node:crypto");
const CLOCK_SKEW_SECONDS = 300;
/** Longer than the mu-plugin ever issues. Anything beyond it is a forgery. */
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60;
function verifyIdentity(secret, token) {
    const identity = parseToken(token);
    if (!identity)
        return { ok: false, reason: 'malformed' };
    const now = Math.floor(Date.now() / 1000);
    if (identity.exp + CLOCK_SKEW_SECONDS < now) {
        return { ok: false, reason: 'expired' };
    }
    if (identity.exp - now > MAX_TOKEN_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) {
        return { ok: false, reason: 'implausible-lifetime' };
    }
    const expected = (0, node_crypto_1.createHmac)('sha256', secret)
        .update(`${identity.id}|${identity.exp}`)
        .digest('hex');
    const provided = Buffer.from(identity.sig);
    const computed = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, so the length is checked
    // first — and a wrong length is already a wrong signature.
    if (provided.length !== computed.length ||
        !(0, node_crypto_1.timingSafeEqual)(provided, computed)) {
        return { ok: false, reason: 'bad-signature' };
    }
    return { ok: true, customerId: String(identity.id) };
}
/**
 * Two accepted shapes, because the token crosses a boundary the shop controls:
 * the compact `id.exp.sig` the mu-plugin emits, and a raw JSON object for a
 * storefront that would rather build one inline.
 */
function parseToken(token) {
    const trimmed = token.trim();
    if (trimmed.length === 0)
        return null;
    if (trimmed.startsWith('{')) {
        try {
            return toIdentity(JSON.parse(trimmed));
        }
        catch {
            return null;
        }
    }
    const [id, exp, sig] = trimmed.split('.');
    return toIdentity({ id, exp, sig });
}
function toIdentity(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const candidate = raw;
    const id = Number(candidate.id);
    const exp = Number(candidate.exp);
    const sig = typeof candidate.sig === 'string' ? candidate.sig : '';
    if (!Number.isInteger(id) || id <= 0)
        return null;
    if (!Number.isInteger(exp) || exp <= 0)
        return null;
    if (sig.length === 0)
        return null;
    return { id, exp, sig };
}
function describeFailure(reason) {
    switch (reason) {
        case 'malformed': {
            return 'The storefront sent an identity token this adapter cannot parse.';
        }
        case 'expired': {
            return 'The identity token has expired — check clock drift between WordPress and this adapter.';
        }
        case 'implausible-lifetime': {
            return 'The identity token expires further out than the mu-plugin ever issues.';
        }
        case 'bad-signature': {
            return 'Identity signature mismatch — AGORAI_IDENTITY_SECRET in wp-config.php must equal WP_IDENTITY_SECRET here.';
        }
    }
}
//# sourceMappingURL=identity.js.map