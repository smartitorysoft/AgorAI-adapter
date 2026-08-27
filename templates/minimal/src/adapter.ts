/**
 * Your store's AgorAI adapter.
 *
 * This is the only file you have to write. Implement the ports your store can
 * serve, leave out the ones it cannot, and `run()` does the rest: it exposes the
 * HTTP API the platform talks to, verifies request signatures, and publishes a
 * manifest that tells the platform what you support.
 *
 * Two rules worth knowing before you start:
 *
 *  1. NEVER read `process.env` for store settings. Everything store-specific
 *     arrives on `ctx`, filled in by the shop admin on the project's Store
 *     screen from the `config` schema you declare below. That is what lets one
 *     deployment of an adapter serve many stores.
 *
 *  2. Money is a decimal STRING (`'3490.00'`), never a number. Floats lose
 *     cents, and the platform passes prices straight through to the shopper.
 */
import {
  AdapterUpstreamError,
  defineAdapter,
  run,
  type AdapterProduct,
  type StoreContext,
} from '@smartitory/agorai-adapter'

const adapter = defineAdapter({
  // Lowercase kebab-case. Shows up in logs and in the platform's adapter list.
  name: 'my-store',
  version: '1.0.0',
  displayName: { en: 'My Store', hu: 'Az én boltom' },

  /**
   * The settings form the platform renders for every project using this
   * adapter. Whatever you declare here is what the shop admin fills in — so
   * declare everything your store needs, and nothing it does not.
   */
  config: {
    STORE_API_URL: {
      type: 'url',
      required: true,
      label: { en: 'Store API URL', hu: 'Bolt API URL' },
      help: {
        en: 'The base URL of your storefront, e.g. https://shop.example.com',
        hu: 'A webáruház alap URL-je, pl. https://shop.example.com',
      },
    },
    STORE_API_KEY: {
      type: 'secret',
      required: true,
      label: { en: 'API key', hu: 'API kulcs' },
    },
  },

  /**
   * The few things that cannot be read off your ports. Everything else is
   * inferred — providing a `cart` means carts are supported, and so on.
   */
  capabilities: {
    // Set true once `catalog.list` honours `updatedSince`. Until then every
    // sync re-reads the whole catalogue.
    incrementalSync: false,
    navigation: ['cart', 'checkout', 'product'],
  },

  /**
   * Behind the "Test connection" button. Make a real, cheap call: a manifest
   * that parses proves nothing about whether the credentials work.
   */
  async health(ctx) {
    const response = await storeFetch(ctx, '/api/store')
    const store = (await response.json()) as { name?: string; products?: number }
    return {
      ok: true,
      storeName: store.name ?? null,
      productCount: store.products ?? null,
      warnings: [],
    }
  },

  catalog: {
    /**
     * One page of products. The platform calls this repeatedly, handing back
     * your `nextCursor` verbatim, until you return null.
     *
     * Make sure it terminates. A cursor that never goes null turns the nightly
     * index into an infinite loop against your own store.
     */
    async list(ctx, { cursor, updatedSince, limit }) {
      const parameters = new URLSearchParams({ limit: String(limit ?? 100) })
      if (cursor) parameters.set('cursor', cursor)
      if (updatedSince) parameters.set('updated_since', updatedSince)

      const response = await storeFetch(ctx, `/api/products?${parameters}`)
      const page = (await response.json()) as {
        items: unknown[]
        next?: string | null
        total?: number
      }

      return {
        items: page.items.map((item) => toProduct(item)),
        nextCursor: page.next ?? null,
        total: page.total ?? null,
      }
    },

    /**
     * Specific products by id. Used for webhook refreshes, and to re-read price
     * and stock just before answering so a product card never quotes a stale
     * price. Ids that no longer exist are simply left out of the result.
     */
    async get(ctx, ids) {
      const response = await storeFetch(
        ctx,
        `/api/products?ids=${ids.map(encodeURIComponent).join(',')}`
      )
      const page = (await response.json()) as { items: unknown[] }
      return page.items.map((item) => toProduct(item))
    },

    /** Delete this method if your store has no category tree. */
    async categories(ctx) {
      const response = await storeFetch(ctx, '/api/categories')
      const rows = (await response.json()) as Array<{
        id: string
        name: string
        parent?: string | null
      }>
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: `/categories/${row.id}`,
        parentId: row.parent ?? null,
      }))
    },
  },

  /**
   * Delete this whole block if the bot should not touch carts.
   *
   * `mode: 'server'` means the platform calls you and you call the store —
   * right for a headless store the platform can reach. If instead your cart
   * lives in the shopper's browser session (WooCommerce, most classic PHP
   * shops), use `mode: 'client'` and return request recipes for the widget to
   * perform same-origin; see the `woocommerce` template.
   */
  cart: {
    mode: 'server',

    async get(ctx) {
      const response = await storeFetch(ctx, `/api/cart/${cartId(ctx)}`)
      return toCart(await response.json())
    },

    /**
     * Apply one change. `mode` is the shopper's intent, not arithmetic:
     * `'set'` means "make it exactly this many", `'add'` means "this many
     * more", `'remove'` empties the line and ignores `quantity`.
     */
    async apply(ctx, op) {
      const response = await storeFetch(ctx, `/api/cart/${cartId(ctx)}/items`, {
        method: 'POST',
        body: JSON.stringify(op),
      })
      return toCart(await response.json())
    },

    async clear(ctx) {
      const response = await storeFetch(ctx, `/api/cart/${cartId(ctx)}`, {
        method: 'DELETE',
      })
      return toCart(await response.json())
    },
  },

  /** Delete this block if the bot should not send shoppers anywhere. */
  navigation: {
    resolve(ctx, target) {
      switch (target.kind) {
        case 'cart': {
          return { url: '/cart' }
        }
        case 'checkout': {
          return { url: '/checkout' }
        }
        case 'product': {
          return { url: `/products/${target.id}` }
        }
        case 'category': {
          return { url: `/categories/${target.id}` }
        }
        case 'search': {
          return { url: `/search?q=${encodeURIComponent(target.query)}` }
        }
        case 'page': {
          return { url: `/${target.slug}` }
        }
      }
    },
  },

  /**
   * Delete this block if your storefront cannot prove who the shopper is.
   *
   * The token is whatever your storefront put in `window.AgorAIStore.
   * identityToken`. Verify it — a signature you issued, a session lookup,
   * anything — and NEVER trust a bare user id: an unsigned id in a public
   * request body is a "show me someone else's order history" hole.
   */
  customer: {
    async resolveIdentity(ctx, token) {
      const response = await storeFetch(ctx, '/api/identity', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })

      // A bad token means "treat this shopper as a guest". Return null; do not
      // throw. A guest chat is a working chat, and every logged-out visitor
      // would otherwise hit an error.
      if (!response.ok) return null

      const customer = (await response.json()) as {
        id: string
        email?: string
        name?: string
      }
      return {
        id: customer.id,
        email: customer.email ?? null,
        displayName: customer.name ?? null,
      }
    },

    async listOrders(ctx, customerId, limit) {
      const response = await storeFetch(
        ctx,
        `/api/customers/${customerId}/orders?limit=${limit}`
      )
      const rows = (await response.json()) as Array<{
        id: string
        status: string
        date: string
        total: string
        currency: string
        items: Array<{ name: string; sku?: string; quantity: number }>
      }>

      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        date: row.date,
        total: { amount: row.total, currency: row.currency },
        items: row.items.map((item) => ({
          name: item.name,
          sku: item.sku ?? null,
          quantity: item.quantity,
        })),
      }))
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers. Nothing below here is part of the contract — rewrite freely.
// ---------------------------------------------------------------------------

