# Shopify AgorAI adapter

A ready-made AgorAI adapter for a Shopify shop. Copy this directory, set three
values, deploy one container.

> **You may not need this.** Smartitory hosts one Shopify adapter that serves
> every Shopify project on the platform — point your project's Store screen at
> that URL and fill in the same three fields there. This template is for a shop
> that would rather run its own, and for anyone who wants to change how their
> products are mapped.

## What it gives you

| Capability | Status |
| --- | --- |
| Catalogue, with incremental sync | ✅ `updated_at:>`, so a nightly sync reads only what changed |
| Collections as categories | ✅ |
| Cart | ✅ `mode: 'client'` — the widget mutates the shopper's own cart, same-origin |
| Navigation | ✅ cart, checkout, product, category, search, page |
| Logged-in shoppers + order history | ✅ when `SHOPIFY_IDENTITY_SECRET` is set and the snippet is installed |
| Product variants | ✅ on by default — on Shopify they cost query points, not requests |
| Webhooks | ❌ not built here — see [Webhooks](#webhooks) |

## Setup

### 1. A custom app

Shopify admin → Settings → Apps and sales channels → **Develop apps** → Create
an app → Configure Admin API scopes:

| Scope | What stops working without it |
| --- | --- |
| `read_products` | everything — the catalogue cannot be read at all |
| `read_inventory` | stock, so every product looks available |
| `read_customers` | the advisor cannot tell who a logged-in shopper is |
| `read_orders` | past orders as background context |

Install the app and copy the **Admin API access token** (`shpat_…`). It is shown
once.

`read_orders` covers Shopify's last 60 days. Older history needs
`read_all_orders`, which Shopify grants on request. Skip both and everything
else still works — the health check says order history is unavailable rather
than letting it degrade silently.

### 2. Configure

```bash
cp .env.example .env
openssl rand -hex 32     # -> ADAPTER_SHARED_SECRET
```

`ADAPTER_SHARED_SECRET` is the only value the adapter genuinely needs in its
environment. It signs every request between the platform and this adapter; paste
the same string into the project's Store screen. The adapter refuses to start
without it.

The store settings — the two addresses, the access token, the identity secret,
the order limit — are normally typed on the platform's **Store** screen and
arrive on every request as `ctx.config`. That is what lets one deployment serve
many shops.

If you are running this for a **single** shop, you may instead put those values
in `.env` and leave the Store screen blank; see the note at the top of
[`src/config.ts`](./src/config.ts). Do not do both in a shared deployment: an env
fallback there means every project silently inherits one shop's credentials
whenever a field is left empty.

**The two addresses are not interchangeable.** `SHOPIFY_SHOP_DOMAIN` is where
the Admin API answers (`my-shop.myshopify.com`); `SHOPIFY_STORE_URL` is where
shoppers browse, which for most shops is their own domain. The second is the one
the platform allows the advisor to be embedded on, and the origin its cart
requests are sent to — get it wrong and the advisor appears but its cart quietly
does nothing. The health check compares it against what the shop reports and
warns.

### 3. Run

```bash
docker compose up --build     # or: pnpm install && pnpm build && pnpm start
```

### 4. The theme snippet

The hosted adapter generates this per project and offers it as a download. Here
you paste it yourself: Online Store → Themes → ⋯ → **Edit code** → Snippets →
Add a new snippet called `agorai-store`, with this in it —

```liquid
{%- liquid
  assign agorai_token = ''
  if customer
    assign agorai_exp = 'now' | date: '%s' | plus: 1800
    assign agorai_body = customer.id | append: '|' | append: agorai_exp
    assign agorai_sig = agorai_body | hmac_sha256: 'YOUR_IDENTITY_SECRET'
    assign agorai_token = customer.id | append: '.' | append: agorai_exp | append: '.' | append: agorai_sig
  endif
-%}

<script>
  window.AgorAIStore = {
    cartUrl: {{ routes.cart_url | json }},
    checkoutUrl: '/checkout',
{%- if agorai_token != '' %}
    sessionToken: {{ agorai_token | json }},
{%- endif %}
  }
  document.addEventListener('agorai:cart-updated', function () {
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }))
  })
</script>
<script
  src="https://YOUR_PLATFORM/widget.js"
  data-agorai-project="YOUR_PROJECT_KEY"
  defer></script>
```

— then add `{% render 'agorai-store' %}` just before `</body>` in
`theme.liquid`.

`YOUR_IDENTITY_SECRET` must equal `SHOPIFY_IDENTITY_SECRET`. Liquid's
`hmac_sha256` runs where the theme is rendered, so the secret never reaches a
browser; only the digest does. Keep the whole thing inside `{% if customer %}` —
that is both what makes a guest a guest and what stops Shopify serving a cached
page with a stale timestamp in it.

The `cart:refresh` line is what tells the theme its cart changed. Dawn and its
descendants listen for that event; a theme that uses something else wants that
one line changed.

## How your products are mapped

Everything a shop says about a product that is not a fixed field arrives as
`attributes`, and the platform's Products screen decides what each key means:

| Shopify | Attribute key |
| --- | --- |
| Metafields in `SHOPIFY_METAFIELD_NAMESPACE` | `custom.ph_level`, … |
| Vendor | `vendor` |
| Product type | `product_type` |
| Tags | `tags` (a list) |
| Each option | `size`, `colour`, … (lists) |

Change [`src/product.ts`](./src/product.ts) if your shop keeps its vocabulary
somewhere else. It is the only file that decides any of this.

## Variants

On by default, unlike the WooCommerce template. Shopify returns variants inside
the same query, so reading them costs query points rather than an extra request
per product — the adapter compensates by asking for smaller pages. Turn
`SHOPIFY_SYNC_VARIANTS` off on a very large catalogue and the sync reads four
times as many products per request.

A product with several variants is reported as `variable` and the bot will not
add it to a cart, whether or not variants are read: choosing a size for somebody
is how you sell the wrong shirt.

## Webhooks

Not built here. The hosted adapter has one
(`adapters/shopify/src/webhooks/` in the platform repository) and it is more
involved than WooCommerce's, because Shopify signs a delivery with a secret it
generates per store rather than one you choose.

For a single shop that is actually an advantage: you *can* hold your own store's
secret. Copy that directory, pass `modules: [WebhookModule]` to `run()`, and set
`AGORAI_PLATFORM_URL` and `SHOPIFY_WEBHOOK_SECRET`. Without it products still
sync — on a schedule rather than the moment one changes.

## Layout

| File | What is in it |
| --- | --- |
| `src/adapter.ts` | the manifest, the ports, and `run()` |
| `src/config.ts` | the settings form, and where a value comes from |
| `src/client.ts` | one GraphQL call, and every way it can fail |
| `src/product.ts` | Shopify's product → the platform's, and money |
| `src/variants.ts` | variants, which come free with the product query |
| `src/cart.ts` | the Ajax cart recipes the widget performs |
| `src/identity.ts` | verifying the token the snippet signs |
| `src/types.ts` | only the fields these files actually read |
