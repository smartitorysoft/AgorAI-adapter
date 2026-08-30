/**
 * A Shopify product, as the platform understands products.
 *
 * The interesting half is `attributes`. Shopify keeps a shop's own vocabulary
 * in four different places — `vendor`, `productType`, `tags`, the variant
 * options, and metafields — and none of them mean anything fixed: one shop's
 * `custom.ph_level` is another's `custom.reading_age`. All of it is emitted
 * verbatim under its own key, and the shop admin decides on the platform's
 * Products screen which keys are embedded, shown on a card, or used to exclude
 * a product. Interpreting any of them here is the mistake this whole design
 * exists to avoid.
 *
 * This file also owns money, for both APIs, because they disagree. The Admin
 * API sends decimal strings at the currency's own scale (`"3490.00"`); the
 * storefront's Ajax cart sends integers in hundredths **whatever the currency
 * is**, so ¥1000 arrives as `100000`. `toScale` and `fromMinorUnits` are the
 * two ends of that, and `cart.ts` imports them rather than growing a second
 * opinion.
 */
import type {
  AdapterProduct,
  ProductAttributeHint,
} from '@smartitory/agorai-adapter'

import type { ShopifyMetafield, ShopifyProduct } from './types'

/** Shopify quotes cart money in hundredths regardless of the currency. */
const AJAX_MINOR_UNITS = 100

export function toProduct(
  product: ShopifyProduct,
  currency: string,
  storefrontUrl: string
): AdapterProduct {
  const variants = product.variants?.nodes ?? []
  const first = variants[0]

  return {
    id: String(product.legacyResourceId ?? ''),
    sku: emptyToNull(first?.sku ?? ''),
    name: product.title ?? '',
    // Null when the product is not published to the Online Store channel, which
    // is a real state and not an error — but a card with no link is a dead end,
    // so the handle route is tried first.
    url:
      emptyToNull(product.onlineStoreUrl ?? '') ??
      (product.handle ? `${storefrontUrl}/products/${product.handle}` : null),
    imageUrl: emptyToNull(product.featuredMedia?.preview?.image?.url ?? ''),
    price: toPrice(product.priceRangeV2?.minVariantPrice?.amount, currency),
    inStock: inStock(product),
    stockStatus: inStock(product) ? 'instock' : 'outofstock',
    // The platform only lets a `simple` product be added to a cart, because
    // adding a variable one means choosing a size on the shopper's behalf.
    // Every Shopify product has at least one variant, so this flag — not the
    // variant count — is what makes that distinction mean the right thing.
    type: product.hasOnlyDefaultVariant === false ? 'variable' : 'simple',
    categories: (product.collections?.nodes ?? [])
      .map((node) => node.title ?? '')
      .filter((title) => title.length > 0),
    description: emptyToNull(stripHtml(product.description ?? '')),
    attributes: toAttributes(product),
    updatedAt: emptyToNull(product.updatedAt ?? ''),
  }
}

/**
 * Everything this shop says about the product that is not a fixed field.
 *
 * Metafields first and never overwritten, the same precedence the WooCommerce
 * adapter gives meta over attributes: a shop that has deliberately defined
 * `custom.vendor` means that one, not the built-in field of the same name.
 */
export function toAttributes(
  product: ShopifyProduct
): Record<string, string | string[]> {
  const attributes: Record<string, string | string[]> = {}

  for (const metafield of product.metafields?.nodes ?? []) {
    const key = metafieldKey(metafield)
    const value = metafieldValue(metafield)
    if (key.length > 0 && value !== null) attributes[key] = value
  }

  const put = (key: string, value: string | string[] | null): void => {
    if (value === null || key in attributes) return
    attributes[key] = value
  }

  put('vendor', emptyToNull(product.vendor ?? ''))
  put('product_type', emptyToNull(product.productType ?? ''))
  put('tags', listOrNull(product.tags ?? []))

  for (const option of product.options ?? []) {
    const name = slugify(option.name ?? '')
    if (name.length === 0) continue
    put(
      name,
      listOrNull(
        (option.optionValues ?? [])
          .map((value) => stripHtml(value.name ?? ''))
          .filter((value) => value.length > 0)
      )
    )
  }

  return attributes
}

