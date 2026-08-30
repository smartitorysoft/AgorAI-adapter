/**
 * The shopper's own cart, mutated in the shopper's own browser.
 *
 * `client` mode, and not by preference. The advisor is embedded in the shop's
 * theme, so the cart it must change is the one behind the shopper's `cart`
 * cookie — the one the header count and the `/cart` page read. Shopify's
 * Storefront API can build a cart too, and it would be the wrong one: a
 * server-side mutation from here would create a second cart the shopper never
 * sees. So the adapter describes requests and the widget performs them
 * same-origin with the store's cookies.
 *
 * Three things about Shopify's Ajax cart that the shape of this file follows
 * from:
 *
 * - **`/cart/add.js` answers with the added items, not with a cart.** An add on
 *   its own would normalize to an empty cart with no total, so every add is
 *   followed by a read. The widget hands the *last* response to `normalize`.
 * - **`/cart/change.js` sets an absolute quantity and `0` removes**, so it is
 *   one endpoint where WooCommerce needs two — but it also means an existing
 *   line must never be touched with `add.js`, which would add to the quantity
 *   instead of setting it.
 * - **A line is addressed by its `key`, not by its variant id.** The same
 *   variant can sit on two lines with different properties, and changing "the
 *   one with the variant id" then changes whichever comes first.
 */
import {
  type AdapterCart,
  type AdapterCartLine,
  type CartLineOp,
  type CartRecipe,
  type ClientCartPort,
  resolveTargetQuantity,
  type StoreContext,
} from '@smartitory/agorai-adapter'

import { shopifyGraphQL, toGid } from './client'
import { credentials, setting } from './config'
import { fromMinorUnits } from './product'
import type { ShopifyAjaxCart, ShopifyAjaxLine } from './types'

const AJAX_READ = '/cart.js'
const AJAX_ADD = '/cart/add.js'
const AJAX_CHANGE = '/cart/change.js'
const AJAX_CLEAR = '/cart/clear.js'

const VARIANT_CACHE_TTL_MS = 10 * 60 * 1000
const VARIANT_CACHE_LIMIT = 5000

/**
 * Which variant a product means, for the products that only have one.
 *
 * Bounded and short-lived: this is a cache of something Shopify owns, not state
 * of this adapter's own. A shop that re-creates a variant sees the new id
 * within ten minutes, and the map cannot grow past a few thousand entries on a
 * deployment serving many shops.
 */
const variantCache = new Map<string, { id: string; readAt: number }>()

export const shopifyCart: ClientCartPort = {
  mode: 'client',

  readRecipe(ctx) {
    return recipe(ctx, 'GET', AJAX_READ)
  },

  async writeRecipe(ctx, op, cart) {
    const line = findLine(cart, op)
    const quantity = resolveTargetQuantity(op, line?.quantity ?? 0)

    if (line) {
      if (line.quantity === quantity) return []
      return [recipe(ctx, 'POST', AJAX_CHANGE, { id: line.key, quantity })]
    }

    // Removing what is not there is a success, not an error.
    if (quantity === 0) return []

    const variantId =
      op.variantId ?? (await defaultVariantId(ctx, op.productId))
    if (!variantId) return []

    return [
      recipe(ctx, 'POST', AJAX_ADD, {
        items: [{ id: Number(variantId), quantity }],
      }),
      recipe(ctx, 'GET', AJAX_READ),
    ]
  },

  clearRecipe(ctx) {
    return recipe(ctx, 'POST', AJAX_CLEAR)
  },

  normalize(_ctx, raw) {
    return toCart(raw)
  },
}

/**
 * The variant id `/cart/add.js` needs, for a product the platform knows by its
 * product id.
 *
 * Shopify has no product-level add, and the platform indexes products by
 * product id because that is the only identifier a `products/delete` webhook
 * carries — so somebody has to bridge the two, and this is the only place that
 * holds both a product id and the shop's credentials. Only ever reached for a
 * product the cart does not already hold.
 */
async function defaultVariantId(
  ctx: StoreContext,
  productId: string
): Promise<string | null> {
  const key = `${credentials(ctx).adminUrl}|${productId}`
  const cached = variantCache.get(key)
  if (cached && Date.now() - cached.readAt < VARIANT_CACHE_TTL_MS) {
    return cached.id
  }

  const { data } = await shopifyGraphQL<{
    product: {
      variants?: { nodes?: Array<{ legacyResourceId?: string }> }
    } | null
  }>(
    ctx,
    'AgorAIDefaultVariant',
    `query AgorAIDefaultVariant($id: ID!) {
       product(id: $id) { variants(first: 1) { nodes { legacyResourceId } } }
     }`,
    { id: toGid('Product', productId) }
  )

  const id = data.product?.variants?.nodes?.[0]?.legacyResourceId
  if (!id) return null

  if (variantCache.size >= VARIANT_CACHE_LIMIT) variantCache.clear()
  variantCache.set(key, { id: String(id), readAt: Date.now() })
  return String(id)
}

function recipe(
  ctx: StoreContext,
  method: CartRecipe['method'],
  path: string,
  body?: unknown
): CartRecipe {
  return {
    method,
    path: `${setting(ctx, 'SHOPIFY_CART_PATH_PREFIX')}${path}`,
    ...(body === undefined ? {} : { body }),
    // Shopify answers a form-encoded POST with a redirect to the cart page
    // instead of JSON, and the widget would then normalize an HTML document.
    headers: { 'Content-Type': 'application/json' },
    // Without the shopper's own cookies Shopify hands back a fresh empty cart
    // every time, and every add silently goes nowhere.
    withCredentials: true,
  }
}

function findLine(
  cart: AdapterCart,
  op: CartLineOp
): AdapterCartLine | undefined {
  return cart.lines.find(
    (line) =>
      line.productId === op.productId ||
      (Boolean(op.variantId) && line.variantId === op.variantId)
  )
}

function toCart(raw: unknown): AdapterCart {
  if (typeof raw !== 'object' || raw === null) return emptyCart()

  const cart = raw as ShopifyAjaxCart
  if (!Array.isArray(cart.items)) return emptyCart()

  const currency = cart.currency ?? null
  const lines = cart.items
    .filter((item) => (item.quantity ?? 0) > 0 && (item.key ?? '').length > 0)
    .map((item) => toLine(item, currency))

  return {
    lines,
    itemCount:
      cart.item_count ??
      lines.reduce((total, line) => total + line.quantity, 0),
    // Shopify's cart has no subtotal field; the pre-discount total is the
    // honest analogue, and it reads correctly when a discount applies.
    subtotal: toPrice(cart.original_total_price, currency),
    total: toPrice(cart.total_price, currency),
    currency,
  }
}

function toLine(
  item: ShopifyAjaxLine,
  currency: string | null
): AdapterCartLine {
  return {
    key: item.key ?? '',
    // The id the catalogue was indexed under, so the widget — which matches a
    // line to a recommendation by this field — finds it.
    productId: String(item.product_id ?? ''),
    variantId: String(item.variant_id ?? item.id ?? ''),
    sku: (item.sku ?? '').trim() || null,
    name: item.product_title ?? item.title ?? '',
    quantity: item.quantity ?? 0,
    price: toPrice(item.final_price ?? item.price, currency),
    lineTotal: toPrice(item.final_line_price ?? item.line_price, currency),
  }
}

function toPrice(
  value: number | undefined,
  currency: string | null
): AdapterCartLine['price'] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (!currency) return null
  return { amount: fromMinorUnits(value, currency), currency }
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
