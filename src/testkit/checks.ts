import {
  buildManifest,
  isClientCart,
  type StoreContext,
  type AdapterProduct,
  type CartRecipe,
  type AgorAIAdapter,
  type NavigationKind,
} from '..'
import type { CheckResult, ContractCheckOptions } from './types'

const DEFAULT_MAX_PAGES = 20
const DEFAULT_MIN_PRODUCTS = 1

/** A deliberately invalid identity token: no store should ever accept it. */
const GARBAGE_IDENTITY = 'not-a-real-identity-token.0.deadbeef'

export type CheckContext = {
  adapter: AgorAIAdapter
  ctx: StoreContext
  options: ContractCheckOptions
  /** Products discovered by the catalogue check, reused by later checks. */
  products: AdapterProduct[]
}

type Check = {
  name: string
  run(context: CheckContext): Promise<CheckResult> | CheckResult
}

function pass(name: string, message?: string): CheckResult {
  return { name, status: 'pass', ...(message ? { message } : {}) }
}

function fail(name: string, message: string): CheckResult {
  return { name, status: 'fail', message }
}

function skip(name: string, message: string): CheckResult {
  return { name, status: 'skip', message }
}

const manifestCheck: Check = {
  name: 'manifest is well-formed',
  run({ adapter }) {
    const manifest = buildManifest(adapter)
    const problems: string[] = []

    if (!manifest.displayName.en)
      problems.push('displayName has no English text')
    if (manifest.contractVersion < 1)
      problems.push('contractVersion is not set')

    for (const field of manifest.configSchema) {
      if (!field.label.en)
        problems.push(`config "${field.key}" has no English label`)
      if (field.type === 'select' && !field.options?.length) {
        problems.push(`config "${field.key}" is a select with no options`)
      }
    }

    const { navigation } = manifest.capabilities
    if (navigation.supported && navigation.kinds.length === 0) {
      problems.push(
        'a navigation port is present but declares no kinds, so the bot can never use it'
      )
    }

    /*
     * Not fatal, but worth saying out loud: without it the platform cannot
     * authorise the shop's own origin to embed the widget, and the shop admin
     * has to work out why the advisor never appears on their site.
     */
    if (!manifest.configSchema.some((field) => field.role === 'storeUrl')) {
      problems.push(
        "no config field carries role 'storeUrl', so the platform cannot " +
          "authorise the shop's origin to embed the widget"
      )
    }

    return problems.length === 0
      ? pass(
          manifestCheck.name,
          `${manifest.configSchema.length} config field(s)`
        )
      : fail(manifestCheck.name, problems.join('; '))
  },
}

const configCheck: Check = {
  name: 'supplied config satisfies the declared schema',
  run({ adapter, options }) {
    const manifest = buildManifest(adapter)
    const missing = manifest.configSchema
      .filter((field) => field.required)
      .map((field) => field.key)
      .filter((key) => {
        const value = options.context.config[key]
        return value === undefined || value.trim().length === 0
      })

    return missing.length === 0
      ? pass(configCheck.name)
      : fail(
          configCheck.name,
          `required config not supplied to the test: ${missing.join(', ')}`
        )
  },
}

const healthCheck: Check = {
  name: 'health check reaches the store',
  async run({ adapter, ctx }) {
    if (!adapter.health) {
      return skip(healthCheck.name, 'adapter declares no health()')
    }
    const result = await adapter.health(ctx)
    return result.ok
      ? pass(
          healthCheck.name,
          [
            result.storeName,
            result.productCount && `${result.productCount} products`,
          ]
            .filter(Boolean)
            .join(', ') || undefined
        )
      : fail(healthCheck.name, 'health() reported ok: false')
  },
}

/**
 * The check that catches the most real bugs. A `nextCursor` that never goes
 * null turns a nightly index into an infinite loop against someone's store.
 */
const paginationCheck: Check = {
  name: 'catalogue pagination terminates',
  async run(context) {
    const { adapter, ctx, options } = context
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    const seen = new Set<string>()
    const cursors = new Set<string>()

    let cursor: string | undefined
    let pages = 0

    do {
      const page = await adapter.catalog.list(ctx, cursor ? { cursor } : {})
      pages += 1

      for (const product of page.items) {
        if (seen.has(product.id)) {
          return fail(
            paginationCheck.name,
            `product id "${product.id}" was returned on more than one page`
          )
        }
        seen.add(product.id)
        context.products.push(product)
      }

      cursor = page.nextCursor ?? undefined
      if (cursor) {
        if (cursors.has(cursor)) {
          return fail(
            paginationCheck.name,
            `cursor "${cursor}" repeated — pagination is looping`
          )
        }
        cursors.add(cursor)
      }
    } while (cursor && pages < maxPages)

    if (cursor) {
      return fail(
        paginationCheck.name,
        `still paging after ${maxPages} pages; nextCursor never became null`
      )
    }

    const minimum = options.minProducts ?? DEFAULT_MIN_PRODUCTS
    return seen.size >= minimum
      ? pass(
          paginationCheck.name,
          `${seen.size} product(s) over ${pages} page(s)`
        )
      : fail(
          paginationCheck.name,
          `expected at least ${minimum} product(s), got ${seen.size}`
        )
  },
}

