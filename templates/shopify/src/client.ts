/**
 * One request shape for the whole Admin API.
 *
 * Shopify's REST Admin API has been legacy since late 2024 and its product
 * endpoints were withdrawn from new apps entirely, so there is exactly one door
 * here — `POST /admin/api/{version}/graphql.json` with an access token header.
 * That makes this file far smaller than the WooCommerce adapter's, which has to
 * carry two authentication schemes because a shop on plain `http://` cannot use
 * Basic auth.
 *
 * **The thing to know before changing anything below: a throttled Shopify
 * request answers HTTP 200.** The body carries `errors[0].extensions.code ===
 * 'THROTTLED'` and the response is otherwise indistinguishable from a success,
 * so `response.ok` is not the question — the body is. The same is true of a
 * missing OAuth scope, which arrives as a 200 with `ACCESS_DENIED` and must
 * become an `AdapterUnauthorizedError`, or the Store screen tells a shop admin
 * their shop is down when the real answer is "tick read_orders".
 */
import {
  AdapterNotFoundError,
  AdapterRateLimitedError,
  AdapterUnauthorizedError,
  AdapterUpstreamError,
  type StoreContext,
} from '@smartitory/agorai-adapter'

import { credentials, setting } from './config'
import type {
  ShopifyCost,
  ShopifyGraphQLBody,
  ShopifyGraphQLError,
  ShopifyShop,
} from './types'

const DEFAULT_TIMEOUT_MS = 20_000
const CURRENCY_TTL_MS = 60 * 60 * 1000
const FALLBACK_CURRENCY = 'EUR'
const MIN_RETRY_SECONDS = 1
const MAX_RETRY_SECONDS = 60
const DEFAULT_RETRY_SECONDS = 2

/**
 * Keyed by shop domain rather than by project: two projects pointing at the
 * same shop are the same shop, and the value is a property of the store rather
 * than of anybody's configuration.
 */
const currencyCache = new Map<string, { code: string; readAt: number }>()

export type ShopifyResult<T> = { data: T; cost: ShopifyCost | undefined }

export async function shopifyGraphQL<T>(
  ctx: StoreContext,
  operation: string,
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ShopifyResult<T>> {
  const auth = credentials(ctx)
  const url = `${auth.adminUrl}/admin/api/${auth.apiVersion}/graphql.json`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': auth.adminToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new AdapterUpstreamError(
      'The Shopify store did not respond.',
      `${operation}: ${(error as Error).message}`
    )
  }

  if (!response.ok)
    throw await statusError(response, operation, auth.apiVersion)

  const body = (await response.json()) as ShopifyGraphQLBody<T>
  const cost = body.extensions?.cost

  const failure = body.errors?.[0]
  if (failure) throw graphQLError(failure, operation, cost)

  if (!body.data) {
    throw new AdapterUpstreamError(
      'Shopify answered without any data.',
      operation
    )
  }

  return { data: body.data, cost }
}

/**
 * The shop's own name and currency, and the domain it actually sells under.
 *
 * `null` rather than a throw: a health check that cannot read this is still
 * worth reporting on, and every caller has something sensible to do without it.
 */
export async function readShop(ctx: StoreContext): Promise<ShopifyShop | null> {
  try {
    const { data } = await shopifyGraphQL<{ shop: ShopifyShop }>(
      ctx,
      'AgorAIShop',
      `query AgorAIShop {
         shop {
           name
           currencyCode
           myshopifyDomain
           primaryDomain { url }
           enabledPresentmentCurrencies
         }
       }`
    )
    return data.shop
  } catch {
    return null
  }
}

/**
 * The currency prices are indexed in.
 *
 * The override wins, then the cache, then the shop. Unlike WooCommerce there is
 * no plausible way for this lookup to be blocked — it is the same token and the
 * same endpoint as everything else — so the override exists for shops selling
 * in several currencies rather than as an escape hatch from a broken read.
 */
