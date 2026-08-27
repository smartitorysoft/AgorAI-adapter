import type { CartPort } from './cart'
import type { ConfigSchemaInput, LocalizedText } from './config'
import type { StoreContext } from './context'
import type { CustomerPort } from './customer'
import type { AdapterHealthResult, ProductAttributeHint } from './manifest'
import type { NavigationKind, NavigationPort } from './navigation'
import type {
  AdapterCategory,
  AdapterProduct,
  CatalogListOptions,
  CatalogPage,
} from './product'

export type DeclaredCapabilities = {
  /** `catalog.list` honours `updatedSince`. Without it every sync is a full one. */
  incrementalSync?: boolean
  /** Products may carry `variants`. */
  variants?: boolean
  /**
   * Which navigation targets actually resolve.
   *
   * Defaults to `['cart', 'checkout', 'product']` when a navigation port exists
   * — the three consuela used and the three nearly every store has. Declare it
   * explicitly if yours differs, because the platform only offers the LLM the
   * kinds listed here.
   */
  navigation?: NavigationKind[]
  /** The adapter exposes a store-facing webhook endpoint. */
  webhooks?: boolean
}

export type CatalogPort = {
  /**
   * One page of products. The platform calls this repeatedly, passing back
   * `nextCursor` verbatim, until it comes back null.
   */
  list(ctx: StoreContext, options: CatalogListOptions): Promise<CatalogPage>
  /**
   * Fetch specific products by store-native id.
   *
   * Used for webhook-driven refreshes and to re-read price and stock just
   * before answering, so a product card never quotes a stale price. Ids that no
   * longer exist are simply omitted from the result.
   */
  get(ctx: StoreContext, ids: string[]): Promise<AdapterProduct[]>
  /** The category tree, when the store has one. */
  categories?(ctx: StoreContext): Promise<AdapterCategory[]>
}

/**
 * What an adapter author passes to `defineAdapter`.
 *
 * `catalog` is the only required port — an AgorAI with nothing to recommend is
 * not an AgorAI. Everything else is optional, and the manifest reports what is
 * missing so the platform can hide the matching features rather than fail at
 * them.
 */
export type AdapterDefinition = {
  name: string
  displayName?: LocalizedText
  version: string
  documentationUrl?: string
  config: ConfigSchemaInput
  productAttributes?: ProductAttributeHint[]

  /**
   * The handful of capabilities that cannot be read off the ports themselves.
   *
   * Everything else is inferred: a `cart` port means carts are supported, a
   * `catalog.categories` method means categories are, and so on. These four
   * have no such signal, so they are declared.
   */
  capabilities?: DeclaredCapabilities

  /**
   * Prove the supplied configuration actually reaches the store. Called by the
   * "Test connection" button, with the config the admin just typed.
   *
   * Omit it and the platform falls back to a single `catalog.list` of one item,
   * which is a weaker check but better than none.
   */
  health?(ctx: StoreContext): Promise<AdapterHealthResult>

  catalog: CatalogPort
  cart?: CartPort
  navigation?: NavigationPort
  customer?: CustomerPort
}

/** A definition after `defineAdapter` has normalized and validated it. */
export type AgorAIAdapter = AdapterDefinition & {
  readonly __agoraiAdapter: true
}
