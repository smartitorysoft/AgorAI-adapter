/**
 * Unit smoke test for the WooCommerce template.
 *
 * Two things here are not covered anywhere else in this repo, and both are the
 * kind that fail silently in front of a shopper:
 *
 *  1. **`mode: 'client'` carts.** Every other adapter in the workspace is
 *     `mode: 'server'`. Client mode is the one where the adapter only describes
 *     the request and the widget performs it, so a wrong recipe is a cart that
 *     never changes rather than an error anybody sees.
 *  2. **Store API money.** WooCommerce quotes prices in minor units with the
 *     scale sent alongside. Reading `"349000"` as 349000 is a hundredfold price
 *     error on a shopper's screen.
 *
 * The template is compiled first (`pnpm run build:template-test`) and required
 * from `test/.build`, so this runs the same JavaScript a deployed adapter runs.
 * `adapter.ts` is deliberately not required: it calls `run()` at module load.
 *
 *   pnpm build && pnpm run test:woocommerce
 */
const assert = require('node:assert')
const Module = require('node:module')
const path = require('node:path')
const { createHmac } = require('node:crypto')

// The compiled template imports the SDK by package name, as a real adapter
// would. Nothing has installed it here, so point that one specifier at dist/.
const SDK = path.join(__dirname, '..', 'dist', 'index.js')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === '@smartitory/agorai-adapter') return SDK
  return resolve.call(this, request, ...rest)
}

const { defineAdapter } = require('../dist')
const { checkAdapter, formatReport } = require('../dist/testkit')
const { wooCart } = require('./.build/woocommerce/cart')
const { toProduct, attributeHints } = require('./.build/woocommerce/product')
const { verifyIdentity } = require('./.build/woocommerce/identity')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
function expect(name, fn) {
  try {
    fn()
    check(name, true)
  } catch (error) {
    check(name, false, error.message)
  }
}

const CTX = {
  projectId: 'p1',
  config: {},
  locale: 'en',
  storeSession: { storeApiNonce: 'n', cartUrl: '/kosar' },
  requestId: 'r1',
  session(key) {
    return this.storeSession[key]
  },
}

const EMPTY = { lines: [], itemCount: 0, subtotal: null, total: null, currency: null }
const held = (quantity) => ({
  lines: [{
    key: 'ck1', productId: '12', variantId: null, sku: 'SKU-12',
    name: 'Floor cleaner', quantity, price: null, lineTotal: null,
  }],
  itemCount: quantity, subtotal: null, total: null, currency: 'HUF',
})
const write = (op, cart) => wooCart.writeRecipe(CTX, op, cart)

// --- client-mode recipes ---------------------------------------------------

expect('readRecipe targets the Store API cart with credentials', () => {
  const recipe = wooCart.readRecipe(CTX)
  assert.strictEqual(recipe.method, 'GET')
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart')
  assert.strictEqual(recipe.withCredentials, true)
  assert.strictEqual(recipe.sessionHeaders.Nonce, 'storeApiNonce')
})

expect('a product not in the cart is added, not updated', () => {
  const [recipe, ...rest] = write({ productId: '12', mode: 'set', quantity: 2 }, EMPTY)
  assert.strictEqual(rest.length, 0)
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart/add-item')
  assert.deepStrictEqual(recipe.body, { id: 12, quantity: 2 })
})

expect('a variant is added by its own id, not the parent product id', () => {
  const [recipe] = write(
    { productId: '12', variantId: '34', mode: 'set', quantity: 1 },
    EMPTY
  )
  assert.deepStrictEqual(recipe.body, { id: 34, quantity: 1 })
})

expect('setting the quantity a line already has does nothing', () => {
  assert.deepStrictEqual(write({ productId: '12', mode: 'set', quantity: 2 }, held(2)), [])
})

expect('add is resolved against the line, not sent as-is', () => {
  const [recipe] = write({ productId: '12', mode: 'add', quantity: 1 }, held(2))
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart/update-item')
  assert.deepStrictEqual(recipe.body, { key: 'ck1', quantity: 3 })
})

expect('remove uses the line key, which is not the product id', () => {
  const [recipe] = write({ productId: '12', mode: 'remove', quantity: 0 }, held(2))
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart/remove-item')
  assert.deepStrictEqual(recipe.body, { key: 'ck1' })
})

expect('removing what is absent is a no-op, not a request', () => {
  assert.deepStrictEqual(write({ productId: '12', mode: 'remove', quantity: 0 }, EMPTY), [])
})

