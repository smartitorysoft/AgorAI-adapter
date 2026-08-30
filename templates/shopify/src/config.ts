/**
 * What a Shopify project needs, and where a value comes from.
 *
 * Two addresses, which is the one thing about Shopify that surprises everybody:
 * a shop is reached for data at `something.myshopify.com` and browsed by
 * shoppers at whatever domain it sells under. They are rarely the same string,
 * and only one of them can carry `role: 'storeUrl'` — the storefront one, since
 * that is the origin the widget has to be allowed to run on and the origin its
 * cart requests are made against. `health()` warns when the two disagree with
 * what the shop itself reports, because the failure is otherwise silent: the
 * advisor renders and every cart call quietly cross-origins to a domain holding
 * none of the shopper's cookies.
 *
 * Two sources, in order:
 *
 *  1. `ctx.config` — what the shop admin typed on the project's Store screen.
 *     This is what makes ONE deployment serve MANY stores, and it is the only
 *     source the hosted adapter ever uses.
 *  2. `process.env` — the fallback, for a shop self-hosting this template as a
 *     single-store adapter. Put the values in `.env` and the Store screen can
 *     be left blank.
 *
 * Delete `fromEnvironment` below if you are running multi-tenant: an env
 * fallback in a shared deployment means every project silently inherits one
 * store's credentials when a field is left empty.
 *
 * Every key in `CONFIG` is readable this way, `SHOPIFY_API_VERSION` included —
 * a self-hoster pinned to a version through `.env` would otherwise silently
 * fall back to the constant above.
 */
import {
  AdapterConfigError,
  type ConfigSchemaInput,
  type StoreContext,
} from '@smartitory/agorai-adapter'

/**
 * The Admin API version this adapter's queries are written against.
 *
 * Shopify ships one every quarter and supports each for at least a year, so
 * this is a constant with an expiry date rather than a constant. Bumping it
 * means re-reading the queries against that version's schema — fields are
 * deprecated on this cadence, which is why `featuredImage` is not used below.
 * `SHOPIFY_API_VERSION` overrides it per project, so a shop can move ahead of a
 * deployment without waiting for one.
 */
export const DEFAULT_API_VERSION = '2026-07'

/** Where Shopify's own metafields live for most shops. */
export const DEFAULT_METAFIELD_NAMESPACE = 'custom'

