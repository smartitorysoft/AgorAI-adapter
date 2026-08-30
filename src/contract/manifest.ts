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

/**
 * A file the shop has to install somewhere the platform cannot reach.
 *
 * The platform lists these on the Store screen and serves them, but never
 * writes one: the contents are as store-specific as the config schema is — a
 * WordPress mu-plugin, a Shopify theme snippet, an nginx include — so the
 * adapter renders its own and the core stays free of every one of them.
 *
 * Rendering happens per download rather than once at connect time, so a file
 * carrying a rotated secret is correct at the moment it is fetched.
 */
export type AdapterDownload = {
  /** Stable key, used in the URL the platform serves this from. */
  key: string
  /** Suggested filename, e.g. `agorai-config.php`. */
  filename: string
  label: LocalizedText
  /** Where the file goes and what it is for. Shown next to the button. */
  description: LocalizedText
  /** e.g. `text/plain`, `application/zip`. */
  contentType: string
  /**
   * The file carries a credential. The UI says so, and says that rotating it
   * means downloading again — a stale copy fails as "every shopper is a
   * guest", which explains itself to nobody.
   */
  containsSecret?: boolean
  /**
   * Config keys whose values end up **inside** this file.
   *
   * A generated file is a copy, and a copy goes out of date the moment one of
   * the values baked into it is edited. Nothing on either side can notice that
   * on its own: the platform does not read the file and the shop does not
   * re-fetch it, so a stale copy simply keeps working incorrectly — an old
   * identity secret degrades to "every shopper is a guest", which explains
   * itself to nobody. Declaring the dependency is what lets the Store screen
   * say *download this again*.
   *
   * List optional keys too. Whether a value is required is a separate question
   * — see `requires` — and an optional field that is nonetheless copied into
   * the file still invalidates it when it changes.
   */
  dependsOn?: string[]
  /**
   * The subset of `dependsOn` that must hold a value before the file is worth
   * downloading at all.
   *
   * Keys listed here are folded into `dependsOn` by `buildManifest`, so an
   * adapter author cannot declare one without the other.
   */
  requires?: string[]
  /**
   * The version of the **generated artefact**, not of the adapter.
   *
   * Bump it when the code inside the file changes, and every shop still
   * running the previous copy is told to download it again. Without it the
   * platform can only notice a settings change, and a plugin whose code was
   * fixed would sit unnoticed on every storefront that already had one.
   */
  version?: string
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
  /** Files the shop installs on its own side. Rendered by the adapter. */
  downloads?: AdapterDownload[]
  /**
   * The adapter's mark, shown on the Store screen's platform picker.
   *
   * A `data:image/…` URI or an `https://` URL. A data URI is the one to reach
   * for: the picker is drawn before a project has connected to anything, so the
   * platform serves the manifest's copy rather than letting a browser fetch
   * from an address the admin is not supposed to see.
   */
  logo?: string
  /**
   * The adapter's brand colour as `#rgb` or `#rrggbb`.
   *
   * Used to tint its card on the platform picker, so a shop owner recognises
   * the thing they already use rather than reading a list of names. Falls back
   * to the platform's own accent when absent — never to a random colour.
   */
  brandColor?: string
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
