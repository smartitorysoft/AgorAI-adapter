/**
 * An AgorAI adapter for Shopify.
 *
 * Copy this project, set the values in `.env` (or leave them blank and fill
 * them in on the platform's Store screen), and deploy the container. Nothing in
 * here is specific to a vertical: the shop's own metafields, tags and options
 * arrive as `attributes` and the platform decides what they mean.
 *
 * If you are pointing a project at the shared, hosted Shopify adapter, you do
 * not need this at all. This template is for a shop that would rather host its
 * own — which also means pasting the theme snippet from the README by hand,
 * since a self-hosted adapter has no platform to serve downloads through.
 *
 * Everything here goes through the GraphQL Admin API. Shopify's REST product
 * endpoints are legacy and closed to new apps, and even in GraphQL the schema
 * moves quarterly — `featuredImage` and `Customer.email` are already deprecated
 * — so the version is pinned in `config.ts` and overridable per project.
 *
 * The two decisions worth knowing before reading the ports:
 *
 * - **A product is indexed under its bare numeric product id.** Not the GID,
 *   and not a product/variant pair, because a `products/delete` webhook carries
 *   only `{"id"}` and the platform prunes by exact id. The cart pays for that
 *   choice with one lookup, in `cart.ts`.
 * - **`hasOnlyDefaultVariant` decides `simple` vs `variable`.** Every Shopify
 *   product has at least one variant, so a variant count would make every
 *   product look variable and the advisor could never add anything to a cart.
 */
import {
  run,
  type AdapterCategory,
  type AdapterHealthResult,
  type AdapterOrderSummary,
  type AdapterProduct,
  type CatalogListOptions,
  type CatalogPage,
  defineAdapter,
  type NavigationResult,
  type NavigationTarget,
  type StoreContext,
} from '@smartitory/agorai-adapter'

import { shopifyCart } from './cart'
import { resolveCurrency, shopifyGraphQL, toGid } from './client'
import {
  booleanSetting,
  CONFIG,
  metafieldNamespace,
  numericSetting,
  setting,
  storefrontUrl,
} from './config'
import { describeFailure, verifyIdentity } from './identity'
import { attributeHints, toProduct } from './product'
import type { ShopifyCollection, ShopifyOrder, ShopifyProduct } from './types'
import {
  attachVariants,
  DEFAULT_VARIANT_LIMIT,
  VARIANT_LIMIT,
} from './variants'

/**
 * Products per page.
 *
 * Shopify prices a query by how much it returns and refuses one costing more
 * than 1000 points, where a connection costs roughly a point per node. A page
 * of 100 products each carrying 100 variants is therefore not a slow query, it
 * is a rejected one — hence two page sizes rather than one.
 */
const PAGE_SIZE = 100
const PAGE_SIZE_WITH_VARIANTS = 25

const COLLECTION_PAGE_SIZE = 250
const ATTRIBUTE_SAMPLE_SIZE = 20
const METAFIELD_LIMIT = 25
const COLLECTIONS_PER_PRODUCT = 10
const DEFAULT_ORDERS_LIMIT = 3
const ORDER_LINE_ITEMS = 20
const ORDERS_TIMEOUT_MS = 6000

/** Everything the catalogue reads about a product, in one place. */
const PRODUCT_FIELDS = `
  fragment AgorAIProduct on Product {
    legacyResourceId
    handle
    title
    status
    vendor
    productType
    tags
    updatedAt
    totalInventory
    tracksInventory
    hasOnlyDefaultVariant
    onlineStoreUrl
    description
    featuredMedia { preview { image { url } } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    options { name optionValues { name } }
    collections(first: ${COLLECTIONS_PER_PRODUCT}) { nodes { title } }
    metafields(first: ${METAFIELD_LIMIT}, namespace: $namespace) {
      nodes { namespace key type value }
    }
    variants(first: $variantLimit) {
      nodes {
        legacyResourceId
        sku
        title
        availableForSale
        inventoryQuantity
        price
        selectedOptions { name value }
      }
    }
  }`

