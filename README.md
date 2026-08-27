# @smartitory/agorai-adapter

The SDK for connecting any online store to the AgorAI AI shopping advisor.

An adapter is a small HTTP service that speaks one fixed contract and translates
it into whatever your store actually is. You implement a few interfaces, call
`run()`, and deploy one container.

```ts
import { defineAdapter, run } from '@smartitory/agorai-adapter'

const adapter = defineAdapter({
  name: 'my-store',
  version: '1.0.0',
  config: {
    STORE_API_URL: { type: 'url', required: true, label: { en: 'Store API URL' } },
    STORE_API_KEY: { type: 'secret', required: true, label: { en: 'API key' } },
  },
  catalog: {
    async list(ctx, { cursor }) { /* → { items, nextCursor } */ },
    async get(ctx, ids) { /* → AdapterProduct[] */ },
  },
})

run(adapter)
```

## Install

```bash
pnpm add github:smartitorysoft/agorai-adapter#v0.1.0
```

Or start from a template — they include a Dockerfile, a compose file and a
worked example of every port:

- `templates/minimal` — a blank adapter to fill in
- `templates/woocommerce` — a working WooCommerce adapter

## The idea

The platform knows nothing about your store. It knows about **products**,
**carts**, **navigation** and **customers**, and it asks your adapter for those.

The other half is the manifest. Your adapter declares the settings it needs, and
the platform **generates the project's settings form from that declaration** —
so onboarding a store is filling in a form, not writing platform code. It also
declares what it can do, and the platform turns off the rest.

```
platform-backend ──HMAC-signed POST──▶ your adapter ──▶ your store
                 ◀── normalized ──────
```

## The ports

| Port | Required | Methods |
| --- | --- | --- |
| `catalog` | **yes** | `list`, `get`, `categories?` |
| `cart` | no | `client` mode: `readRecipe`, `writeRecipe`, `normalize` · `server` mode: `get`, `apply`, `clear` |
| `navigation` | no | `resolve` |
| `customer` | no | `resolveIdentity?`, `listOrders?` |

### Why carts have two modes

A WooCommerce cart lives in the shopper's browser session, and the widget is
embedded on the WooCommerce page itself — a server-side mutation would change a
*different* cart from the one the shopper is looking at. So `mode: 'client'` has
the adapter describe the request and the widget perform it same-origin, with the
store's own cookies.

A headless store's cart is a server resource the platform can address directly
with a session token. That is `mode: 'server'`.

## Entry points

| Import | Contains |
| --- | --- |
| `@smartitory/agorai-adapter` | `defineAdapter`, `run`, every contract type |
| `@smartitory/agorai-adapter/contract` | types only — no NestJS, no Node APIs, safe in a browser bundle |
| `@smartitory/agorai-adapter/testkit` | `checkAdapter`, `runContractTests` |

## Contract conformance

```ts
import { checkAdapter, formatReport } from '@smartitory/agorai-adapter/testkit'

const report = await checkAdapter(adapter, { context })
console.log(formatReport(report))
```

Ten checks, including the ones that catch real bugs: pagination terminates, ids
from `list` are retrievable via `get`, `set` is idempotent, prices are decimal
strings, descriptions carry no markup, and a bogus identity token yields a guest
rather than an exception.

## Licence

MIT.
