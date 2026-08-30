import type { StoreContext } from './context'
import type { AdapterPrice } from './product'

/**
 * Carts come in two shapes because they genuinely are two different things.
 *
 * A WooCommerce cart lives in the shopper's browser session, and the widget is
 * embedded on the WooCommerce page itself — so a server-side mutation would
 * change a *different* cart from the one the shopper is looking at. A headless
 * store's cart, by contrast, is a server resource the platform can address
 * directly with a session token.
 *
 * `mode: 'client'` covers the first case: the adapter describes the request and
 * the widget performs it same-origin, with the store's own cookies. `mode:
 * 'server'` covers the second: the platform calls the adapter and the adapter
 * calls the store.
 */

export type CartOpMode = 'set' | 'add' | 'remove'

export type CartLineOp = {
  productId: string
  variantId?: string | null
  /**
   * `set` means "make it exactly this many", `add` means "this many more",
   * `remove` ignores the number entirely. The LLM is asked for the intent and
   * never for arithmetic, because only the cart knows the current count.
   */
  mode: CartOpMode
  quantity: number
}

export type AdapterCartLine = {
  /**
   * Store-native line identity. WooCommerce needs it to update or remove a
   * line, and it is not the product id — a cart can hold the same product twice
   * under different options.
   */
  key: string
  productId: string
  variantId: string | null
  sku: string | null
  name: string
  quantity: number
  price: AdapterPrice | null
  lineTotal: AdapterPrice | null
}

export type AdapterCart = {
  lines: AdapterCartLine[]
  itemCount: number
  subtotal: AdapterPrice | null
  total: AdapterPrice | null
  currency: string | null
}

export const EMPTY_CART: AdapterCart = {
  lines: [],
  itemCount: 0,
  subtotal: null,
  total: null,
  currency: null,
}

/**
 * A request the widget performs itself, against the store's own origin.
 *
 * `path` is relative to the storefront origin, so the widget never learns the
 * store's absolute URL from us and same-origin credentials keep working.
 */
export type CartRecipe = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  headers?: Record<string, string>
  /**
   * Names of tokens from `window.AgorAIStore` the widget must attach as
   * headers, e.g. `{ Nonce: 'storeApiNonce' }`. Keeps nonce handling declarative
   * instead of hardcoding WooCommerce into the widget.
   */
  sessionHeaders?: Record<string, string>
  /** Send the store's cookies. Almost always true for a same-origin cart. */
  withCredentials?: boolean
}

export type ClientCartPort = {
  mode: 'client'
  /** How to read the cart. */
  readRecipe(ctx: StoreContext): CartRecipe
  /**
   * How to apply one line change, given what the cart currently holds.
   *
   * The current cart is passed in because the choice of request usually depends
   * on it: WooCommerce adds with `cart/add-item` but updates an existing line
   * with `cart/update-item` and its line key. Returning several recipes runs
   * them in order.
   *
   * May be async, because composing the request sometimes needs one lookup the
   * cart cannot supply: Shopify's cart adds by *variant* id while the platform
   * knows the product by the id the catalogue was indexed under. Reach for it
   * only when there is no other way — this runs while a shopper waits.
   */
  writeRecipe(
    ctx: StoreContext,
    op: CartLineOp,
    cart: AdapterCart
  ): CartRecipe | CartRecipe[] | Promise<CartRecipe | CartRecipe[]>
  /** How to empty the cart. */
  clearRecipe?(ctx: StoreContext): CartRecipe | CartRecipe[]
  /**
   * Turn whatever the store returned into the normalized cart.
   *
   * This is what keeps store-specific knowledge out of the widget: the raw
   * response travels back to the platform, which asks the adapter to read it.
   */
  normalize(ctx: StoreContext, raw: unknown): AdapterCart
}

export type ServerCartPort = {
  mode: 'server'
  get(ctx: StoreContext): Promise<AdapterCart>
  apply(ctx: StoreContext, op: CartLineOp): Promise<AdapterCart>
  clear(ctx: StoreContext): Promise<AdapterCart>
}

export type CartPort = ClientCartPort | ServerCartPort

export function isClientCart(port: CartPort): port is ClientCartPort {
  return port.mode === 'client'
}

/**
 * Resolves an op against a current quantity. Shared so `client` and `server`
 * adapters cannot disagree about what `add` means.
 */
export function resolveTargetQuantity(op: CartLineOp, current: number): number {
  if (op.mode === 'remove') return 0
  const quantity = Math.max(0, Math.trunc(op.quantity))
  return op.mode === 'add' ? current + quantity : quantity
}
