import { AdapterConfigError } from './errors'

/**
 * Everything an adapter needs to serve one request for one project.
 *
 * This is what makes a single hosted adapter able to serve every WooCommerce
 * store on the platform: the adapter holds no per-store state, and the platform
 * hands it the project's own configuration on every call.
 */
export type StoreContextData = {
  projectId: string
  /**
   * The values the shop admin typed into the project's Store screen, keyed by
   * the adapter's own config schema.
   */
  config: Record<string, string>
  /** BCP-47-ish locale for user-visible strings the adapter may produce. */
  locale: string
  /**
   * Opaque per-visitor token(s) the widget collected from the store — a cart
   * token, a session cookie value, whatever that store uses. The platform never
   * interprets these; it only carries them.
   */
  storeSession?: Record<string, string>
  /** Signed identity blob from the storefront, for `customer.resolveIdentity`. */
  identityToken?: string
  /** Correlates this call with the platform request that caused it. */
  requestId: string
}

/**
 * The `ctx` handed to every port method.
 *
 * The accessors exist so a missing key surfaces as `CONFIG_INVALID` (a red
 * "connection not configured" banner on the project's Store screen) rather than
 * as an `undefined` that fails later as a 500 somewhere inside the store's API
 * client.
 */
export class StoreContext {
  readonly projectId: string

  readonly config: Readonly<Record<string, string>>

  readonly locale: string

  readonly storeSession: Readonly<Record<string, string>>

  readonly identityToken?: string

  readonly requestId: string

  constructor(data: StoreContextData) {
    this.projectId = data.projectId
    this.config = Object.freeze({ ...data.config })
    this.locale = data.locale
    this.storeSession = Object.freeze({ ...data.storeSession })
    this.identityToken = data.identityToken
    this.requestId = data.requestId
  }

  /** A required config value. Throws `AdapterConfigError` when absent. */
  cfg(key: string): string {
    const value = this.config[key]
    if (value === undefined || value.trim().length === 0) {
      throw new AdapterConfigError(
        `Missing required configuration "${key}".`,
        `Set "${key}" on the project's Store screen.`
      )
    }
    return value
  }

  /** An optional config value, with a fallback. */
  cfgOr(key: string, fallback: string): string {
    const value = this.config[key]
    return value === undefined || value.trim().length === 0 ? fallback : value
  }

  /** An optional numeric config value. Non-numeric text is a config error. */
  cfgNumber(key: string, fallback: number): number {
    const raw = this.config[key]
    if (raw === undefined || raw.trim().length === 0) return fallback
    const value = Number(raw)
    if (Number.isNaN(value)) {
      throw new AdapterConfigError(`Configuration "${key}" must be a number.`)
    }
    return value
  }

  cfgBoolean(key: string, fallback = false): boolean {
    const raw = this.config[key]
    if (raw === undefined || raw.trim().length === 0) return fallback
    return raw.toLowerCase() === 'true' || raw === '1'
  }

  /** A token the widget collected from the store, if the store sent one. */
  session(key: string): string | undefined {
    return this.storeSession[key]
  }

  /**
   * The base URL of a store, trailing slash stripped — the single most common
   * thing an adapter reads, and the single most common way to get a doubled
   * slash into an upstream URL.
   */
  baseUrl(key: string): string {
    return this.cfg(key).replace(/\/+$/, '')
  }
}