expect('set/0 on a held line removes it', () => {
  const [recipe] = write({ productId: '12', mode: 'set', quantity: 0 }, held(2))
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart/remove-item')
})

expect('clearRecipe deletes every item', () => {
  const recipe = wooCart.clearRecipe(CTX)
  assert.strictEqual(recipe.method, 'DELETE')
  assert.strictEqual(recipe.path, '/wp-json/wc/store/v1/cart/items')
})

// --- normalize -------------------------------------------------------------

const STORE_CART = {
  items: [
    {
      key: 'ck1', id: 12, quantity: 2, name: 'Floor cleaner', sku: 'SKU-12',
      prices: { price: '349000', currency_code: 'HUF', currency_minor_unit: 2 },
      totals: { line_total: '698000', currency_code: 'HUF', currency_minor_unit: 2 },
    },
    { key: '', id: 99, quantity: 1, name: 'Ghost line' },
  ],
  items_count: 2,
  totals: {
    total_items: '698000', total_price: '698000',
    currency_code: 'HUF', currency_minor_unit: 2,
  },
}

expect('normalize converts minor units to a decimal string', () => {
  const cart = wooCart.normalize(CTX, STORE_CART)
  assert.strictEqual(cart.lines.length, 1, 'the keyless line must be dropped')
  assert.deepStrictEqual(cart.lines[0].price, { amount: '3490.00', currency: 'HUF' })
  assert.deepStrictEqual(cart.lines[0].lineTotal, { amount: '6980.00', currency: 'HUF' })
  assert.deepStrictEqual(cart.total, { amount: '6980.00', currency: 'HUF' })
  assert.strictEqual(cart.itemCount, 2)
  assert.strictEqual(cart.currency, 'HUF')
})

expect('normalize survives a response that is not a cart', () => {
  for (const raw of [null, undefined, 'nope', {}]) {
    const cart = wooCart.normalize(CTX, raw)
    assert.deepStrictEqual(cart.lines, [])
    assert.strictEqual(cart.itemCount, 0)
  }
})

// --- product mapping -------------------------------------------------------

const WOO_PRODUCT = {
  id: 12, name: 'Floor cleaner', slug: 'floor-cleaner',
  permalink: 'https://shop.example/product/floor-cleaner',
  sku: 'SKU-12', type: 'simple', status: 'publish',
  price: '3490', regular_price: '3490', sale_price: '',
  stock_status: 'instock', stock_quantity: 4,
  date_modified_gmt: '2026-08-01T10:00:00',
  description: '<p>Strong &amp; fast.</p>', short_description: '<b>For floors</b>',
  categories: [{ id: 3, name: 'Cleaning', slug: 'cleaning' }],
  tags: [], images: [{ id: 1, src: 'https://shop.example/a.jpg', alt: '' }],
  attributes: [{ id: 1, name: 'Scent', options: ['Lemon', 'Pine'] }],
  meta_data: [
    { id: 1, key: '_edit_lock', value: '1690000000:2' },
    { id: 2, key: 'ph_jelleg', value: 'lúgos' },
    { id: 3, key: 'tiltott_feluletek', value: ['márvány', 'parketta'] },
    { id: 4, key: 'empty_one', value: '' },
  ],
}

expect('the shop’s own meta becomes attributes, WordPress internals do not', () => {
  const product = toProduct(WOO_PRODUCT, 'HUF')
  assert.deepStrictEqual(product.attributes, {
    ph_jelleg: 'lúgos',
    tiltott_feluletek: ['márvány', 'parketta'],
    scent: ['Lemon', 'Pine'],
  })
})

expect('HTML is stripped and entities decoded before embedding', () => {
  const product = toProduct(WOO_PRODUCT, 'HUF')
  assert.strictEqual(product.description, 'For floors\n\nStrong & fast.')
})

expect('the product maps onto the contract shape', () => {
  const product = toProduct(WOO_PRODUCT, 'HUF')
  assert.strictEqual(product.id, '12')
  assert.strictEqual(product.url, 'https://shop.example/product/floor-cleaner')
  assert.strictEqual(product.imageUrl, 'https://shop.example/a.jpg')
  assert.deepStrictEqual(product.price, { amount: '3490', currency: 'HUF' })
  assert.strictEqual(product.inStock, true)
  assert.deepStrictEqual(product.categories, ['Cleaning'])
  // WooCommerce sends *_gmt without a zone; unmarked it would be read as local.
  assert.strictEqual(product.updatedAt, '2026-08-01T10:00:00Z')
})

