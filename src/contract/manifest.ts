import type { ConfigSchema, LocalizedText } from './config'
import type { NavigationKind } from './navigation'

/**
 * What the adapter tells the platform about itself.
 *
 * The platform fetches this once when a project's adapter URL is saved, and it
 * drives three things: the project's Store settings form is generated from
 * `configSchema`, the project's menu and features are gated on `capabilities`,
 * and the LLM's response schema is trimmed to the capabilities that exist — so
 * a bot on a store with no cart is never even offered the vocabulary to try.
 */

export type ProductAttributeKind = 'text' | 'list' | 'number'

/**
 * A hint about an attribute key this adapter emits, used to pre-seed the
 * project's attribute schema so the admin starts from a filled-in table rather
 * than a blank one.
 */
export type ProductAttributeHint = {
  key: string
  label: LocalizedText
  kind: ProductAttributeKind
  /** Suggest including this in the embedded text. */
  suggestEmbedding?: boolean
  /** Suggest showing this on the product card. */
  suggestOnCard?: boolean
}

export type AdapterCapabilities = {
  catalog: {
    /** `catalog.list` honours `updatedSince`, so syncs can be incremental. */
    incrementalSync: boolean
    categories: boolean
    variants: boolean
  }
  cart: {
    supported: boolean
    /** Meaningless when `supported` is false; `'server'` is the placeholder. */
    mode: 'client' | 'server'
  }
  navigation: {
    supported: boolean
    kinds: NavigationKind[]
  }
  customer: {
    identity: boolean
    orders: boolean
  }
  webhooks: {
    /** The adapter exposes an endpoint the store can call to trigger reindexing. */
    supported: boolean
  }
}

export type AdapterManifest = {
  /** Stable machine name, e.g. `woocommerce`. */
  name: string
  /** Human name for the Store screen. */
  displayName: LocalizedText
  /** The adapter's own version. */
  version: string
  /** The `@smartitory/agorai-adapter` version it was built against. */
  sdkVersion: string
  /** The contract revision. Bumped only on a breaking wire change. */
  contractVersion: number
  configSchema: ConfigSchema
  capabilities: AdapterCapabilities
  productAttributes?: ProductAttributeHint[]
  /** Optional link to the adapter's setup docs, shown on the Store screen. */
  documentationUrl?: string
}

/**
 * The result of a "Test connection" click. A health check is expected to make a
 * real, cheap call against the store — a manifest that parses proves nothing
 * about whether the credentials work.
 */
export type AdapterHealthResult = {
  ok: boolean
  /** The store's own name, so the admin can confirm they connected the right one. */
  storeName?: string | null
  productCount?: number | null
  currency?: string | null
  /**
   * Non-fatal problems worth showing. This is where "your API key cannot read
   * orders, so order history will be unavailable" belongs — consuela let that
   * degrade silently.
   */
  warnings?: string[]
  /**
   * Attribute keys discovered on a real sample of this store's catalogue.
   *
   * The manifest's `productAttributes` can only ever list what the adapter
   * knows statically, and for a store whose attributes are user-defined meta
   * keys — WooCommerce, most of them — that is nothing. The health check is the
   * first moment the adapter holds working credentials, so it is the first
   * moment it can say what this particular store actually stores. The platform
   * uses these to pre-seed the project's attribute schema instead of showing
   * the admin an empty table.
   */
  productAttributes?: ProductAttributeHint[]
}

/** The wire contract revision this SDK speaks. */
export const CONTRACT_VERSION = 1