/**
 * One place that knows how to call your store, so credentials and error
 * handling are not re-implemented at every call site.
 */
async function storeFetch(
  ctx: StoreContext,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${ctx.baseUrl('STORE_API_URL')}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.cfg('STORE_API_KEY')}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    // Note what is NOT here: the URL. It carries the store's own parameters,
    // and this message ends up in the platform's logs.
    throw new AdapterUpstreamError(
      'The store did not respond.',
      (error as Error).message
    )
  }

  if (!response.ok) {
    throw new AdapterUpstreamError(
      `The store answered ${response.status}.`,
      await response.text().then((text) => text.slice(0, 300))
    )
  }

  return response
}

/** Whatever your store calls a visitor's cart. The widget collects it for you. */
function cartId(ctx: StoreContext): string {
  return ctx.session('cartId') ?? ctx.session('sessionId') ?? ctx.projectId
}

/** Map one of your store's products onto the shape the platform indexes. */
function toProduct(raw: unknown): AdapterProduct {
  const item = raw as {
    id: string
    sku?: string
    title: string
    price?: string
    currency?: string
    in_stock?: boolean
    categories?: string[]
    body?: string
    updated_at?: string
    [key: string]: unknown
  }

  return {
    id: String(item.id),
    sku: item.sku ?? null,
    name: item.title,
    url: `/products/${item.id}`,
    imageUrl: null,
    price:
      item.price === undefined
        ? null
        : { amount: item.price, currency: item.currency ?? 'HUF' },
    inStock: item.in_stock ?? null,
    stockStatus: item.in_stock === false ? 'outofstock' : 'instock',
    // Only `'simple'` products can be added to a cart by the bot: anything with
    // variants cannot be added without choosing one first.
    type: 'simple',
    categories: item.categories ?? [],
    // Plain text only — this gets embedded. Strip any HTML before it lands here.
    description: item.body ?? null,
    /**
     * Everything else your store knows. Free-form: the shop admin decides on
     * the project's Products screen which of these are embedded, which show on
     * the product card, and which filter recommendations.
     *
     * This is where a domain lives. A cleaning-supplies shop puts
     * `{ ph: 'alkaline', unsafe_surfaces: ['marble'] }` here; a bookshop puts
     * `{ author: '…', language: 'hu' }`.
     */
    attributes: {},
    updatedAt: item.updated_at ?? null,
  }
}

/** Map your store's cart onto the normalized shape. */
function toCart(raw: unknown) {
  const cart = raw as {
    lines?: Array<{
      key: string
      product_id: string
      sku?: string
      title: string
      quantity: number
      price?: string
    }>
    currency?: string
  }

  const lines = (cart.lines ?? []).map((line) => ({
    key: line.key,
    productId: String(line.product_id),
    variantId: null,
    sku: line.sku ?? null,
    name: line.title,
    quantity: line.quantity,
    price: line.price
      ? { amount: line.price, currency: cart.currency ?? 'HUF' }
      : null,
    lineTotal: null,
  }))

  return {
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    subtotal: null,
    total: null,
    currency: cart.currency ?? null,
  }
}

// Boots the HTTP server. PORT and ADAPTER_SHARED_SECRET come from the
// environment; everything store-specific comes from the platform on `ctx`.
void run(adapter)
