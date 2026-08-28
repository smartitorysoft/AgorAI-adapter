import type { AdapterCart, CartLineOp, CartRecipe } from './cart'
import type { StoreContextData } from './context'
import type { AdapterCustomer, AdapterOrderSummary } from './customer'
import type { AdapterErrorCode } from './errors'
import type { NavigationResult, NavigationTarget } from './navigation'
import type {
  AdapterCategory,
  AdapterProduct,
  CatalogListOptions,
  CatalogPage,
} from './product'

/**
 * The HTTP surface, as types both sides compile against.
 *
 * Everything except the manifest and the liveness probe is a POST, because the
 * `StoreContext` carries the store's credentials: in a body they stay out of
 * URLs, out of access logs, and out of browser history.
 */

export const ADAPTER_ROUTES = {
  manifest: '/v1/manifest',
  health: '/v1/health',
  catalogList: '/v1/catalog/list',
  catalogGet: '/v1/catalog/get',
  catalogCategories: '/v1/catalog/categories',
  cartRead: '/v1/cart/read',
  cartApply: '/v1/cart/apply',
  cartClear: '/v1/cart/clear',
  cartNormalize: '/v1/cart/normalize',
  navigationResolve: '/v1/navigation/resolve',
  customerResolve: '/v1/customer/resolve',
  customerOrders: '/v1/customer/orders',
  download: '/v1/download',
  liveness: '/healthz',
} as const

/** Header carrying the HMAC of `${timestamp}.${rawBody}`. */
export const SIGNATURE_HEADER = 'x-agorai-signature'
/** Header carrying the Unix-seconds timestamp that signature covers. */
export const TIMESTAMP_HEADER = 'x-agorai-timestamp'

/** Every request body starts with the context. */
export type WithContext<T = unknown> = { context: StoreContextData } & T

/**
 * How this project is addressed from a shopper's browser.
 *
 * Handed to `downloads.render` and nowhere else. An adapter writing a file the
 * storefront will load needs the platform's address and the project's public
 * key to put in it, and neither is knowable from the store's own config — but
 * they have no business travelling on every catalogue page either, so they ride
 * on the one call that needs them.
 */
export type DownloadTarget = {
  /** The platform's public base URL, no trailing slash. */
  platformUrl: string
  /** This project's public key, the `pk_live_…` that ends up in page source. */
  projectKey: string
}

export type DownloadRequest = WithContext<{
  key: string
  target: DownloadTarget
}>

export type DownloadResponse = {
  filename: string
  contentType: string
  body: string
  encoding: 'utf8' | 'base64'
}

export type CatalogListRequest = WithContext<{ options?: CatalogListOptions }>
export type CatalogGetRequest = WithContext<{ ids: string[] }>
export type CatalogGetResponse = { items: AdapterProduct[] }
export type CatalogCategoriesResponse = { items: AdapterCategory[] }
export type CatalogListResponse = CatalogPage

/**
 * Reading the cart. In `client` mode the adapter hands back a request for the
 * widget to make; in `server` mode it has already made it.
 */
export type CartReadResponse =
  { mode: 'server'; cart: AdapterCart } | { mode: 'client'; recipe: CartRecipe }

export type CartApplyRequest = WithContext<{
  op: CartLineOp
  /** The current cart. Required in `client` mode, where it picks the request. */
  cart?: AdapterCart
}>

export type CartApplyResponse =
  | { mode: 'server'; cart: AdapterCart }
  | { mode: 'client'; recipes: CartRecipe[] }

export type CartClearResponse = CartApplyResponse

/** `client` mode only: hand back what the store returned, get a cart. */
export type CartNormalizeRequest = WithContext<{ raw: unknown }>
export type CartNormalizeResponse = { cart: AdapterCart }

export type NavigationResolveRequest = WithContext<{
  target: NavigationTarget
}>
export type NavigationResolveResponse = NavigationResult

export type CustomerResolveRequest = WithContext<{ token: string }>
export type CustomerResolveResponse = { customer: AdapterCustomer | null }

export type CustomerOrdersRequest = WithContext<{
  customerId: string
  limit: number
}>
export type CustomerOrdersResponse = { orders: AdapterOrderSummary[] }

/** The single error envelope every failing route returns. */
export type AdapterErrorResponse = {
  error: {
    code: AdapterErrorCode
    message: string
    detail?: string
    retryAfterSeconds?: number
  }
  requestId?: string
}