const productShapeCheck: Check = {
  name: 'products are well-formed',
  run({ products }) {
    if (products.length === 0) {
      return skip(productShapeCheck.name, 'no products to inspect')
    }

    const problems: string[] = []
    for (const product of products.slice(0, 50)) {
      if (!product.id) problems.push('a product has an empty id')
      if (!product.name) problems.push(`product "${product.id}" has no name`)
      if (product.price && !/^-?\d+(\.\d+)?$/.test(product.price.amount)) {
        problems.push(
          `product "${product.id}" has a non-decimal price "${product.price.amount}" — ` +
            'money must be a decimal string, not a formatted or floating value'
        )
      }
      if (product.price && !product.price.currency) {
        problems.push(`product "${product.id}" has a price with no currency`)
      }
      if (product.description?.includes('<')) {
        problems.push(
          `product "${product.id}" description still contains markup; it is embedded as plain text`
        )
      }
    }

    return problems.length === 0
      ? pass(productShapeCheck.name, `${products.length} inspected`)
      : fail(
          productShapeCheck.name,
          [...new Set(problems)].slice(0, 5).join('; ')
        )
  },
}

const getRoundTripCheck: Check = {
  name: 'catalog.get round-trips ids from catalog.list',
  async run({ adapter, ctx, products }) {
    if (products.length === 0) {
      return skip(getRoundTripCheck.name, 'no products to fetch')
    }
    const wanted = products.slice(0, 3).map((product) => product.id)
    const fetched = await adapter.catalog.get(ctx, wanted)
    const returned = new Set(fetched.map((product) => product.id))
    const missing = wanted.filter((id) => !returned.has(id))

    return missing.length === 0
      ? pass(getRoundTripCheck.name, `${wanted.length} id(s)`)
      : fail(
          getRoundTripCheck.name,
          `ids listed but not retrievable: ${missing.join(', ')}`
        )
  },
}

const categoriesCheck: Check = {
  name: 'categories resolve when declared',
  async run({ adapter, ctx }) {
    const manifest = buildManifest(adapter)
    if (!manifest.capabilities.catalog.categories) {
      return skip(categoriesCheck.name, 'not declared')
    }
    const { categories: listCategories } = adapter.catalog
    if (!listCategories) {
      return fail(
        categoriesCheck.name,
        'manifest declares categories but catalog.categories is missing'
      )
    }
    const categories = await listCategories(ctx)
    const unnamed = categories.filter(
      (category) => !category.id || !category.name
    )
    return unnamed.length === 0
      ? pass(categoriesCheck.name, `${categories.length} categor(y|ies)`)
      : fail(
          categoriesCheck.name,
          `${unnamed.length} category rows lack an id or name`
        )
  },
}

const navigationCheck: Check = {
  name: 'every declared navigation kind resolves',
  async run({ adapter, ctx, products }) {
    const manifest = buildManifest(adapter)
    const { navigation } = adapter
    if (!manifest.capabilities.navigation.supported || !navigation) {
      return skip(navigationCheck.name, 'no navigation port')
    }

    const problems: string[] = []
    for (const kind of manifest.capabilities.navigation.kinds) {
      const target = sampleTarget(kind, products)
      if (!target) {
        problems.push(`could not build a sample "${kind}" target`)
        continue
      }
      try {
        const result = await navigation.resolve(ctx, target)
        if (!result?.url) problems.push(`"${kind}" resolved to an empty url`)
      } catch (error) {
        problems.push(`"${kind}" threw: ${(error as Error).message}`)
      }
    }

    return problems.length === 0
      ? pass(
          navigationCheck.name,
          manifest.capabilities.navigation.kinds.join(', ')
        )
      : fail(navigationCheck.name, problems.join('; '))
  },
}

/**
 * A bad identity token must produce a guest, not an exception. consuela's
 * `wp-identity.service.ts` is careful about this and it matters: an adapter
 * that throws here takes the whole chat down for every logged-out shopper.
 */
const identityCheck: Check = {
  name: 'a bogus identity token yields a guest, not an error',
  async run({ adapter, ctx }) {
    const { customer: customerPort } = adapter
    if (!customerPort?.resolveIdentity) {
      return skip(identityCheck.name, 'no identity support')
    }

    try {
      const customer = await customerPort.resolveIdentity(ctx, GARBAGE_IDENTITY)
      return customer === null
        ? pass(identityCheck.name)
        : fail(
            identityCheck.name,
            'an unsigned, invalid token was accepted as a real customer'
          )
    } catch (error) {
      return fail(
        identityCheck.name,
        `resolveIdentity threw instead of returning null: ${(error as Error).message}`
      )
    }
  },
}

