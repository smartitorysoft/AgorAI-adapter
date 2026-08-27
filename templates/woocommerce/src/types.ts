/**
 * The slices of WooCommerce's REST responses this adapter actually reads.
 *
 * Deliberately partial: WooCommerce sends far more than this, and typing only
 * what we consume means a WooCommerce upgrade that adds fields cannot break the
 * build. Everything is optional-ish for the same reason — a plugin that strips
 * a field should degrade a product card, not throw.
 */

export type WooTerm = {
  id: number
  name: string
  slug: string
}

export type WooImage = {
  id: number
  src: string
  alt: string
}

export type WooAttribute = {
  id: number
  name: string
  options: string[]
}

export type WooMeta = {
  id: number
  key: string
  value: unknown
}

export type WooProduct = {
  id: number
  name: string
  slug: string
  permalink: string
  sku: string
  type: string
  status: string
  price: string
  regular_price: string
  sale_price: string
  stock_status: string
  stock_quantity: number | null
  date_modified_gmt: string | null
  description: string
  short_description: string
  categories: WooTerm[]
  tags: WooTerm[]
  images: WooImage[]
  attributes: WooAttribute[]
  meta_data: WooMeta[]
}

export type WooCategory = {
  id: number
  name: string
  slug: string
  parent: number
  count: number
}

export type WooOrderLineItem = {
  name: string
  sku: string | null
  quantity: number
}

export type WooOrder = {
  number: string
  status: string
  currency: string
  date_created: string
  total: string
  line_items: WooOrderLineItem[]
}

export type WooCurrency = {
  code: string
  name: string
  symbol: string
}

/**
 * The Store API's cart, which is a different API from the REST v3 one above:
 * it lives at `/wp-json/wc/store/v1`, is authenticated by the shopper's own
 * cookies, and quotes every price in **minor units** as a string.
 */
export type WooStoreCart = {
  items?: Array<{
    key?: string
    id?: number
    quantity?: number
    name?: string
    sku?: string
    prices?: {
      price?: string
      currency_code?: string
      currency_minor_unit?: number
    }
    totals?: {
      line_total?: string
      currency_code?: string
      currency_minor_unit?: number
    }
  }>
  items_count?: number
  totals?: {
    total_items?: string
    total_price?: string
    currency_code?: string
    currency_minor_unit?: number
  }
}

export type WooVariationAttribute = {
  id: number
  /** The attribute's display name, e.g. `Size`. */
  name: string
  /** The single value this variation carries for it, e.g. `L`. */
  option: string
}

/**
 * One row of `products/{id}/variations`.
 *
 * A variation is a thinner thing than a product: no categories, no meta worth
 * reading, and its description is almost always the parent's. Only what a
 * shopper choosing between them needs is typed here.
 */
export type WooVariation = {
  id: number
  sku: string
  price: string
  stock_status: string
  attributes: WooVariationAttribute[]
}