const LIST_QUERY = `${PRODUCT_FIELDS}
  query AgorAIProducts(
    $first: Int!
    $after: String
    $search: String
    $variantLimit: Int!
    $namespace: String
  ) {
    products(first: $first, after: $after, query: $search, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ...AgorAIProduct }
    }
  }`

const COUNT_QUERY = `
  query AgorAIProductsCount($search: String) {
    productsCount(query: $search) { count }
  }`

const BY_IDS_QUERY = `${PRODUCT_FIELDS}
  query AgorAIProductsByIds(
    $ids: [ID!]!
    $variantLimit: Int!
    $namespace: String
  ) {
    nodes(ids: $ids) { ... on Product { ...AgorAIProduct } }
  }`

const HEALTH_QUERY = `${PRODUCT_FIELDS}
  query AgorAIHealth(
    $sample: Int!
    $variantLimit: Int!
    $namespace: String
  ) {
    shop {
      name
      currencyCode
      myshopifyDomain
      primaryDomain { url }
      enabledPresentmentCurrencies
    }
    productsCount(query: "status:active") { count }
    products(first: $sample, query: "status:active", sortKey: ID) {
      nodes { ...AgorAIProduct }
    }
  }`

const COLLECTIONS_QUERY = `
  query AgorAICollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { legacyResourceId title handle productsCount { count } }
    }
  }`

const ORDERS_QUERY = `
  query AgorAICustomerOrders($id: ID!, $first: Int!, $lineItems: Int!) {
    customer(id: $id) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: $lineItems) { nodes { title sku quantity } }
        }
      }
    }
  }`

const ORDERS_PROBE = `query AgorAIOrdersProbe { orders(first: 1) { nodes { id } } }`

/** Named, because a `do`/`while` cannot infer a type it is still building. */
type CollectionPage = {
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes?: ShopifyCollection[]
  }
}

