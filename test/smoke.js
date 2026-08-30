/**
 * End-to-end smoke test for the SDK runtime.
 *
 * Boots a real in-memory adapter through `run()` and drives the HTTP surface the
 * platform will use, including the parts that are easy to get wrong and
 * invisible in a unit test: that an unsigned request is refused, that a replayed
 * signature is refused, that a missing config key surfaces as CONFIG_INVALID
 * rather than a 500, and that an unknown body field is rejected rather than
 * silently dropped.
 *
 * Plain Node on purpose - it runs against dist/, exactly as a consumer would, so
 * it also proves the build output is usable.
 *
 *   pnpm build && pnpm run test:smoke
 */
const { defineAdapter, run, signRequest } = require('../dist')
// The testkit is a separate entry point so it never ships inside a deployed adapter.
const { checkAdapter, formatReport } = require('../dist/testkit')

const SECRET = 'a'.repeat(64)
const PORT = 4123

// A tiny in-memory bookshop: enough surface to exercise every port.
const BOOKS = [
  { id: 'b1', sku: 'BK-1', name: 'Dragons of Elmwood', genre: 'fantasy', price: '3490' },
  { id: 'b2', sku: 'BK-2', name: 'The Tin Orbit', genre: 'sci-fi', price: '4290' },
  { id: 'b3', sku: 'BK-3', name: 'Cold Harbour', genre: 'crime', price: '3990' },
]
const carts = new Map()

function toProduct(book) {
  return {
    id: book.id,
    sku: book.sku,
    name: book.name,
    url: `/books/${book.id}`,
    imageUrl: null,
    price: { amount: book.price, currency: 'HUF' },
    inStock: true,
    stockStatus: 'instock',
    type: 'simple',
    categories: [book.genre],
    description: `A ${book.genre} novel.`,
    attributes: { genre: book.genre },
    updatedAt: null,
  }
}

const adapter = defineAdapter({
  name: 'smoke-bookshop',
  version: '0.0.1',
  config: {
    STORE_API_URL: { type: 'url', required: true, label: { en: 'Store API URL' } },
    // Two URLs, because a real adapter has two: the one it calls, and the one
    // a shopper's browser loads pages from. Only the second can carry the
    // role, and the testkit fails a manifest without it — an adapter that
    // omits it leaves the platform unable to authorise the shop's own origin
    // to embed the widget.
    STORE_FRONTEND_URL: {
      type: 'url',
      required: true,
      role: 'storeUrl',
      label: { en: 'Storefront URL' },
    },
    STORE_API_KEY: { type: 'secret', required: true, label: { en: 'API key' } },
  },
  capabilities: { navigation: ['cart', 'checkout', 'product', 'category'] },
  async health(ctx) {
    ctx.cfg('STORE_API_KEY')
    return { ok: true, storeName: 'Smoke Bookshop', productCount: BOOKS.length }
  },
  catalog: {
    async list(ctx, { cursor }) {
      ctx.cfg('STORE_API_URL')
      const start = cursor ? Number(cursor) : 0
      const items = BOOKS.slice(start, start + 2).map(toProduct)
      const next = start + 2 < BOOKS.length ? String(start + 2) : null
      return { items, nextCursor: next, total: BOOKS.length }
    },
    async get(ctx, ids) {
      return BOOKS.filter((b) => ids.includes(b.id)).map(toProduct)
    },
    async categories() {
      return [...new Set(BOOKS.map((b) => b.genre))].map((g) => ({
        id: g, name: g, url: `/c/${g}`, parentId: null,
      }))
    },
  },
  cart: {
    mode: 'server',
    async get(ctx) { return read(ctx) },
    async apply(ctx, op) {
      const cart = read(ctx)
      const existing = cart.lines.find((l) => l.productId === op.productId)
      const current = existing ? existing.quantity : 0
      const target = op.mode === 'remove' ? 0 : op.mode === 'add' ? current + op.quantity : op.quantity
      const book = BOOKS.find((b) => b.id === op.productId)
      let lines = cart.lines.filter((l) => l.productId !== op.productId)
      if (target > 0 && book) {
        lines.push({
          key: `line-${book.id}`, productId: book.id, variantId: null, sku: book.sku,
          name: book.name, quantity: target,
          price: { amount: book.price, currency: 'HUF' },
          lineTotal: { amount: String(Number(book.price) * target), currency: 'HUF' },
        })
      }
      return write(ctx, lines)
    },
    async clear(ctx) { return write(ctx, []) },
  },
  navigation: {
    resolve(ctx, target) {
      switch (target.kind) {
        case 'cart': return { url: '/cart' }
        case 'checkout': return { url: '/checkout' }
        case 'product': return { url: `/books/${target.id}` }
        case 'category': return { url: `/c/${target.id}` }
        default: return { url: '/' }
      }
    },
  },
  customer: {
    async resolveIdentity(ctx, token) {
      // Only a token this fake store actually issued is accepted.
      return token === 'valid-token' ? { id: 'c1', email: 'a@b.c', displayName: 'Test' } : null
    },
    async listOrders() { return [] },
  },
})

