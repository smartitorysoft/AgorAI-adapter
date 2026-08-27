# WooCommerce AgorAI adapter

A ready-made AgorAI adapter for a WooCommerce shop. Copy this directory, set
four values, deploy one container.

> **You may not need this.** Smartitory hosts one WooCommerce adapter that serves
> every WooCommerce project on the platform — point your project's Store screen
> at that URL and fill in the same four fields there. This template is for a shop
> that would rather run its own, and for anyone who wants to change how their
> products are mapped.

## What it gives you

| Capability | Status |
| --- | --- |
| Catalogue, with incremental sync | ✅ `modified_after`, so a nightly sync reads only what changed |
| Categories | ✅ |
| Cart | ✅ `mode: 'client'` — the widget mutates the shopper's own cart, same-origin |
| Navigation | ✅ cart, checkout, product, category, search, page |
| Logged-in shoppers + order history | ✅ when `WP_IDENTITY_SECRET` is set |
| Product variations | ✅ opt-in, `WOOCOMMERCE_SYNC_VARIANTS` — see [Variations](#variations) |
| Webhooks | ❌ possible, but not built here — see [Webhooks](#webhooks) |

## Setup

### 1. A WooCommerce API key

WooCommerce → Settings → Advanced → REST API → **Add key**, permission **Read**.

Grant the key read access to **orders** as well if you want the bot to know what
a returning shopper bought before. If you skip it everything else still works —
the adapter's health check will tell you order history is unavailable rather than
letting it degrade silently.

### 2. Configure

```bash
cp .env.example .env
openssl rand -hex 32     # -> ADAPTER_SHARED_SECRET
```

`ADAPTER_SHARED_SECRET` is the only value the adapter genuinely needs in its
environment. It signs every request between the platform and this adapter; paste
the same string into the project's Store screen. The adapter refuses to start
without it.

The store settings — URL, consumer key, consumer secret, identity secret, order
limit — are normally typed on the platform's **Store** screen and arrive on every
request as `ctx.config`. That is what lets one deployment serve many shops.

If you are running this for a **single** shop, you may instead put those values in
`.env` and leave the Store screen blank; see the note at the top of
[`src/config.ts`](./src/config.ts). Do not do both in a shared deployment: an env
fallback there means every project silently inherits one shop's credentials
whenever a field is left empty.

### 3. Run

```bash
docker compose up --build     # or: pnpm install && pnpm build && pnpm start
```

`start` and `dev` load `.env` with Node's own `--env-file-if-exists` (Node
22.9+). The SDK does not read `.env` itself — `run()` reads `process.env` — so a
bare `node dist/adapter.js` ignores the file and refuses to start over a missing
`ADAPTER_SHARED_SECRET`.

Then on the platform: paste the adapter's URL and the shared secret into the
project's Store screen, fill the fields it generates, and press **Test
connection**. You should see the shop's name, its product count, and any
warnings.

## How the cart works, and why it looks indirect

WooCommerce carts do not live on your server. They belong to the shopper's
browser session — a cookie plus a Store API nonce — and the AgorAI widget runs
on your shop's own pages. If this adapter called `cart/add-item` itself it would
create and mutate a *different* cart from the one the shopper is looking at, and
the item would never appear.

So the cart port is `mode: 'client'`: it returns a **recipe** — a method, a path
relative to your shop's origin, a body, and the names of the tokens to attach —
and the widget performs the request same-origin with your cookies. It hands the
raw response back and [`normalize`](./src/cart.ts) reads it. Nothing in the widget
knows what WooCommerce is.

Two details worth keeping if you edit `src/cart.ts`:

- **Store API prices are integers in minor units**, with the scale sent
  alongside: `"349000"` at `currency_minor_unit: 2` is `3490.00`. Reading it
  as-is is a hundredfold price error on a shopper's screen.
- **A line key is not a product id.** WooCommerce updates and removes lines by
  their `key`, and one cart can hold the same product twice under different
  options.

## Product attributes — where your shop's own data goes

Everything WooCommerce knows about a product that is not a core field lands in
`attributes`:

- every `meta_data` entry whose key does **not** start with `_` (the underscore
  convention marks WordPress/plugin bookkeeping, which is noise in an embedding
  and occasionally identifying);
- every product attribute, under a slugified name, unless a meta key already
  claimed it.

Nothing here is special-cased for a vertical. A cleaning-supplies shop's
`ph_jelleg` and `tiltott_feluletek` arrive exactly like a bookshop's `author` —
and the platform's **Products** screen is where you say what each one means:
whether it goes into the embedded text, whether it shows on the product card,
and whether it filters recommendations.

To help with that, the health check reads a sample of your catalogue and reports
the attribute keys it found, so the platform can offer you a filled-in table
instead of an empty one. That cannot go in the manifest: the manifest is served
before any credentials exist, so it cannot know anything about *your* shop.

## Logged-in shoppers

Your storefront must prove who the shopper is; the adapter will not take a bare
user id, because an unsigned id in a public request body is a "show me someone
else's order history" hole.

The AgorAI mu-plugin signs `${userId}|${expiry}` with
`AGORAI_IDENTITY_SECRET` from `wp-config.php` and publishes it as
`window.AgorAIStore.identityToken`. Set the same string here as
`WP_IDENTITY_SECRET` and [`src/identity.ts`](./src/identity.ts) verifies it:
expiry with clock skew allowed, a maximum plausible lifetime (a forged token
claiming to expire in 2035 is rejected without ever comparing signatures), and a
constant-time comparison.

Any failure yields a guest, never an error. A logged-out visitor's chat must
still work.

## Variations

Off by default, and turned on per project with `WOOCOMMERCE_SYNC_VARIANTS` (or
in `.env` for a single-store deployment). It costs **one extra request per
variable product on every sync**, which on a large catalogue turns a first sync
from seconds into minutes — which is why it is a choice rather than a default.

Be clear about what it buys. The platform only lets the bot add **`simple`**
products to a cart regardless: adding a variable product means choosing a
variation on the shopper's behalf, which is how you sell somebody the wrong
size. Variations make a product *describable* — "comes in M and L, the L is out
of stock" — not purchasable. If your answers never turn on size or colour, leave
it off.

`src/variants.ts` reads them four products at a time and never throws: a shop
whose security plugin blocks `products/{id}/variations` still gets its catalogue
indexed, just without the sizes. The health check tells an admin when a shop has
variable products and this is off, because there is otherwise no way to discover
that the bot cannot see them.

## Known gaps

### Webhooks

`capabilities.webhooks` is `false` here — this template has no webhook endpoint,
so the platform's scheduled sync is what keeps the catalogue fresh. With
`incrementalSync` that is cheap, and for most shops it is enough.

Adding one is supported: `run()` takes a `modules` option, and a store-facing
controller opts out of the platform's signature scheme with `@SkipSignature()`
and verifies WooCommerce's own instead. The hosted adapter
(`adapters/woocommerce/src/webhooks/` in the platform repo) is the worked
example, including the part that is easy to get wrong — WooCommerce sends
**base64** of a plain HMAC over the body, not the SDK's hex-over-timestamped
scheme, and it disables a webhook after five non-2xx replies.

### HTTP shops

WooCommerce refuses Basic authentication over plain HTTP and requires one-legged
OAuth 1.0a instead. [`src/client.ts`](./src/client.ts) implements both and picks
by scheme, which is what makes a local `http://shop.local` work. Do not delete
the OAuth path and then wonder why staging 401s.

## Layout

```
src/adapter.ts    the ports, and run()
src/config.ts     the settings form the platform generates, and where values come from
src/client.ts     REST v3: Basic over HTTPS, OAuth 1.0a over HTTP, typed errors
src/product.ts    WooCommerce product -> the platform's normalized product
src/variants.ts   variations, opt-in
src/cart.ts       client-mode recipes, and reading the Store API's cart back
src/identity.ts   verifying the signed shopper identity
src/types.ts      the slices of WooCommerce's responses this adapter reads
```