export const CONFIG: ConfigSchemaInput = {
  SHOPIFY_STORE_URL: {
    type: 'url',
    required: true,
    // The platform reads this one by meaning rather than by name: it is the
    // address a shopper's browser loads pages from, so its origin is the one
    // authorised to embed the widget. Not the myshopify domain — a shop that
    // sells under its own name never serves a page from that address.
    role: 'storeUrl',
    label: { en: 'Storefront URL', hu: 'Bolt címe' },
    help: {
      en: 'Where shoppers browse, e.g. https://shop.example.com. Use your own domain if you have one — this origin is what may embed the advisor, and where its cart requests go.',
      hu: 'Ahol a vásárlók böngésznek, pl. https://shop.example.com. Ha van saját domained, azt add meg — ez az origin ágyazhatja be a tanácsadót, és ide mennek a kosárkérései.',
    },
  },
  SHOPIFY_SHOP_DOMAIN: {
    type: 'string',
    required: true,
    label: { en: 'Shopify domain', hu: 'Shopify domain' },
    help: {
      en: 'The permanent one the Admin API answers on, e.g. my-shop.myshopify.com. Shopify admin → Settings → Domains.',
      hu: 'Az állandó cím, amin az Admin API válaszol, pl. my-shop.myshopify.com. Shopify admin → Beállítások → Domainek.',
    },
    // Deliberately permissive about a scheme and a port: that is the seam the
    // contract test's fake shop runs through, the same way the WooCommerce
    // adapter's OAuth branch exists for a shop on plain `http://`.
    validate: { pattern: String.raw`^(https?://)?[\da-z][\da-z.-]*(:\d+)?/?$` },
  },
  SHOPIFY_ADMIN_TOKEN: {
    type: 'secret',
    required: true,
    label: { en: 'Admin API access token', hu: 'Admin API hozzáférési token' },
    help: {
      en: 'Shopify admin → Settings → Apps and sales channels → Develop apps → your app → API credentials. Starts with shpat_ and is shown once. Scopes: read_products and read_inventory, plus read_customers and read_orders for order history.',
      hu: 'Shopify admin → Beállítások → Alkalmazások → Alkalmazásfejlesztés → az alkalmazásod → API hitelesítés. shpat_ kezdetű, és csak egyszer látszik. Jogosultságok: read_products és read_inventory, illetve read_customers és read_orders a rendelési előzményekhez.',
    },
  },
  SHOPIFY_IDENTITY_SECRET: {
    type: 'secret',
    required: false,
    // Both sides have to hold the same value and neither should be inventing
    // one: the platform mints it, and the theme snippet download carries it.
    generated: true,
    label: { en: 'Identity secret', hu: 'Azonosítási titok' },
    help: {
      en: 'Generated for you and baked into the theme snippet below. Without it every shopper is a guest.',
      hu: 'Automatikusan generált, és belekerül az alábbi sablonrészletbe. Enélkül minden vásárló vendégként jelenik meg.',
    },
    section: { en: 'Logged-in shoppers', hu: 'Bejelentkezett vásárlók' },
  },
  CUSTOMER_ORDERS_LIMIT: {
    type: 'number',
    required: false,
    default: '3',
    label: { en: 'Past orders to read', hu: 'Beolvasott korábbi rendelések' },
    help: {
      en: 'How many recent orders the bot may use as background context. Shopify serves the last 60 days unless your app has been granted read_all_orders.',
      hu: 'Hány korábbi rendelést használhat a bot háttérinformációként. A Shopify alapból az utolsó 60 napot adja vissza, read_all_orders jogosultság nélkül.',
    },
    validate: { min: 0, max: 20 },
    section: { en: 'Logged-in shoppers', hu: 'Bejelentkezett vásárlók' },
  },
  SHOPIFY_SYNC_VARIANTS: {
    type: 'boolean',
    required: false,
    default: 'true',
    label: { en: 'Read product variants', hu: 'Változatok beolvasása' },
    help: {
      en: 'Shopify prices a query by how much it returns, so reading every variant means smaller pages and a slower sync. Worth it when sizes or colours differ in price or stock.',
      hu: 'A Shopify a lekérdezés méretét árazza, így minden változat beolvasása kisebb lapokat és lassabb szinkront jelent. Akkor éri meg, ha a méretek vagy színek ára, készlete eltér.',
    },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
  SHOPIFY_METAFIELD_NAMESPACE: {
    type: 'string',
    required: false,
    default: DEFAULT_METAFIELD_NAMESPACE,
    label: { en: 'Metafield namespace', hu: 'Metamező névtér' },
    help: {
      en: 'Which metafields become product attributes. Leave as “custom” unless your shop keeps them elsewhere; reading every namespace pulls other apps’ private data into the index.',
      hu: 'Mely metamezőkből lesz terméktulajdonság. Hagyd „custom” értéken, hacsak a boltod máshol tárolja őket; minden névtér beolvasása más alkalmazások privát adatait is az indexbe hozza.',
    },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
  SHOPIFY_API_VERSION: {
    type: 'string',
    required: false,
    default: DEFAULT_API_VERSION,
    label: { en: 'Admin API version', hu: 'Admin API verzió' },
    help: {
      en: 'Leave it alone unless Shopify retires this one. Format: 2026-07.',
      hu: 'Csak akkor módosítsd, ha a Shopify kivezeti ezt. Formátum: 2026-07.',
    },
    validate: { pattern: String.raw`^\d{4}-\d{2}$` },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
  SHOPIFY_CART_PATH_PREFIX: {
    type: 'string',
    required: false,
    label: { en: 'Market path prefix', hu: 'Piac útvonal-előtag' },
    help: {
      en: 'Only for a shop selling through Shopify Markets under a path, e.g. /en-ca. Leave blank otherwise.',
      hu: 'Csak akkor, ha a bolt Shopify Markets alatt, útvonal-előtaggal árul, pl. /en-ca. Egyébként hagyd üresen.',
    },
    validate: { pattern: '^(/[a-z]{2}(-[a-z]{2})?)?$' },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
  SHOPIFY_CURRENCY: {
    type: 'string',
    required: false,
    label: { en: 'Currency override', hu: 'Pénznem felülírása' },
    help: {
      en: 'Leave blank to use the shop’s own currency. Set an ISO code only if this shop sells in several and the catalogue should be indexed in another one.',
      hu: 'Hagyd üresen, hogy a bolt saját pénzneme érvényesüljön. Csak akkor adj meg ISO kódot, ha a bolt többféle pénznemben árul, és a katalógust másikban kell indexelni.',
    },
    validate: { pattern: '^[A-Z]{3}$' },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
}

export type ShopifyCredentials = {
  /** Origin only, scheme included: `https://my-shop.myshopify.com`. */
  adminUrl: string
  adminToken: string
  apiVersion: string
}

/**
 * A config value from the project.
 *
 * Blank counts as absent: an admin who clears a field means "unset", and an
 * empty string reaching an HMAC or a URL fails much further downstream.
 */
export function setting(ctx: StoreContext, key: string): string {
  const value = ctx.config[key]?.trim() ?? ''
  if (value.length > 0) return value
  return fromEnvironment(key)
}

export function requiredSetting(ctx: StoreContext, key: string): string {
  const value = setting(ctx, key)
  if (value.length === 0) {
    throw new AdapterConfigError(
      `Missing required configuration "${key}".`,
      `Set "${key}" on the project's Store screen.`
    )
  }
  return value
}

export function numericSetting(
  ctx: StoreContext,
  key: string,
  fallback: number
): number {
  const raw = setting(ctx, key)
  if (raw.length === 0) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new AdapterConfigError(`Configuration "${key}" must be a number.`)
  }
  return value
}

/** A boolean config value. It arrives as the string `'true'` or `'false'`. */
export function booleanSetting(ctx: StoreContext, key: string): boolean {
  const raw = setting(ctx, key).toLowerCase()
  return raw === 'true' || raw === '1'
}

/** Where a shopper browses, without its trailing slash. */
export function storefrontUrl(ctx: StoreContext): string {
  return requiredSetting(ctx, 'SHOPIFY_STORE_URL').replace(/\/+$/, '')
}

export function credentials(ctx: StoreContext): ShopifyCredentials {
  const domain = requiredSetting(ctx, 'SHOPIFY_SHOP_DOMAIN').replace(/\/+$/, '')
  return {
    // A pasted admin URL is the common mistake, and the field accepts a scheme
    // for the contract test's sake, so both shapes have to land on an origin.
    adminUrl: domain.includes('://') ? domain : `https://${domain}`,
    adminToken: requiredSetting(ctx, 'SHOPIFY_ADMIN_TOKEN'),
    apiVersion: setting(ctx, 'SHOPIFY_API_VERSION') || DEFAULT_API_VERSION,
  }
}

/** The namespace product attributes are read from. */
export function metafieldNamespace(ctx: StoreContext): string {
  return (
    setting(ctx, 'SHOPIFY_METAFIELD_NAMESPACE') || DEFAULT_METAFIELD_NAMESPACE
  )
}

/** The single-store fallback. See the note at the top of this file. */
function fromEnvironment(key: string): string {
  return process.env[key]?.trim() ?? ''
}
