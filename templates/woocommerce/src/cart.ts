/**
 * A `client`-mode cart: the adapter describes the request, the widget makes it.
 *
 * This is not a shortcut, it is the only correct shape for WooCommerce. A
 * WooCommerce cart belongs to the shopper's browser session — cookie plus a
 * Store API nonce — and the widget runs on the shop's own page. If the adapter
 * called `cart/add-item` server-side it would create and mutate a *different*
 * cart from the one the shopper is looking at, and the item would never appear.
 *
 * So each port method returns a recipe: a method, a path relative to the shop's
 * own origin, a body, and the names of the tokens the widget must attach. The
 * widget performs it same-origin with the shop's cookies, hands the raw response
 * back, and `normalize` reads it. Nothing in the widget knows what WooCommerce
 * is.
 */
import {
  resolveTargetQuantity,
  type AdapterCart,
  type AdapterCartLine,
  type CartLineOp,
  type CartRecipe,
  type ClientCartPort,
  type StoreContext,
} from '@smartitory/agorai-adapter'

import type { WooStoreCart } from './types'

const STORE_API = '/wp-json/wc/store/v1'

/**
 * The Store API rejects writes without a `Nonce` header. The widget reads the
 * value from `window.AgorAIStore.storeApiNonce` — which the mu-plugin fills
 * in — and refreshes it on a 401/403. Declaring it here rather than in the
 * widget is what keeps WooCommerce out of the widget's code.
 */
const NONCE_HEADERS = { Nonce: 'storeApiNonce' }

function recipe(
  method: CartRecipe['method'],
  path: string,
  body?: unknown
): CartRecipe {
  return {
    method,
    path: `${STORE_API}${path}`,
    ...(body === undefined ? {} : { body }),
    headers: { 'Content-Type': 'application/json' },
    sessionHeaders: NONCE_HEADERS,
    // Without the shop's cookies the Store API hands back a brand new empty
    // cart on every call, and every add silently disappears.
    withCredentials: true,
  }
}

export const wooCart: ClientCartPort = {
  mode: 'client',

  readRecipe(): CartRecipe {
    return recipe('GET', '/cart')
  },

  /**
   * Which request to make depends on what the cart already holds, which is why
   * the current cart is a parameter: WooCommerce adds a new line with
   * `add-item` but changes an existing one with `update-item` and its line key,
   * and the two are not interchangeable.
   */
  writeRecipe(
    _ctx: StoreContext,
    op: CartLineOp,
    cart: AdapterCart
  ): CartRecipe[] {
    const line = findLine(cart, op)
    const quantity = resolveTargetQuantity(op, line?.quantity ?? 0)

    if (!line) {
      // "Remove what is not there" is a success, not an error — the shopper's
      // intent is already satisfied.
      if (quantity === 0) return []
      return [
        recipe('POST', '/cart/add-item', {
          id: Number(op.variantId ?? op.productId),
          quantity,
        }),
      ]
    }

    if (line.quantity === quantity) return []

    return quantity === 0
      ? [recipe('POST', '/cart/remove-item', { key: line.key })]
      : [recipe('POST', '/cart/update-item', { key: line.key, quantity })]
  },

  clearRecipe(): CartRecipe {
    return recipe('DELETE', '/cart/items')
  },

  normalize(_ctx: StoreContext, raw: unknown): AdapterCart {
    return toCart(raw)
  },
}

function findLine(
  cart: AdapterCart,
  op: CartLineOp
): AdapterCartLine | undefined {
  const target = op.variantId ?? op.productId
  return cart.lines.find(
    (line) => line.variantId === target || line.productId === target
  )
}

/**
 * Store API money is an integer string in **minor units** with the scale sent
 * alongside it: `"349000"` at `currency_minor_unit: 2` is `3490.00`. Getting
 * this wrong is a hundredfold price error on a shopper's screen.
 */
function toCart(raw: unknown): AdapterCart {
  if (typeof raw !== 'object' || raw === null) return emptyCart()
  const cart = raw as WooStoreCart

  const currency = cart.totals?.currency_code ?? null

  const lines: AdapterCartLine[] = (cart.items ?? [])
    .filter((item) => (item.quantity ?? 0) > 0 && (item.key ?? '').length > 0)
    .map((item) => ({
      key: item.key ?? '',
      productId: String(item.id ?? ''),
      variantId: null,
      sku: (item.sku ?? '').trim() || null,
      name: item.name ?? '',
      quantity: item.quantity ?? 0,
      price: toPrice(
        item.prices?.price,
        item.prices?.currency_minor_unit,
        item.prices?.currency_code ?? currency
      ),
      lineTotal: toPrice(
        item.totals?.line_total,
        item.totals?.currency_minor_unit,
        item.totals?.currency_code ?? currency
      ),
    }))

  return {
    lines,
    itemCount:
      cart.items_count ??
      lines.reduce((total, line) => total + line.quantity, 0),
    subtotal: toPrice(
      cart.totals?.total_items,
      cart.totals?.currency_minor_unit,
      currency
    ),
    total: toPrice(
      cart.totals?.total_price,
      cart.totals?.currency_minor_unit,
      currency
    ),
    currency,
  }
}

function toPrice(
  minorUnits: string | undefined,
  scale: number | undefined,
  currency: string | null
): AdapterCart['total'] {
  if (minorUnits === undefined || currency === null) return null
  const value = Number(minorUnits)
  if (!Number.isFinite(value)) return null
  const decimals = scale ?? 0
  return { amount: (value / 10 ** decimals).toFixed(decimals), currency }
}

function emptyCart(): AdapterCart {
  return {
    lines: [],
    itemCount: 0,
    subtotal: null,
    total: null,
    currency: null,
  }
}
