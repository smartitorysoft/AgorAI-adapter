/**
 * An AgorAI adapter for WooCommerce.
 *
 * Copy this project, set the four values in `.env` (or leave them blank and fill
 * them in on the platform's Store screen), and deploy the container. Nothing in
 * here is specific to a vertical: the shop's own meta keys arrive as
 * `attributes` and the platform decides what they mean.
 *
 * If you are running the shared, hosted WooCommerce adapter, you do not need
 * this at all — point your project at that URL instead. This template is for a
 * shop that would rather host its own.
 */
import {
  defineAdapter,
  run,
  type AdapterCategory,
  type AdapterHealthResult,
  type AdapterOrderSummary,
  type AdapterProduct,
  type CatalogPage,
  type StoreContext,
} from '@smartitory/agorai-adapter'

import { wooCart } from './cart'
import {
  probeCurrency,
  readStoreName,
  resolveCurrency,
  totalFrom,
  totalPagesFrom,
  wooGet,
} from './client'
import { booleanSetting, CONFIG, numericSetting, setting } from './config'
import { describeFailure, verifyIdentity } from './identity'
import { attributeHints, toProduct } from './product'
import type { WooCategory, WooOrder, WooProduct } from './types'
import { attachVariants } from './variants'

/** WooCommerce caps `per_page` at 100 and silently clamps anything larger. */
const MAX_PER_PAGE = 100

const DEFAULT_ORDERS_LIMIT = 3

/** Orders in any other state say nothing useful about what a shopper likes. */
const USEFUL_ORDER_STATUSES = new Set(['completed', 'processing', 'on-hold'])

/**
 * Orders are fetched then filtered by status, so ask for a few more than we
 * need — otherwise a shopper with three cancelled orders shows an empty history.
 */
const STATUS_HEADROOM = 5

/** Order history sits in the critical path of an answer, so it fails fast. */
const ORDERS_TIMEOUT_MS = 4000

const ORDER_FIELDS = 'number,status,currency,date_created,total,line_items'

/** How many products the health check reads to discover attribute keys. */
const ATTRIBUTE_SAMPLE_SIZE = 20

