/**
 * The normalized catalogue shape. Every store, however it models products,
 * arrives at the platform looking like this.
 */

export type AdapterPrice = {
  /** Decimal string, never a float — money does not survive IEEE-754. */
  amount: string
  /** ISO-4217, e.g. `HUF`, `EUR`. */
  currency: string
}

export type AdapterProductVariant = {
  id: string
  sku: string | null
  name: string | null
  price: AdapterPrice | null
  inStock: boolean | null
  /** e.g. `{ size: 'L', colour: 'black' }`. */
  options: Record<string, string>
}

export type AdapterProduct = {
  /** Store-native id. Opaque to the platform, and the identity used for upserts. */
  id: string
  sku: string | null
  name: string
  url: string | null
  imageUrl: string | null
  price: AdapterPrice | null
  inStock: boolean | null
  /** Store-native status string, shown as-is. `inStock` is what logic reads. */
  stockStatus: string | null
  /**
   * Store-native product type. The platform only special-cases the value
   * `'simple'`: anything else is excluded from bot-driven cart operations,
   * because a variable product cannot be added without choosing a variant.
   */
  type: string | null
  categories: string[]
  /** Plain text. HTML must be stripped by the adapter — it goes into an embedding. */
  description: string | null
  /**
   * Everything else the store knows about this product, free-form per store.
   *
   * This replaces what consuela hardcoded as the columns `phJelleg`,
   * `feluletLista` and `tiltottFeluletek`. The project's attribute schema
   * decides what each key means: whether it is embedded, whether it shows on
   * the product card, and whether it filters retrieval.
   */
  attributes: Record<string, string | string[]>
  /** ISO-8601. Drives incremental sync when the adapter supports it. */
  updatedAt: string | null
  variants?: AdapterProductVariant[]
}

export type AdapterCategory = {
  id: string
  name: string
  url: string | null
  parentId: string | null
  /** Product count, when the store can give one cheaply. */
  count?: number | null
}

export type CatalogPage = {
  items: AdapterProduct[]
  /**
   * Opaque cursor for the next page, or null at the end. The platform passes it
   * back verbatim and never parses it, so page numbers, offsets and continuation
   * tokens all work.
   */
  nextCursor: string | null
  /** Total across all pages, when known. Used only for progress reporting. */
  total?: number | null
}

export type CatalogListOptions = {
  cursor?: string
  /** ISO-8601. Only products changed since then, if `incrementalSync` is declared. */
  updatedSince?: string
  /** Hint only; the adapter may return fewer. */
  limit?: number
}
