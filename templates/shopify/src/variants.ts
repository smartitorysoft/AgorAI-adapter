/**
 * Variants, which on Shopify are nearly free.
 *
 * The WooCommerce adapter has a whole concurrency window in its equivalent of
 * this file, because WooCommerce serves variations from a second endpoint and
 * reading them costs one HTTP request per variable product. Shopify returns
 * them nested inside the same `products` query, so there is no wave, no second
 * timeout and no per-product failure to swallow — only a query that asks for
 * more and therefore costs more points. That is why `SHOPIFY_SYNC_VARIANTS`
 * shrinks the page size rather than adding round trips.
 *
 * The floor is one variant, never zero. A single-variant product's default
 * variant is where its SKU, its price and its availability live, and it is what
 * the cart ends up adding — dropping to zero to save a point would leave the
 * catalogue unable to say whether anything is in stock.
 */
import type {
  AdapterProduct,
  AdapterProductVariant,
} from '@smartitory/agorai-adapter'

import { toScale } from './product'
import type { ShopifyProduct, ShopifyVariant } from './types'

/** Read this many variants per product when the shop asked for them. */
export const VARIANT_LIMIT = 100

/** And this many when it did not. Never zero. See the note above. */
export const DEFAULT_VARIANT_LIMIT = 1

export function attachVariants(
  items: AdapterProduct[],
  products: ShopifyProduct[],
  currency: string
): void {
  const byId = new Map(
    products.map((product) => [String(product.legacyResourceId ?? ''), product])
  )

  for (const item of items) {
    const product = byId.get(item.id)
    // Only variable products: a one-variant product's "variants" list is the
    // product again, and the platform would render a pointless picker.
    if (product?.hasOnlyDefaultVariant !== false) continue

    const variants = (product.variants?.nodes ?? []).map((variant) =>
      toVariant(variant, currency)
    )
    // Never an empty array: absent and empty mean different things to the
    // platform, and only one of them is true here.
    if (variants.length > 0) item.variants = variants
  }
}

export function toVariant(
  variant: ShopifyVariant,
  currency: string
): AdapterProductVariant {
  const options: Record<string, string> = {}
  for (const option of variant.selectedOptions ?? []) {
    const name = (option.name ?? '').trim()
    const value = (option.value ?? '').trim()
    if (name.length > 0 && value.length > 0) options[name] = value
  }

  const price = (variant.price ?? '').trim()

  return {
    id: String(variant.legacyResourceId ?? ''),
    sku: emptyToNull(variant.sku ?? ''),
    // Shopify's own variant title is already "L / Black", so it is only worth
    // rebuilding when it is missing or the placeholder a default variant gets.
    name: usableTitle(variant.title) ?? describe(options),
    price:
      price.length > 0 ? { amount: toScale(price, currency), currency } : null,
    inStock: variant.availableForSale === true,
    options,
  }
}

function usableTitle(title: string | undefined): string | null {
  const trimmed = (title ?? '').trim()
  if (trimmed.length === 0 || trimmed === 'Default Title') return null
  return trimmed
}

function describe(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ')
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
