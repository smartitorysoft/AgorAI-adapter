/**
 * The parts of Shopify's payloads this adapter actually reads.
 *
 * Partial on purpose. A Shopify product carries far more than the platform has
 * any use for, and typing the whole thing would mean maintaining a copy of
 * their schema that goes stale every quarter — these are the fields the queries
 * in `client.ts` ask for, and nothing else.
 *
 * Two different APIs live in this file, and confusing them is the single most
 * expensive mistake available here:
 *
 * - **Admin GraphQL** (`ShopifyProduct` and friends) — server-to-server with an
 *   access token, money as decimal strings like `"3490.00"`.
 * - **Ajax cart** (`ShopifyAjaxCart`) — the shopper's own browser against the
 *   storefront, cookie-authenticated, money as integers in **hundredths of a
 *   unit regardless of the currency**: ¥1000 arrives as `100000`.
 */

export type ShopifyMoney = {
  amount?: string
  currencyCode?: string
}

export type ShopifyMetafield = {
  namespace?: string
  key?: string
  type?: string
  value?: string
}

export type ShopifyProductOption = {
  name?: string
  optionValues?: Array<{ name?: string }>
}

export type ShopifyVariant = {
  legacyResourceId?: string
  sku?: string | null
  title?: string
  availableForSale?: boolean
  inventoryQuantity?: number | null
  price?: string
  selectedOptions?: Array<{ name?: string; value?: string }>
}

export type ShopifyProduct = {
  legacyResourceId?: string
  handle?: string
  title?: string
  status?: string
  vendor?: string | null
  productType?: string | null
  tags?: string[]
  updatedAt?: string | null
  totalInventory?: number | null
  tracksInventory?: boolean
  hasOnlyDefaultVariant?: boolean
  onlineStoreUrl?: string | null
  description?: string | null
  featuredMedia?: {
    preview?: { image?: { url?: string } | null } | null
  } | null
  priceRangeV2?: { minVariantPrice?: ShopifyMoney } | null
  options?: ShopifyProductOption[]
  collections?: { nodes?: Array<{ title?: string; handle?: string }> }
  metafields?: { nodes?: ShopifyMetafield[] }
  variants?: { nodes?: ShopifyVariant[] }
}

export type ShopifyCollection = {
  legacyResourceId?: string
  title?: string
  handle?: string
  productsCount?: { count?: number } | null
}

export type ShopifyShop = {
  name?: string
  currencyCode?: string
  myshopifyDomain?: string
  primaryDomain?: { url?: string } | null
  enabledPresentmentCurrencies?: string[]
}

export type ShopifyOrder = {
  name?: string
  createdAt?: string | null
  cancelledAt?: string | null
  displayFinancialStatus?: string | null
  displayFulfillmentStatus?: string | null
  totalPriceSet?: { shopMoney?: ShopifyMoney } | null
  lineItems?: {
    nodes?: Array<{ title?: string; sku?: string | null; quantity?: number }>
  }
}

export type ShopifyThrottleStatus = {
  maximumAvailable?: number
  currentlyAvailable?: number
  restoreRate?: number
}

export type ShopifyCost = {
  requestedQueryCost?: number
  actualQueryCost?: number
  throttleStatus?: ShopifyThrottleStatus
}

export type ShopifyGraphQLError = {
  message?: string
  extensions?: { code?: string }
}

export type ShopifyGraphQLBody<T> = {
  data?: T | null
  errors?: ShopifyGraphQLError[]
  extensions?: { cost?: ShopifyCost }
}

// --- the storefront's Ajax cart, a different API entirely -------------------

export type ShopifyAjaxLine = {
  key?: string
  id?: number
  variant_id?: number
  product_id?: number
  sku?: string | null
  title?: string
  product_title?: string
  quantity?: number
  price?: number
  final_price?: number
  line_price?: number
  final_line_price?: number
}

export type ShopifyAjaxCart = {
  item_count?: number
  items?: ShopifyAjaxLine[]
  total_price?: number
  original_total_price?: number
  items_subtotal_price?: number
  currency?: string
}