export async function resolveCurrency(ctx: StoreContext): Promise<string> {
  const override = setting(ctx, 'SHOPIFY_CURRENCY').toUpperCase()
  if (override.length > 0) return override

  const key = credentials(ctx).adminUrl
  const cached = currencyCache.get(key)
  if (cached && Date.now() - cached.readAt < CURRENCY_TTL_MS) return cached.code

  const shop = await readShop(ctx)
  const code = shop?.currencyCode ?? FALLBACK_CURRENCY
  currencyCache.set(key, { code, readAt: Date.now() })
  return code
}

/** The resources this adapter addresses by id. */
export type ShopifyResource =
  'Product' | 'ProductVariant' | 'Collection' | 'Customer'

/** `123` -> `gid://shopify/Product/123`. */
export function toGid(kind: ShopifyResource, id: string): string {
  return `gid://shopify/${kind}/${id}`
}

async function statusError(
  response: Response,
  operation: string,
  apiVersion: string
): Promise<Error> {
  return response
    .text()
    .catch(() => '')
    .then((text) => {
      const detail = `${operation}: ${text.slice(0, 300)}`
      switch (response.status) {
        case 401:
        case 403: {
          logDetail('unauthorized', detail)
          return new AdapterUnauthorizedError(
            'Shopify rejected the Admin API access token.'
          )
        }
        case 402:
        case 423: {
          return new AdapterUpstreamError(
            'This Shopify store is frozen or locked.',
            detail
          )
        }
        case 404: {
          logDetail('not found', detail)
          return new AdapterNotFoundError(
            `Shopify has no Admin API at version ${apiVersion}.`
          )
        }
        case 429: {
          const header = Number(response.headers.get('retry-after'))
          return new AdapterRateLimitedError(
            'Shopify is rate limiting this adapter.',
            Number.isFinite(header) && header > 0
              ? header
              : DEFAULT_RETRY_SECONDS
          )
        }
        default: {
          return new AdapterUpstreamError(
            `Shopify answered ${response.status}.`,
            detail
          )
        }
      }
    })
}

function graphQLError(
  failure: ShopifyGraphQLError,
  operation: string,
  cost: ShopifyCost | undefined
): Error {
  const message = failure.message ?? 'Shopify rejected the query.'
  const code = failure.extensions?.code ?? ''

  if (code === 'THROTTLED') {
    return new AdapterRateLimitedError(
      'Shopify is rate limiting this adapter.',
      throttleDelaySeconds(cost)
    )
  }
  if (
    code === 'ACCESS_DENIED' ||
    /access denied|merchant approval/i.test(message)
  ) {
    logDetail('access denied', operation)
    return new AdapterUnauthorizedError(message)
  }
  return new AdapterUpstreamError(
    'Shopify rejected the query.',
    `${operation}: ${message}`
  )
}

/**
 * Where a detail goes when the error class has nowhere to put one.
 *
 * `AdapterUnauthorizedError` and `AdapterNotFoundError` carry a message and
 * nothing else, by design — what they mean is already the whole answer. The
 * upstream text is still worth having when somebody is working out *why* a
 * token was refused, so it is logged here rather than dropped.
 */
function logDetail(kind: string, detail: string): void {
  console.warn(`[shopify] ${kind}: ${detail}`)
}

/**
 * How long until the query would fit in the bucket again.
 *
 * Shopify's limit is a leaky bucket measured in query cost, and it hands back
 * everything needed to answer this exactly: what the query asked for, what is
 * left, and how fast it refills. Guessing a flat delay instead either wastes
 * time or walks straight into a second throttle.
 */
function throttleDelaySeconds(cost: ShopifyCost | undefined): number {
  const status = cost?.throttleStatus
  const restoreRate = status?.restoreRate ?? 0
  if (restoreRate <= 0) return DEFAULT_RETRY_SECONDS

  const needed =
    (cost?.requestedQueryCost ?? 0) - (status?.currentlyAvailable ?? 0)
  if (needed <= 0) return MIN_RETRY_SECONDS

  return Math.min(MAX_RETRY_SECONDS, Math.ceil(needed / restoreRate))
}