export const adapter = defineAdapter({
  name: 'shopify',
  version: '1.0.0',
  displayName: { en: 'Shopify', hu: 'Shopify' },
  // No logo or brand colour: those are drawn on the platform's picker, and a
  // self-hosted adapter is connected as a custom one, which has its own card.
  documentationUrl: 'https://shopify.dev/docs/api/admin-graphql',

  config: CONFIG,

  capabilities: {
    incrementalSync: true,
    variants: true,
    navigation: ['cart', 'checkout', 'product', 'category', 'search', 'page'],
    // No webhook route in this template: mounting one means a `modules` option
    // on `run()` and a controller to authenticate it. See the hosted adapter's
    // `src/webhooks/` if instant reindexing is worth that.
    webhooks: false,
  },

  /**
   * One real call against the shop, and everything it can tell an admin.
   *
   * The most valuable line here is the storefront-origin warning. A shop that
   * typed its `.myshopify.com` address into both fields gets an advisor that
   * renders and a cart that silently does nothing, because every cart request
   * then crosses an origin holding none of the shopper's cookies — and nothing
   * else in the product would ever say so.
   */
  async health(ctx: StoreContext): Promise<AdapterHealthResult> {
    const { data } = await shopifyGraphQL<{
      shop: {
        name?: string
        currencyCode?: string
        primaryDomain?: { url?: string } | null
        enabledPresentmentCurrencies?: string[]
      }
      productsCount: { count?: number } | null
      products: { nodes?: ShopifyProduct[] }
    }>(ctx, 'AgorAIHealth', HEALTH_QUERY, {
      sample: ATTRIBUTE_SAMPLE_SIZE,
      variantLimit: variantLimit(ctx),
      namespace: metafieldNamespace(ctx),
    })

    const sample = data.products.nodes ?? []
    const warnings: string[] = []

    const declared = originOf(storefrontUrl(ctx))
    const actual = originOf(data.shop.primaryDomain?.url ?? '')
    if (declared && actual && declared !== actual) {
      warnings.push(
        `The storefront URL is ${declared}, but this shop serves pages from ` +
          `${actual}. The advisor will not be allowed to run there, and its ` +
          'cart requests will not carry the shopper’s session.'
      )
    }

    if (setting(ctx, 'SHOPIFY_IDENTITY_SECRET').length === 0) {
      warnings.push(
        'No identity secret is set, so every shopper is treated as a guest.'
      )
    } else if (!(await canReadOrders(ctx))) {
      warnings.push(
        'This access token cannot read orders, so the advisor sees no order ' +
          'history. Grant the read_orders scope to change that.'
      )
    }

    if (sample.length === 0) {
      warnings.push('The shop has no active products to index yet.')
    }

    if (
      !booleanSetting(ctx, 'SHOPIFY_SYNC_VARIANTS') &&
      sample.some((product) => product.hasOnlyDefaultVariant === false)
    ) {
      warnings.push(
        'This shop has products with several variants, and reading variants ' +
          'is off, so only each product’s lowest price is indexed.'
      )
    }

    if ((data.shop.enabledPresentmentCurrencies ?? []).length > 1) {
      warnings.push(
        'This shop sells in several currencies. The catalogue is indexed in ' +
          'one of them, so a shopper in another market may be quoted a ' +
          'different number in their cart.'
      )
    }

    return {
      ok: true,
      storeName: data.shop.name ?? null,
      productCount: data.productsCount?.count ?? null,
      currency: await resolveCurrency(ctx),
      warnings,
      productAttributes: attributeHints(sample),
    }
  },

  catalog: {
    async list(
      ctx: StoreContext,
      { cursor, updatedSince, limit }: CatalogListOptions
    ): Promise<CatalogPage> {
      const perPage = Math.min(limit ?? pageSize(ctx), pageSize(ctx))
      const search = searchFor(updatedSince)

      const { data } = await shopifyGraphQL<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes?: ShopifyProduct[]
        }
      }>(ctx, 'AgorAIProducts', LIST_QUERY, {
        first: perPage,
        after: cursor ?? null,
        search,
        variantLimit: variantLimit(ctx),
        namespace: metafieldNamespace(ctx),
      })

      const items = await toProducts(ctx, data.products.nodes ?? [])

      return {
        items,
        nextCursor: data.products.pageInfo.hasNextPage
          ? data.products.pageInfo.endCursor
          : null,
        // Only on the first page. It is a second query, and paying for it once
        // per page of a twenty-thousand-product sync buys nothing: the
        // platform wants it for a progress bar, which is drawn from the start.
        ...(cursor ? {} : { total: await countProducts(ctx, search) }),
      }
    },

    async get(ctx: StoreContext, ids: string[]): Promise<AdapterProduct[]> {
      const wanted = ids.map((id) => id.trim()).filter((id) => /^\d+$/.test(id))
      if (wanted.length === 0) return []

      const found: ShopifyProduct[] = []
      const chunk = pageSize(ctx)

      for (let index = 0; index < wanted.length; index += chunk) {
        const batch = wanted.slice(index, index + chunk)

        const { data } = await shopifyGraphQL<{
          nodes?: Array<ShopifyProduct | null>
        }>(ctx, 'AgorAIProductsByIds', BY_IDS_QUERY, {
          ids: batch.map((id) => toGid('Product', id)),
          variantLimit: variantLimit(ctx),
          namespace: metafieldNamespace(ctx),
        })

        // A null is a product that no longer exists, which is an answer and not
        // an error: the platform reads the gap as "deleted" and drops it from
        // the index. Not filtered by status either — a product that went draft
        // since indexing must come back so the platform learns it is gone.
        for (const node of data.nodes ?? []) if (node) found.push(node)
      }

      return toProducts(ctx, found)
    },

    async categories(ctx: StoreContext): Promise<AdapterCategory[]> {
      const categories: AdapterCategory[] = []
      let cursor: string | null = null

      do {
        const page: CollectionPage = await shopifyGraphQL<CollectionPage>(
          ctx,
          'AgorAICollections',
          COLLECTIONS_QUERY,
          { first: COLLECTION_PAGE_SIZE, after: cursor }
        ).then((result) => result.data)

        for (const node of page.collections.nodes ?? []) {
          categories.push({
            id: String(node.legacyResourceId ?? ''),
            name: node.title ?? '',
            url: node.handle ? `/collections/${node.handle}` : null,
            // Shopify collections are flat. There is no parent to report, and
            // inventing one from a title prefix would be a guess.
            parentId: null,
            count: node.productsCount?.count ?? null,
          })
        }

        cursor = page.collections.pageInfo.hasNextPage
          ? page.collections.pageInfo.endCursor
          : null
      } while (cursor)

      return categories
    },
  },

  cart: shopifyCart,

  navigation: {
    async resolve(
      ctx: StoreContext,
      target: NavigationTarget
    ): Promise<NavigationResult> {
      switch (target.kind) {
        case 'cart': {
          return { url: ctx.session('cartUrl') ?? '/cart' }
        }
        case 'checkout': {
          return { url: ctx.session('checkoutUrl') ?? '/checkout' }
        }
        case 'product': {
          return { url: await productUrl(ctx, target.id) }
        }
        case 'category': {
          return { url: await collectionUrl(ctx, target.id) }
        }
        case 'search': {
          return { url: `/search?q=${encodeURIComponent(target.query)}` }
        }
        case 'page': {
          return { url: `/pages/${target.slug.replace(/^\/+/, '')}` }
        }
      }
    },
  },

  customer: {
    /**
     * Never throws, and never says why to the shopper. A bad token is a guest,
     * and a guest chat is a working chat.
     */
    async resolveIdentity(ctx: StoreContext, token: string) {
      const secret = setting(ctx, 'SHOPIFY_IDENTITY_SECRET')
      if (secret.length === 0 || token.trim().length === 0) {
        return null
      }

      const result = verifyIdentity(secret, token)
      if (!result.ok) {
        console.warn(
          `[shopify] identity rejected: ${describeFailure(result.reason)}`
        )
        return null
      }

      // No email and no name on purpose: both are protected customer data on
      // Shopify, needing an approval this adapter should not depend on, and
      // the platform only ever needs the id.
      return {
        id: result.customerId,
        email: null,
        displayName: null,
      }
    },

    async listOrders(
      ctx: StoreContext,
      customerId: string,
      limit: number
    ): Promise<AdapterOrderSummary[]> {
      const configured = numericSetting(
        ctx,
        'CUSTOMER_ORDERS_LIMIT',
        DEFAULT_ORDERS_LIMIT
      )
      const wanted = Math.max(0, Math.min(limit, configured))
      if (wanted === 0 || !/^\d+$/.test(customerId)) return []

      try {
        const { data } = await shopifyGraphQL<{
          customer: { orders?: { nodes?: ShopifyOrder[] } } | null
        }>(
          ctx,
          'AgorAICustomerOrders',
          ORDERS_QUERY,
          {
            id: toGid('Customer', customerId),
            // Over-fetch a little: cancelled orders are dropped below and would
            // otherwise silently shorten the list.
            first: wanted + 2,
            lineItems: ORDER_LINE_ITEMS,
          },
          ORDERS_TIMEOUT_MS
        )

        return (data.customer?.orders?.nodes ?? [])
          .filter((order) => !order.cancelledAt)
          .slice(0, wanted)
          .map((order) => toOrderSummary(order))
      } catch (error) {
        // A shop that has not granted read_orders, or whose history is older
        // than Shopify serves by default. `health()` says so properly; here it
        // must not take a shopper's whole answer down with it.
        console.warn(
          `[shopify] orders unavailable: ${(error as Error).message}`
        )
        return []
      }
    },
  },
})

