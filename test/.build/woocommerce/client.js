"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wooGet = wooGet;
exports.totalFrom = totalFrom;
exports.totalPagesFrom = totalPagesFrom;
exports.resolveCurrency = resolveCurrency;
exports.probeCurrency = probeCurrency;
exports.readStoreName = readStoreName;
/**
 * The WooCommerce REST v3 client.
 *
 * Two authentication schemes, because WooCommerce has two: over HTTPS the
 * consumer key and secret go in a Basic header, and over plain HTTP WooCommerce
 * refuses that and requires one-legged OAuth 1.0a with the parameters signed
 * into the query string. Local development (`http://shop.local`) is the reason
 * the OAuth path exists at all — do not delete it and then wonder why the
 * staging shop 401s.
 */
const node_crypto_1 = require("node:crypto");
const agorai_adapter_1 = require("@smartitory/agorai-adapter");
const config_1 = require("./config");
const DEFAULT_TIMEOUT_MS = 15_000;
/** The shop's own currency changes about never, so one lookup an hour is plenty. */
const CURRENCY_TTL_MS = 60 * 60 * 1000;
/**
 * ISO-4217 of last resort, used only when the shop's currency cannot be read
 * and no override is configured. Wrong is better than absent here: a price with
 * no currency renders as a bare number, which a shopper will read as their own.
 */
const FALLBACK_CURRENCY = 'EUR';
const currencyCache = new Map();
/**
 * One GET against `/wp-json/wc/v3/{path}`.
 *
 * Every failure becomes a typed `AdapterError`, because the platform reacts to
 * the code: `UNAUTHORIZED` puts a "check your credentials" banner on the Store
 * screen, `RATE_LIMITED` backs off, `UPSTREAM_UNAVAILABLE` degrades the chat
 * instead of failing it.
 */
async function wooGet(ctx, path, query = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const auth = (0, config_1.credentials)(ctx);
    const url = buildUrl(auth, path, query);
    let response;
    try {
        response = await fetch(url, {
            headers: { Accept: 'application/json', ...basicAuthHeader(auth) },
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (error) {
        // The URL is deliberately absent from this message: in OAuth mode it
        // carries the consumer key, and this string ends up in the platform's logs.
        throw new agorai_adapter_1.AdapterUpstreamError('The WooCommerce store did not respond.', `GET wc/v3/${path}: ${error.message}`);
    }
    if (!response.ok)
        throw await toAdapterError(response, path);
    return { body: (await response.json()), headers: response.headers };
}
/** Total row count from WooCommerce's pagination headers, or null when absent. */
function totalFrom(headers) {
    const raw = headers.get('x-wp-total');
    if (!raw)
        return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
}
function totalPagesFrom(headers) {
    const raw = headers.get('x-wp-totalpages');
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(value) ? value : 1;
}
/**
 * The shop's currency, which WooCommerce does not put on a product.
 *
 * Cached per store rather than per request: the adapter stays stateless in the
 * sense that matters — nothing here changes an answer, it only avoids one extra
 * round trip per product page during a full catalogue sync.
 */
async function resolveCurrency(ctx) {
    const override = (0, config_1.setting)(ctx, 'WOOCOMMERCE_CURRENCY');
    if (override.length > 0)
        return override.toUpperCase();
    const { baseUrl } = (0, config_1.credentials)(ctx);
    const cached = currencyCache.get(baseUrl);
    if (cached && Date.now() - cached.readAt < CURRENCY_TTL_MS) {
        return cached.code;
    }
    const code = await readCurrency(ctx);
    currencyCache.set(baseUrl, { code, readAt: Date.now() });
    return code;
}
/** The same lookup, but reporting failure — the health check wants to warn. */
async function probeCurrency(ctx) {
    const override = (0, config_1.setting)(ctx, 'WOOCOMMERCE_CURRENCY');
    if (override.length > 0) {
        return { code: override.toUpperCase(), detected: true };
    }
    try {
        const { body } = await wooGet(ctx, 'data/currencies/current');
        return { code: body.code.toUpperCase(), detected: true };
    }
    catch {
        return { code: FALLBACK_CURRENCY, detected: false };
    }
}
/** The shop's display name, from the unauthenticated WordPress API root. */
async function readStoreName(ctx) {
    const { baseUrl } = (0, config_1.credentials)(ctx);
    try {
        const response = await fetch(`${baseUrl}/wp-json`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok)
            return null;
        const body = (await response.json());
        return body.name ?? null;
    }
    catch {
        return null;
    }
}
async function readCurrency(ctx) {
    const probe = await probeCurrency(ctx);
    return probe.code;
}
async function toAdapterError(response, path) {
    const detail = await response
        .text()
        .then((text) => `GET wc/v3/${path}: ${text.slice(0, 300)}`)
        .catch(() => `GET wc/v3/${path}`);
    switch (response.status) {
        case 401:
        case 403: {
            return new agorai_adapter_1.AdapterUnauthorizedError('WooCommerce rejected the configured consumer key or secret.');
        }
        case 404: {
            return new agorai_adapter_1.AdapterNotFoundError(`WooCommerce has no ${path}.`);
        }
        case 429: {
            const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
            return new agorai_adapter_1.AdapterRateLimitedError('WooCommerce is rate limiting this adapter.', Number.isFinite(retryAfter) ? retryAfter : undefined);
        }
        default: {
            return new agorai_adapter_1.AdapterUpstreamError(`WooCommerce answered ${response.status}.`, detail);
        }
    }
}
function buildUrl(auth, path, query) {
    const endpoint = `${auth.baseUrl}/wp-json/wc/v3/${path}`;
    const parameters = {};
    for (const [key, value] of Object.entries(query)) {
        parameters[key] = String(value);
    }
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, value);
    }
    if (!isSecure(auth)) {
        const oauth = signOAuth('GET', endpoint, parameters, auth);
        for (const [key, value] of Object.entries(oauth)) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}
function isSecure(auth) {
    return auth.baseUrl.startsWith('https://');
}
function basicAuthHeader(auth) {
    if (!isSecure(auth))
        return {};
    const token = Buffer.from(`${auth.consumerKey}:${auth.consumerSecret}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}
/**
 * One-legged OAuth 1.0a, as WooCommerce implements it for non-HTTPS shops:
 * no token, no token secret, and the signing key is `${consumerSecret}&`.
 */
function signOAuth(method, endpoint, parameters, auth) {
    const oauth = {
        oauth_consumer_key: auth.consumerKey,
        oauth_nonce: (0, node_crypto_1.randomBytes)(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA256',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const all = { ...parameters, ...oauth };
    const parameterString = Object.keys(all)
        .sort()
        .map((key) => `${rfc3986(key)}=${rfc3986(all[key])}`)
        .join('&');
    const baseString = [
        method.toUpperCase(),
        rfc3986(endpoint),
        rfc3986(parameterString),
    ].join('&');
    const signature = (0, node_crypto_1.createHmac)('sha256', `${auth.consumerSecret}&`)
        .update(baseString)
        .digest('base64');
    return { ...oauth, oauth_signature: signature };
}
/**
 * `encodeURIComponent` leaves `!*'()` alone; RFC 3986 does not, and OAuth
 * signatures are byte-exact. A product query containing an apostrophe is enough
 * to break this if the extra characters are missed.
 */
function rfc3986(value) {
    return encodeURIComponent(value).replaceAll(/[!*'()]/g, (character) => `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
}
//# sourceMappingURL=client.js.map