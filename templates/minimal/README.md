# My AgorAI adapter

An AgorAI adapter is a small HTTP service that translates the platform's fixed
contract into whatever your store actually is. You implement a few interfaces,
call `run()`, and deploy one container.

## Quick start

```bash
cp -r minimal my-store-adapter && cd my-store-adapter
cp .env.example .env
openssl rand -hex 32          # paste into ADAPTER_SHARED_SECRET in .env
pnpm install
pnpm run dev
```

`start` and `dev` load that `.env` with Node's own `--env-file-if-exists`
(Node 22.9+). **The SDK does not read `.env` itself** — `run()` reads
`process.env` — so a bare `node dist/adapter.js` ignores the file and refuses to
start over a missing `ADAPTER_SHARED_SECRET`. Use the scripts, or pass the
variables yourself. In a container there is no `.env`; the environment carries
them, which is why the flag tolerates the file's absence.

Then edit `src/adapter.ts`. It is the only file you need to touch.

```bash
curl localhost:4000/v1/manifest    # what the platform will read
curl localhost:4000/healthz
```

## Connecting it to a project

1. Deploy it somewhere the platform can reach (`docker compose up -d`).
2. In the platform, open your project → **Store**.
3. Paste the adapter's URL. The platform reads `/v1/manifest` and **generates
   the settings form from the `config` schema you declared** — so whatever you
   put in `config` is what the shop admin is asked for.
4. Fill in those fields, paste the same `ADAPTER_SHARED_SECRET`, and press
   **Test connection**. That calls your `health()` against the real store.

## What you have to implement

| Port | Required | Leave it out and… |
| --- | --- | --- |
| `catalog` | **yes** | there is nothing to recommend |
| `cart` | no | the bot can recommend but never add to a cart |
| `navigation` | no | the bot cannot send a shopper to a page |
| `customer` | no | every chat is a guest chat; no order history |

Whatever you omit is reported as unsupported in the manifest, and the platform
hides the matching features rather than failing at them. It also trims the LLM's
response schema, so a bot on a store with no cart is never even offered the
vocabulary to try.

## Three things that will bite you

**Do not read `process.env` for store settings.** Everything store-specific
arrives on `ctx`, filled in by the shop admin. That is what lets one deployment
serve many stores — and it is why the WooCommerce adapter can be a single shared
service rather than one container per shop.

**Money is a decimal string.** `'3490.00'`, never `3490.0`. Prices go straight
to the shopper.

**Pagination must terminate.** Return `nextCursor: null` when you are done. A
cursor that never clears turns the nightly index into an infinite loop against
your own store. The contract test checks this.

## Testing it

```ts
import { runContractTests } from '@smartitory/agorai-adapter/testkit'
import { adapter } from './adapter'

runContractTests(() => adapter, {
  context: {
    projectId: 'test',
    config: { STORE_API_URL: 'http://localhost:3000', STORE_API_KEY: 'dev' },
    locale: 'en',
    requestId: 'test',
  },
})
```

Or without a test runner:

```ts
import { checkAdapter, formatReport } from '@smartitory/agorai-adapter/testkit'
console.log(formatReport(await checkAdapter(adapter, { context })))
```

## Security

The adapter holds live store credentials on every request. It **refuses to
start** without a 32+ character `ADAPTER_SHARED_SECRET`, and refuses to start
with `ADAPTER_ALLOW_UNSIGNED=true` when `NODE_ENV=production`. Requests are
authenticated by an HMAC over `${timestamp}.${body}`, with a five-minute replay
window — so a captured request cannot be replayed later.

Errors you throw that are not `AdapterError`s have their message replaced before
they reach the platform, because upstream HTTP clients habitually put the failing
URL — API key and all — into the message. Use `AdapterUpstreamError` and friends
to say something deliberate.
