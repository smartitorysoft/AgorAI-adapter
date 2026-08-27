/**
 * Variations, for the shops that sell one product in several sizes.
 *
 * WooCommerce models a variable product as a parent plus a `variations`
 * sub-resource, so there is no way to read them in the same call as the
 * catalogue page — it is one extra request **per variable product**. That cost
 * is the whole reason this is opt-in (`WOOCOMMERCE_SYNC_VARIANTS`): a shop with
 * two thousand variable products pays two thousand extra round trips on a full
 * sync, and a shop with none should never pay for the check.
 *
 * What the platform does with them is narrow and worth knowing before deciding
 * whether to turn this on. Only `simple` products can be added to a cart by the
 * bot — a variable product cannot be added without choosing a variation, and
 * guessing one on a shopper's behalf is how you sell the wrong size. Variants
 * therefore make a product *describable* ("comes in S, M and L, the L is out of
 * stock"), not purchasable. If the answers a shop needs never turn on size or
 * colour, this buys nothing.
 */
import type {
  AdapterProduct,
  AdapterProductVariant,
  StoreContext,
} from '@smartitory/agorai-adapter'

import { wooGet } from './client'
import type { WooVariation } from './types'

/** WooCommerce's own `per_page` ceiling. */
const MAX_VARIATIONS = 100

/**
 * How many variable products are read at once.
 *
 * Small on purpose. This runs during a catalogue sync, against a shop whose
 * other visitors are real people, and WooCommerce is not a fast API. Four keeps
 * a page of a hundred products to twenty-five sequential waves rather than a
 * hundred simultaneous requests, which is the shape that gets an adapter rate
 * limited or, worse, gets the shop's PHP-FPM pool exhausted.
 */
const CONCURRENCY = 4

/**
 * Variations are a per-variant read, so a slow one delays the whole sync page.
 * Shorter than the catalogue timeout because a missing variant list degrades a
 * product card, while a stalled sync blocks every product behind it.
 */
const TIMEOUT_MS = 8000

/**
 * Fills in `variants` on the variable products in `items`, in place.
 *
 * Never throws. A shop that refuses the variations endpoint — some security
 * plugins do — still gets its catalogue indexed, with the parent products
 * exactly as they arrive without this. Losing the sizes is a worse answer;
 * losing the sync is a broken product.
 */
export async function attachVariants(
  ctx: StoreContext,
  items: AdapterProduct[],
  currency: string
): Promise<void> {
  const variable = items.filter((item) => item.type === 'variable')
  if (variable.length === 0) return

  for (let index = 0; index < variable.length; index += CONCURRENCY) {
    const wave = variable.slice(index, index + CONCURRENCY)
    await Promise.all(
      wave.map(async (product) => {
        const variants = await readVariants(ctx, product.id, currency)
        if (variants.length > 0) product.variants = variants
      })
    )
  }
}

async function readVariants(
  ctx: StoreContext,
  productId: string,
  currency: string
): Promise<AdapterProductVariant[]> {
  try {
    const { body } = await wooGet<WooVariation[]>(
      ctx,
      `products/${productId}/variations`,
      { per_page: MAX_VARIATIONS, status: 'publish' },
      TIMEOUT_MS
    )
    return body.map((variation) => toVariant(variation, currency))
  } catch {
    // Deliberately silent per product. A shop with a plugin blocking this
    // endpoint would otherwise emit one warning per variable product per sync.
    return []
  }
}

export function toVariant(
  variation: WooVariation,
  currency: string
): AdapterProductVariant {
  const options: Record<string, string> = {}
  for (const attribute of variation.attributes ?? []) {
    const key = (attribute.name ?? '').trim()
    const value = (attribute.option ?? '').trim()
    // An empty option means "any" in WooCommerce — the variation matches every
    // value of that attribute. Recording it as an empty string would read as a
    // choice the shopper has to make and cannot.
    if (key.length > 0 && value.length > 0) options[key] = value
  }

  const price = (variation.price ?? '').trim()

  return {
    id: String(variation.id),
    sku: (variation.sku ?? '').trim() || null,
    // WooCommerce gives a variation no name of its own; what identifies it to a
    // shopper is the combination it stands for.
    name: describe(options),
    price: price.length > 0 ? { amount: price, currency } : null,
    inStock: variation.stock_status === 'instock',
    options,
  }
}

function describe(options: Record<string, string>): string | null {
  const parts = Object.entries(options).map(
    ([key, value]) => `${key}: ${value}`
  )
  return parts.length > 0 ? parts.join(', ') : null
}
