import { createHmac, timingSafeEqual } from 'crypto'

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../contract'

/**
 * Produces the headers `verifySignature` expects.
 *
 * Exported because the caller has to agree byte-for-byte with the verifier, and
 * the platform's adapter client, the testkit and any adapter author writing an
 * integration test all need the same implementation. Two hand-rolled copies of
 * an HMAC scheme diverge; one shared function cannot.
 */
export function signRequest(
  body: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Record<string, string> {
  const timestamp = String(nowSeconds)
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body, 'utf8')
    .digest('hex')

  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: timestamp,
  }
}

/**
 * The other half, and the reason it lives beside the signer rather than inside
 * the guard.
 *
 * Traffic runs in **both** directions: the platform signs its calls to an
 * adapter, and an adapter signs the reindex webhook it calls back with. Two
 * codebases each writing "an HMAC of the timestamp and the body" is precisely
 * how the two stop agreeing — over an encoding, a separator, or a
 * `timingSafeEqual` on buffers of different length, which throws rather than
 * returning false.
 *
 * The signature covers `${timestamp}.${rawBody}` rather than the body alone, so
 * a captured request cannot be replayed later: the timestamp is inside the
 * signed material, and anything outside the window is refused.
 *
 * `raw` must be the **exact bytes received**. Re-serialising a parsed body
 * changes key order and whitespace, and every signature then fails.
 */
export function verifySignature(input: {
  raw: Buffer | string
  signature: string | undefined
  timestamp: string | undefined
  secret: string
  toleranceSeconds: number
  nowSeconds?: number
}): { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' } {
  const { signature, timestamp } = input
  if (!signature || !timestamp) return { ok: false, reason: 'missing' }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'missing' }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - sentAt) > input.toleranceSeconds) {
    return { ok: false, reason: 'stale' }
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.`)
    .update(input.raw)
    .digest('hex')

  const provided = Buffer.from(signature)
  const computed = Buffer.from(expected)
  // `timingSafeEqual` throws on a length mismatch rather than returning false,
  // so the lengths are compared first — and comparing them leaks nothing a
  // caller does not already know, since a hex SHA-256 is always 64 characters.
  if (provided.length !== computed.length) {
    return { ok: false, reason: 'mismatch' }
  }
  return timingSafeEqual(provided, computed)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' }
}

/** Reads the two signature headers, tolerating the array form Node uses. */
export function signatureHeaders(headers: Record<string, unknown>): {
  signature: string | undefined
  timestamp: string | undefined
} {
  return {
    signature: single(headers[SIGNATURE_HEADER]),
    timestamp: single(headers[TIMESTAMP_HEADER]),
  }
}

function single(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined
  }
  return typeof value === 'string' ? value : undefined
}