/**
 * What the platform should offer the shop admin as this store's attributes.
 *
 * Read from a live sample rather than declared in the manifest, because the
 * manifest is served before any credentials exist and a shop's metafields are
 * its own. Everything is suggested for the embedding and nothing for the card:
 * a card with nine lines of metadata on it helps nobody, and turning one on is
 * a click.
 */
export function attributeHints(
  products: ShopifyProduct[]
): ProductAttributeHint[] {
  const kinds = new Map<string, ProductAttributeHint['kind']>()

  for (const product of products) {
    for (const [key, value] of Object.entries(toAttributes(product))) {
      const kind = Array.isArray(value)
        ? 'list'
        : Number.isFinite(Number(value)) && value.trim().length > 0
          ? 'number'
          : 'text'
      // A key seen once as a list is a list: a single-valued sample of a
      // multi-valued field is the common case, not evidence of a scalar.
      if (kinds.get(key) !== 'list') kinds.set(key, kind)
    }
  }

  return [...kinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, kind]) => ({
      key,
      label: { en: humanize(key) },
      kind,
      suggestEmbedding: true,
      suggestOnCard: false,
    }))
}

/**
 * How many decimal places this currency actually has.
 *
 * ICU is the only place that number exists: Shopify does not publish it in
 * either API, and a hardcoded list of the zero-decimal currencies ages badly.
 */
export function currencyScale(currency: string): number {
  try {
    const resolved = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions()
    return resolved.maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** An Admin API decimal string, at the currency's own scale. */
export function toScale(amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return amount
  return value.toFixed(currencyScale(currency))
}

/** An Ajax cart integer — always hundredths — at the currency's own scale. */
export function fromMinorUnits(value: number, currency: string): string {
  return (value / AJAX_MINOR_UNITS).toFixed(currencyScale(currency))
}

/**
 * Shopify's `description` is documented as tag-free, and is not reliably so:
 * entities survive it, and a shop pasting markup into a plain-text field is
 * ordinary. This text is embedded, and tag soup costs tokens and dilutes the
 * vector.
 */
export function stripHtml(value: string): string {
  return value
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/&#0?39;/g, "'")
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function inStock(product: ShopifyProduct): boolean {
  const variants = product.variants?.nodes ?? []
  if (variants.length > 0) {
    return variants.some((variant) => variant.availableForSale === true)
  }
  // A shop that does not track inventory sells everything it lists.
  if (product.tracksInventory === false) return true
  return (product.totalInventory ?? 0) > 0
}

function toPrice(
  amount: string | undefined,
  currency: string
): AdapterProduct['price'] {
  const trimmed = (amount ?? '').trim()
  if (trimmed.length === 0) return null
  // Kept as a string all the way through. Money does not survive IEEE-754, and
  // the platform passes this straight to a shopper.
  return { amount: toScale(trimmed, currency), currency }
}

function metafieldKey(metafield: ShopifyMetafield): string {
  const namespace = (metafield.namespace ?? '').trim()
  const key = (metafield.key ?? '').trim()
  if (key.length === 0) return ''
  return namespace.length > 0 ? `${namespace}.${key}` : key
}

function metafieldValue(metafield: ShopifyMetafield): string | string[] | null {
  const raw = (metafield.value ?? '').trim()
  if (raw.length === 0) return null

  const type = metafield.type ?? ''
  if (type.startsWith('list.')) {
    // A list metafield's value is a JSON array in a string. A malformed one is
    // a shop's own data problem and must not take a sync down.
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      return listOrNull(
        parsed
          .map((item) => (typeof item === 'string' ? stripHtml(item) : ''))
          .filter((item) => item.length > 0)
      )
    } catch {
      return null
    }
  }

  // Structured types are app internals rendered as JSON blobs; embedding one
  // is pure noise.
  if (type === 'json') return null

  return emptyToNull(stripHtml(raw))
}

function listOrNull(values: string[]): string[] | null {
  return values.length > 0 ? values : null
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}

function humanize(key: string): string {
  const words = key.replaceAll(/[_-]+/g, ' ').replaceAll('.', ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