async function toProducts(
  ctx: StoreContext,
  products: ShopifyProduct[]
): Promise<AdapterProduct[]> {
  if (products.length === 0) return []

  const currency = await resolveCurrency(ctx)
  const storefront = storefrontUrl(ctx)
  const items = products.map((product) =>
    toProduct(product, currency, storefront)
  )

  if (booleanSetting(ctx, 'SHOPIFY_SYNC_VARIANTS')) {
    attachVariants(items, products, currency)
  }

  return items
}

/**
 * Shopify's search syntax, which is also the incremental-sync filter.
 *
 * `status:active` rather than `published_status`: a draft product is one the
 * shop is still writing, and recommending it sends a shopper to a 404.
 */
function searchFor(updatedSince: string | undefined): string {
  return updatedSince
    ? `status:active AND updated_at:>'${updatedSince}'`
    : 'status:active'
}

async function countProducts(
  ctx: StoreContext,
  search: string
): Promise<number | undefined> {
  try {
    const { data } = await shopifyGraphQL<{
      productsCount: { count?: number } | null
    }>(ctx, 'AgorAIProductsCount', COUNT_QUERY, { search })
    return data.productsCount?.count ?? undefined
  } catch {
    // A progress total is a nicety. Failing the page over it is not.
    return undefined
  }
}