const cartCheck: Check = {
  name: 'cart operations behave',
  async run({ adapter, ctx, options, products }) {
    const { cart } = adapter
    if (!cart) return skip(cartCheck.name, 'no cart port')

    if (isClientCart(cart)) {
      const problems = validateRecipe(cart.readRecipe(ctx), 'readRecipe')
      const target = options.cartProductId ?? cartableProduct(products)?.id
      if (target) {
        const recipes = cart.writeRecipe(
          ctx,
          { productId: target, mode: 'set', quantity: 1 },
          {
            lines: [],
            itemCount: 0,
            subtotal: null,
            total: null,
            currency: null,
          }
        )
        const list = Array.isArray(recipes) ? recipes : [recipes]
        if (list.length === 0) problems.push('writeRecipe returned no requests')
        for (const recipe of list)
          problems.push(...validateRecipe(recipe, 'writeRecipe'))
      }
      // `normalize` is the widget's only way back to a cart, and it is handed
      // whatever the store answered — including, on a bad day, an error body.
      // One that throws takes the chat down at the moment a shopper adds to
      // their cart, so it is checked here rather than discovered there.
      for (const raw of [null, {}, 'not a cart']) {
        try {
          const normalized = cart.normalize(ctx, raw)
          if (!Array.isArray(normalized.lines)) {
            problems.push(
              `normalize(${JSON.stringify(raw)}) returned no lines array`
            )
          }
        } catch (error) {
          problems.push(
            `normalize(${JSON.stringify(raw)}) threw: ${(error as Error).message}`
          )
        }
      }

      return problems.length === 0
        ? pass(cartCheck.name, 'client mode: recipes are well-formed')
        : fail(cartCheck.name, problems.join('; '))
    }

    if (options.skipCartMutation) {
      const current = await cart.get(ctx)
      return pass(
        cartCheck.name,
        `server mode: read ${current.itemCount} item(s)`
      )
    }

    const target = options.cartProductId ?? cartableProduct(products)?.id
    if (!target)
      return skip(cartCheck.name, 'no in-stock simple product to test with')

    const before = await cart.get(ctx)
    const added = await cart.apply(ctx, {
      productId: target,
      mode: 'set',
      quantity: 1,
    })
    const line = added.lines.find((entry) => entry.productId === target)
    if (line?.quantity !== 1) {
      return fail(
        cartCheck.name,
        `after set/1 the cart does not hold exactly one of "${target}"`
      )
    }

    // Idempotency: setting the same quantity again must not stack.
    const again = await cart.apply(ctx, {
      productId: target,
      mode: 'set',
      quantity: 1,
    })
    const repeated = again.lines.find((entry) => entry.productId === target)
    if (repeated?.quantity !== 1) {
      return fail(
        cartCheck.name,
        `set is not idempotent: a second set/1 left quantity ${repeated?.quantity}`
      )
    }

    const removed = await cart.apply(ctx, {
      productId: target,
      mode: 'remove',
      quantity: 0,
    })
    if (removed.lines.some((entry) => entry.productId === target)) {
      return fail(cartCheck.name, 'remove left the line in the cart')
    }

    return pass(
      cartCheck.name,
      `server mode: add/idempotent-set/remove against a cart of ${before.itemCount}`
    )
  },
}

function validateRecipe(recipe: CartRecipe, label: string): string[] {
  const problems: string[] = []
  if (!recipe.path.startsWith('/')) {
    problems.push(
      `${label} path "${recipe.path}" must be relative to the store origin and start with "/"`
    )
  }
  if (/^https?:\/\//i.test(recipe.path)) {
    problems.push(
      `${label} path must not be absolute — the widget supplies the origin`
    )
  }
  return problems
}

function cartableProduct(
  products: AdapterProduct[]
): AdapterProduct | undefined {
  return products.find(
    (product) =>
      product.inStock !== false &&
      (product.type === null || product.type === 'simple')
  )
}

function sampleTarget(kind: NavigationKind, products: AdapterProduct[]) {
  switch (kind) {
    case 'product': {
      const id = products[0]?.id
      return id ? ({ kind, id } as const) : undefined
    }
    case 'category': {
      const id = products[0]?.categories[0]
      return id ? ({ kind, id } as const) : undefined
    }
    case 'search': {
      return { kind, query: 'test' } as const
    }
    case 'page': {
      return { kind, slug: 'terms' } as const
    }
    case 'cart':
    case 'checkout': {
      return { kind } as const
    }
  }
}

export const CONTRACT_CHECKS: Check[] = [
  manifestCheck,
  configCheck,
  healthCheck,
  paginationCheck,
  productShapeCheck,
  getRoundTripCheck,
  categoriesCheck,
  navigationCheck,
  identityCheck,
  cartCheck,
]