function key(ctx) { return ctx.session('cartId') || ctx.projectId }
function read(ctx) {
  const lines = carts.get(key(ctx)) || []
  return summarize(lines)
}
function write(ctx, lines) {
  carts.set(key(ctx), lines)
  return summarize(lines)
}
function summarize(lines) {
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: null, total: null, currency: 'HUF',
  }
}

const CONTEXT = {
  projectId: 'proj-smoke',
  config: {
    STORE_API_URL: 'http://localhost:9999',
    STORE_FRONTEND_URL: 'https://shop.example',
    STORE_API_KEY: 'k',
  },
  locale: 'en',
  storeSession: { cartId: 'visitor-1' },
  requestId: 'req-1',
}

async function post(path, payload, { sign = true, timestamp } = {}) {
  const body = JSON.stringify(payload)
  const headers = { 'Content-Type': 'application/json' }
  if (sign) Object.assign(headers, signRequest(body, SECRET, timestamp))
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers, body })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

;(async () => {
  const app = await run(adapter, { port: PORT, sharedSecret: SECRET })

  const manifestRes = await fetch(`http://127.0.0.1:${PORT}/v1/manifest`)
  const manifest = await manifestRes.json()
  check('manifest is readable unsigned', manifestRes.status === 200 && manifest.name === 'smoke-bookshop')
  check('manifest reports inferred capabilities',
    manifest.capabilities.catalog.categories === true &&
    manifest.capabilities.cart.mode === 'server' &&
    manifest.capabilities.customer.orders === true,
    JSON.stringify(manifest.capabilities.cart))
  check('config schema is normalized to an array',
    Array.isArray(manifest.configSchema) && manifest.configSchema[0].key === 'STORE_API_URL')

  const unsigned = await post('/v1/catalog/list', { context: CONTEXT }, { sign: false })
  check('unsigned request is refused', unsigned.status === 401, `got ${unsigned.status}`)

  const stale = await post('/v1/catalog/list', { context: CONTEXT },
    { timestamp: Math.floor(Date.now() / 1000) - 4000 })
  check('replayed (stale) signature is refused', stale.status === 401, `got ${stale.status}`)

  const signed = await post('/v1/catalog/list', { context: CONTEXT })
  check('signed request succeeds', signed.status === 200 && signed.json.items.length === 2,
    `status ${signed.status}`)

  const badConfig = await post('/v1/catalog/list',
    { context: { ...CONTEXT, config: { STORE_API_KEY: 'k' } } })
  check('missing required config surfaces as CONFIG_INVALID',
    badConfig.status === 422 && badConfig.json.error.code === 'CONFIG_INVALID',
    `${badConfig.status} ${badConfig.json?.error?.code}`)

  const bogus = await post('/v1/catalog/list', { context: CONTEXT, nope: 1 })
  check('unknown field is rejected, not ignored',
    bogus.status === 400 && bogus.json.error.code === 'INVALID_REQUEST',
    `${bogus.status} ${bogus.json?.error?.code}`)

  const add = await post('/v1/cart/apply',
    { context: CONTEXT, op: { productId: 'b1', mode: 'set', quantity: 2 } })
  check('cart apply works', add.status === 200 && add.json.cart.itemCount === 2,
    JSON.stringify(add.json?.cart?.itemCount))

  const nav = await post('/v1/navigation/resolve',
    { context: CONTEXT, target: { kind: 'product', id: 'b2' } })
  check('navigation resolves', nav.status === 200 && nav.json.url === '/books/b2')

  const badNav = await post('/v1/navigation/resolve',
    { context: CONTEXT, target: { kind: 'product' } })
  check('a product target with no id is rejected',
    badNav.status === 400, `got ${badNav.status}`)

  console.log('\n--- contract testkit ---')
  const report = await checkAdapter(adapter, {
    context: { ...CONTEXT, storeSession: { cartId: 'testkit' } },
    minProducts: 3,
  })
  console.log(formatReport(report))
  check('testkit reports the adapter conformant', report.passed, `${report.failed} failed`)

  await app.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} smoke assertions passed`)
  process.exit(failed.length === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