function pageSize(ctx: StoreContext): number {
  return booleanSetting(ctx, 'SHOPIFY_SYNC_VARIANTS')
    ? PAGE_SIZE_WITH_VARIANTS
    : PAGE_SIZE
}

function variantLimit(ctx: StoreContext): number {
  return booleanSetting(ctx, 'SHOPIFY_SYNC_VARIANTS')
    ? VARIANT_LIMIT
    : DEFAULT_VARIANT_LIMIT
}

async function canReadOrders(ctx: StoreContext): Promise<boolean> {
  try {
    await shopifyGraphQL(
      ctx,
      'AgorAIOrdersProbe',
      ORDERS_PROBE,
      {},
      ORDERS_TIMEOUT_MS
    )
    return true
  } catch {
    return false
  }
}

/**
 * A shopper-facing product URL.
 *
 * Shopify routes products by handle, never by id, so there is no id-shaped
 * fallback the way WordPress has `/?p=123` — a product whose handle cannot be
 * read is better sent to the shop's front page than to a 404.
 */
async function productUrl(ctx: StoreContext, id: string): Promise<string> {
  try {
    const { data } = await shopifyGraphQL<{
      product: { handle?: string; onlineStoreUrl?: string | null } | null
    }>(
      ctx,
      'AgorAIProductHandle',
      `query AgorAIProductHandle($id: ID!) {
         product(id: $id) { handle onlineStoreUrl }
       }`,
      { id: toGid('Product', id) }
    )

    const online = data.product?.onlineStoreUrl
    if (online) return online
    if (data.product?.handle) return `/products/${data.product.handle}`
  } catch {
    // Fall through.
  }
  return '/'
}

/**
 * A collection URL, from either of the two things that reach this.
 *
 * The platform passes whatever it holds as a category: an id from
 * `catalog.categories`, or — as the contract suite does — a *title* taken off a
 * product. Both are answered, and neither is allowed to throw.
 */
async function collectionUrl(ctx: StoreContext, id: string): Promise<string> {
  const search = /^\d+$/.test(id)
    ? null
    : `title:'${id.replaceAll("'", String.raw`\'`)}'`

  try {
    if (search === null) {
      const { data } = await shopifyGraphQL<{
        collection: { handle?: string } | null
      }>(
        ctx,
        'AgorAICollectionHandle',
        `query AgorAICollectionHandle($id: ID!) {
           collection(id: $id) { handle }
         }`,
        { id: toGid('Collection', id) }
      )
      if (data.collection?.handle)
        return `/collections/${data.collection.handle}`
    } else {
      const { data } = await shopifyGraphQL<{
        collections: { nodes?: Array<{ handle?: string }> }
      }>(
        ctx,
        'AgorAICollectionByTitle',
        `query AgorAICollectionByTitle($search: String!) {
           collections(first: 1, query: $search) { nodes { handle } }
         }`,
        { search }
      )
      const handle = data.collections.nodes?.[0]?.handle
      if (handle) return `/collections/${handle}`
    }
  } catch {
    // Fall through.
  }

  return `/search?q=${encodeURIComponent(id)}`
}

function toOrderSummary(order: ShopifyOrder): AdapterOrderSummary {
  const money = order.totalPriceSet?.shopMoney
  return {
    id: order.name ?? '',
    status: (
      order.displayFulfillmentStatus ??
      order.displayFinancialStatus ??
      ''
    ).toLowerCase(),
    date: (order.createdAt ?? '').slice(0, 10),
    total:
      money?.amount && money.currencyCode
        ? { amount: money.amount, currency: money.currencyCode }
        : null,
    items: (order.lineItems?.nodes ?? []).map((item) => ({
      name: item.title ?? '',
      sku: (item.sku ?? '').trim() || null,
      quantity: item.quantity ?? 0,
    })),
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

void run(adapter)