const adapter = defineAdapter({
  name: 'woocommerce',
  version: '1.0.0',
  displayName: { en: 'WooCommerce', hu: 'WooCommerce' },

  config: CONFIG,

  capabilities: {
    // WooCommerce's `modified_after` makes a nightly sync read only what
    // changed, which on a large catalogue is the difference between minutes
    // and seconds.
    incrementalSync: true,
    // This adapter *can* read variations; whether it does is
    // `WOOCOMMERCE_SYNC_VARIANTS`, because the cost is one extra request per
    // variable product and most shops do not need it. A capability says what
    // the adapter is able to serve — a project turning it off simply means its
    // products arrive without a `variants` array, which is always allowed.
    variants: true,
    navigation: ['cart', 'checkout', 'product', 'category', 'search', 'page'],
  },

  async health(ctx: StoreContext): Promise<AdapterHealthResult> {
    const warnings: string[] = []

    const { body: sample, headers } = await wooGet<WooProduct[]>(
      ctx,
      'products',
      { per_page: ATTRIBUTE_SAMPLE_SIZE, status: 'publish' }
    )

    const currency = await probeCurrency(ctx)
    if (!currency.detected) {
      warnings.push(
        `Could not read the shop's currency, so prices are labelled ${currency.code}. ` +
          'Set the currency override on this screen if that is wrong.'
      )
    }

    if (setting(ctx, 'WP_IDENTITY_SECRET').length === 0) {
      warnings.push(
        'No identity secret is set, so every shopper is treated as a guest and ' +
          'order history is never used.'
      )
    } else if (!(await canReadOrders(ctx))) {
      // consuela let this degrade silently, and "why does it never mention my
      // last order" is not a question anyone should have to debug.
      warnings.push(
        'This API key cannot read orders. Order history will be unavailable — ' +
          'grant the key Read access to orders in WooCommerce.'
      )
    }

    if (sample.length === 0) {
      warnings.push('The shop has no published products to index yet.')
    }

    // Only sayable here, because it needs a real look at the catalogue. An
    // admin who never opens the Advanced section would otherwise have no way to
    // learn that the bot cannot see their sizes.
    if (
      !booleanSetting(ctx, 'WOOCOMMERCE_SYNC_VARIANTS') &&
      sample.some((product) => product.type === 'variable')
    ) {
      warnings.push(
        'This shop has variable products, and reading variations is off — the ' +
          'bot will not know their sizes, colours or per-variation stock. Turn ' +
          '“Read product variations” on under Advanced if answers need them.'
      )
    }


    return {
      ok: true,
      storeName: await readStoreName(ctx),
      productCount: totalFrom(headers),
      currency: currency.code,
      warnings,
      // What this particular shop stores on its products, so the platform can
      // offer a filled-in attribute table instead of an empty one.
      productAttributes: attributeHints(sample),
    }
  },

  catalog: {
    /**
     * WooCommerce paginates by page number, so the cursor is one. It is opaque
     * to the platform, which hands it back verbatim.
     */
    async list(ctx, { cursor, updatedSince, limit }): Promise<CatalogPage> {
      const page = toPage(cursor)
      const perPage = Math.min(limit ?? MAX_PER_PAGE, MAX_PER_PAGE)

      const query: Record<string, string | number> = {
        page,
        per_page: perPage,
        status: 'publish',
        // A stable sort is what makes paging safe: without it a product edited
        // mid-sync can shift pages and be read twice, or not at all.
        orderby: 'id',
        order: 'asc',
      }
      if (updatedSince) query.modified_after = toWooDate(updatedSince)

      const { body, headers } = await wooGet<WooProduct[]>(
        ctx,
        'products',
        query
      )
      const currency = await resolveCurrency(ctx)
      const items = body.map((product) => toProduct(product, currency))

      if (booleanSetting(ctx, 'WOOCOMMERCE_SYNC_VARIANTS')) {
        await attachVariants(ctx, items, currency)
      }

      return {
        items,
        // Bounded by the page count WooCommerce reports, so a shop that keeps
        // answering with products can never spin this into an endless sync.
        nextCursor: page < totalPagesFrom(headers) ? String(page + 1) : null,
        total: totalFrom(headers),
      }
    },

    /**
     * Used for webhook refreshes and to re-read price and stock immediately
     * before answering, so a card never quotes yesterday's price.
     */
    async get(ctx, ids): Promise<AdapterProduct[]> {
      const numeric = ids
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
      if (numeric.length === 0) return []

      const { body } = await wooGet<WooProduct[]>(ctx, 'products', {
        include: numeric.join(','),
        per_page: Math.min(numeric.length, MAX_PER_PAGE),
        // Not filtered by status: a product that went private since indexing
        // must come back so the platform learns it is gone.
        status: 'any',
      })

      const currency = await resolveCurrency(ctx)
      const items = body.map((product) => toProduct(product, currency))

      if (booleanSetting(ctx, 'WOOCOMMERCE_SYNC_VARIANTS')) {
        await attachVariants(ctx, items, currency)
      }

      return items
    },

    async categories(ctx): Promise<AdapterCategory[]> {
      const collected: AdapterCategory[] = []

      for (let page = 1; ; page++) {
        const { body, headers } = await wooGet<WooCategory[]>(
          ctx,
          'products/categories',
          { page, per_page: MAX_PER_PAGE, orderby: 'id', order: 'asc' }
        )

        collected.push(
          ...body.map((category) => ({
            id: String(category.id),
            name: category.name,
            url: `/?product_cat=${encodeURIComponent(category.slug)}`,
            parentId: category.parent > 0 ? String(category.parent) : null,
            count: category.count ?? null,
          }))
        )

        if (page >= totalPagesFrom(headers)) break
      }

      return collected
    },
  },

  cart: wooCart,

  navigation: {
    async resolve(ctx, target) {
      switch (target.kind) {
        case 'cart': {
          // The shop's own permalinks, as the mu-plugin published them in
          // `window.AgorAIStore`. WooCommerce lets both pages be moved, so a
          // hardcoded `/cart` is a guess.
          return { url: ctx.session('cartUrl') ?? '/cart' }
        }
        case 'checkout': {
          return { url: ctx.session('checkoutUrl') ?? '/checkout' }
        }
        case 'product': {
          return { url: await productUrl(ctx, target.id) }
        }
        case 'category': {
          return { url: await categoryUrl(ctx, target.id) }
        }
        case 'search': {
          const query = encodeURIComponent(target.query)
          return { url: `/?s=${query}&post_type=product` }
        }
        case 'page': {
          return { url: `/${target.slug.replace(/^\/+/, '')}` }
        }
      }
    },
  },

  customer: {
    /**
     * Never throws. An unreadable token means "this is a guest", and the chat
     * carries on without a name.
     */
    resolveIdentity(ctx, token) {
      const secret = setting(ctx, 'WP_IDENTITY_SECRET')
      if (secret.length === 0) return Promise.resolve(null)

      const result = verifyIdentity(secret, token)
      if (!result.ok) {
        // Logged, not raised: this is diagnostics for the shop admin, and it
        // must never turn a logged-out visitor's chat into an error.
        console.warn(
          `[woocommerce] identity rejected: ${describeFailure(result.reason)}`
        )
        return Promise.resolve(null)
      }

      return Promise.resolve({
        id: result.customerId,
        email: null,
        displayName: null,
      })
    },

    async listOrders(ctx, customerId, limit): Promise<AdapterOrderSummary[]> {
      const customer = Number.parseInt(customerId, 10)
      if (!Number.isInteger(customer) || customer <= 0) return []

      const configured = numericSetting(
        ctx,
        'CUSTOMER_ORDERS_LIMIT',
        DEFAULT_ORDERS_LIMIT
      )
      const wanted = Math.max(0, Math.min(limit, configured))
      if (wanted === 0) return []

      const { body } = await wooGet<WooOrder[]>(
        ctx,
        'orders',
        {
          customer,
          per_page: Math.min(wanted + STATUS_HEADROOM, MAX_PER_PAGE),
          orderby: 'date',
          order: 'desc',
          // Ask for the six fields we use rather than the whole order: an order
          // payload carries a billing address, and none of that belongs in a
          // prompt.
          _fields: ORDER_FIELDS,
        },
        ORDERS_TIMEOUT_MS
      )

      return body
        .filter((order) => USEFUL_ORDER_STATUSES.has(order.status))
        .slice(0, wanted)
        .map((order) => toOrderSummary(order))
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function productUrl(ctx: StoreContext, id: string): Promise<string> {
  const numeric = Number.parseInt(id, 10)
  // `/?p=<id>` is WordPress's permalink-independent form. It always resolves,
  // so it is the right thing to fall back to rather than an error.
  if (!Number.isInteger(numeric) || numeric <= 0) return `/?p=${id}`

  try {
    const { body } = await wooGet<WooProduct>(ctx, `products/${numeric}`, {
      _fields: 'permalink',
    })
    return body.permalink || `/?p=${numeric}`
  } catch {
    return `/?p=${numeric}`
  }
}

async function categoryUrl(ctx: StoreContext, id: string): Promise<string> {
  const numeric = Number.parseInt(id, 10)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return `/?product_cat=${encodeURIComponent(id)}`
  }

  try {
    const { body } = await wooGet<WooCategory>(
      ctx,
      `products/categories/${numeric}`,
      { _fields: 'slug' }
    )
    return `/?product_cat=${encodeURIComponent(body.slug)}`
  } catch {
    return `/?cat=${numeric}`
  }
}

async function canReadOrders(ctx: StoreContext): Promise<boolean> {
  try {
    await wooGet<WooOrder[]>(
      ctx,
      'orders',
      { per_page: 1, _fields: 'number' },
      ORDERS_TIMEOUT_MS
    )
    return true
  } catch {
    return false
  }
}

function toOrderSummary(order: WooOrder): AdapterOrderSummary {
  return {
    id: order.number,
    status: order.status,
    date: (order.date_created ?? '').slice(0, 10),
    total: order.total ? { amount: order.total, currency: order.currency } : null,
    items: (order.line_items ?? []).map((item) => ({
      name: item.name,
      sku: (item.sku ?? '').trim() || null,
      quantity: item.quantity,
    })),
  }
}

function toPage(cursor: string | undefined): number {
  const page = Number.parseInt(cursor ?? '1', 10)
  return Number.isInteger(page) && page > 0 ? page : 1
}

/** WooCommerce wants `modified_after` without a zone suffix. */
function toWooDate(iso: string): string {
  return iso.replace(/\.\d+/, '').replace(/Z$/, '')
}

void run(adapter)