expect('attribute hints report a key seen as a list as a list', () => {
  const scalarOnly = {
    ...WOO_PRODUCT,
    attributes: [],
    meta_data: [{ id: 3, key: 'tiltott_feluletek', value: 'márvány' }],
  }
  const hints = attributeHints([scalarOnly, WOO_PRODUCT])
  const byKey = Object.fromEntries(hints.map((hint) => [hint.key, hint.kind]))
  assert.strictEqual(byKey.tiltott_feluletek, 'list')
  assert.strictEqual(byKey.ph_jelleg, 'text')
  assert.ok(!('_edit_lock' in byKey))
})

// --- identity --------------------------------------------------------------

const SECRET = 'identity-secret'
const sign = (id, exp) =>
  `${id}.${exp}.${createHmac('sha256', SECRET).update(`${id}|${exp}`).digest('hex')}`
const now = () => Math.floor(Date.now() / 1000)

expect('a correctly signed identity resolves', () => {
  const result = verifyIdentity(SECRET, sign(7, now() + 600))
  assert.deepStrictEqual(result, { ok: true, customerId: '7' })
})

expect('a tampered signature is refused', () => {
  const signed = sign(7, now() + 600)
  // Flip the last nibble to a *different* value. Appending a fixed character
  // silently does nothing one time in sixteen, which is a flaky test rather
  // than a passing one.
  const last = signed.at(-1)
  const token = signed.slice(0, -1) + (last === '0' ? '1' : '0')
  assert.strictEqual(verifyIdentity(SECRET, token).reason, 'bad-signature')
})

expect('changing the id invalidates the token', () => {
  const [, exp, sig] = sign(7, now() + 600).split('.')
  assert.strictEqual(verifyIdentity(SECRET, `8.${exp}.${sig}`).reason, 'bad-signature')
})

expect('an expired identity is refused', () => {
  assert.strictEqual(verifyIdentity(SECRET, sign(7, now() - 3600)).reason, 'expired')
})

expect('an identity valid for a decade is refused before its signature is read', () => {
  const exp = now() + 10 * 365 * 24 * 3600
  assert.strictEqual(verifyIdentity(SECRET, sign(7, exp)).reason, 'implausible-lifetime')
})

expect('garbage is malformed, not a crash', () => {
  for (const token of ['', 'nonsense', '{', '0.0.0', 'a.b.c']) {
    assert.strictEqual(verifyIdentity(SECRET, token).ok, false)
  }
})

expect('the JSON token shape works too', () => {
  const exp = now() + 600
  const sig = createHmac('sha256', SECRET).update(`7|${exp}`).digest('hex')
  const result = verifyIdentity(SECRET, JSON.stringify({ id: 7, exp, sig }))
  assert.deepStrictEqual(result, { ok: true, customerId: '7' })
})

// --- the contract suite, against a real client-mode cart -------------------

// Every other adapter in this workspace is `mode: 'server'`, so the testkit's
// client-mode branch had nothing exercising it. The catalogue below is a stub —
// this run is about the cart port, which is the template's own code.
const clientModeAdapter = defineAdapter({
  name: 'woocommerce-template-under-test',
  version: '1.0.0',
  // The one setting this stand-in needs: something has to carry
  // `role: 'storeUrl'` or the testkit's manifest check fails it, and a
  // client-mode cart is exactly the case where that matters most — its recipes
  // are performed against this origin, by the shopper's own browser.
  config: {
    WOOCOMMERCE_URL: {
      type: 'url',
      required: true,
      role: 'storeUrl',
      label: { en: 'Store URL' },
    },
  },
  capabilities: { navigation: ['cart', 'checkout'] },
  catalog: {
    list: async () => ({
      items: [toProduct(WOO_PRODUCT, 'HUF')],
      nextCursor: null,
      total: 1,
    }),
    get: async (_ctx, ids) =>
      ids.includes('12') ? [toProduct(WOO_PRODUCT, 'HUF')] : [],
  },
  cart: wooCart,
  navigation: { resolve: () => ({ url: '/cart' }) },
})

;(async () => {
  const report = await checkAdapter(clientModeAdapter, {
    context: {
      projectId: 'p1',
      config: { WOOCOMMERCE_URL: 'https://shop.example' },
      locale: 'en',
      requestId: 'r1',
    },
  })
  console.log('\n--- contract testkit, client-mode cart ---')
  console.log(formatReport(report))
  check('the template’s cart port is contract-conformant', report.passed,
    `${report.failed} failed`)

  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} woocommerce assertions passed`)
  process.exit(failed.length === 0 ? 0 : 1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
