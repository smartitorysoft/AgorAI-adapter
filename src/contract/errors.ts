/**
 * Every failure an adapter can report, as a closed set of codes.
 *
 * The platform reacts to the code, not the message: `CONFIG_INVALID` becomes a
 * "connection not configured" banner on the project's Store screen,
 * `SIGNATURE_INVALID` means the shared secret is wrong while `UNAUTHORIZED`
 * means the *store's* credentials are, `UPSTREAM_UNAVAILABLE` is retried and
 * degrades the chat gracefully, and `RATE_LIMITED` backs off. An unrecognised throw becomes `INTERNAL` with its
 * message withheld, so an adapter cannot leak store credentials into a platform
 * log by throwing them.
 */
export type AdapterErrorCode =
  | 'CONFIG_INVALID'
  | 'SIGNATURE_INVALID'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL'

const STATUS_BY_CODE: Record<AdapterErrorCode, number> = {
  CONFIG_INVALID: 422,
  SIGNATURE_INVALID: 401,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  UNSUPPORTED: 501,
  INVALID_REQUEST: 400,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  INTERNAL: 500,
}

export function statusForAdapterError(code: AdapterErrorCode): number {
  return STATUS_BY_CODE[code]
}

export class AdapterError extends Error {
  readonly code: AdapterErrorCode

  /** Safe to show a shop admin. Never include credentials or raw upstream bodies. */
  readonly detail?: string

  constructor(code: AdapterErrorCode, message: string, detail?: string) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.detail = detail
  }
}

/** A required config key is missing or unusable. The most common real failure. */
export class AdapterConfigError extends AdapterError {
  constructor(message: string, detail?: string) {
    super('CONFIG_INVALID', message, detail)
  }
}

/**
 * The *platform* failed to authenticate to this adapter — a bad shared secret,
 * or a replayed request.
 *
 * Deliberately distinct from `UNAUTHORIZED`, which means the *store* rejected
 * the credentials the shop admin typed. The two share an HTTP status and share
 * nothing else: one is fixed by correcting the shared secret on the Store
 * screen, the other by correcting the store's API key. A platform that cannot
 * tell them apart can only say "unauthorized" and leave the admin guessing
 * which of the two fields is wrong.
 */
export class AdapterSignatureError extends AdapterError {
  constructor(message = 'Invalid request signature.') {
    super('SIGNATURE_INVALID', message)
  }
}

/** The store rejected the credentials this project is configured with. */
export class AdapterUnauthorizedError extends AdapterError {
  constructor(message = 'The store rejected the configured credentials.') {
    super('UNAUTHORIZED', message)
  }
}

export class AdapterNotFoundError extends AdapterError {
  constructor(message: string) {
    super('NOT_FOUND', message)
  }
}

/** The adapter does not implement the port or target that was asked for. */
export class AdapterUnsupportedError extends AdapterError {
  constructor(message: string) {
    super('UNSUPPORTED', message)
  }
}

export class AdapterRateLimitedError extends AdapterError {
  /** Seconds the platform should wait before retrying, when the store says so. */
  readonly retryAfterSeconds?: number

  constructor(message: string, retryAfterSeconds?: number) {
    super('RATE_LIMITED', message)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The store is down, timed out, or answered with something unusable. */
export class AdapterUpstreamError extends AdapterError {
  constructor(message: string, detail?: string) {
    super('UPSTREAM_UNAVAILABLE', message, detail)
  }
}

export function isAdapterError(error: unknown): error is AdapterError {
  return error instanceof AdapterError
}
