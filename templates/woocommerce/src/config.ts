/**
 * What a WooCommerce project needs, and where a value comes from.
 *
 * The keys are the same ones consuela read from its `.env`, so migrating an
 * existing single-store deployment is a copy-paste rather than a translation.
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
 */
import {
  AdapterConfigError,
  type ConfigSchemaInput,
  type StoreContext,
} from '@smartitory/agorai-adapter'

export const CONFIG: ConfigSchemaInput = {
  WOOCOMMERCE_URL: {
    type: 'url',
    required: true,
    label: { en: 'Store URL', hu: 'Webáruház URL' },
    help: {
      en: 'Your shop’s address, e.g. https://shop.example.com — no trailing path.',
      hu: 'A webáruház címe, pl. https://shop.example.com — útvonal nélkül.',
    },
  },
  WOOCOMMERCE_CONSUMER_KEY: {
    type: 'secret',
    required: true,
    label: { en: 'Consumer key', hu: 'Consumer key' },
    help: {
      en: 'WooCommerce → Settings → Advanced → REST API → Add key, with Read permission.',
      hu: 'WooCommerce → Beállítások → Haladó → REST API → Kulcs hozzáadása, olvasási joggal.',
    },
  },
  WOOCOMMERCE_CONSUMER_SECRET: {
    type: 'secret',
    required: true,
    label: { en: 'Consumer secret', hu: 'Consumer secret' },
  },
  WP_IDENTITY_SECRET: {
    type: 'secret',
    required: false,
    label: { en: 'Identity secret', hu: 'Azonosítási titok' },
    help: {
      en: 'Must equal AGORAI_IDENTITY_SECRET in wp-config.php. Without it every shopper is treated as a guest.',
      hu: 'Egyeznie kell a wp-config.php AGORAI_IDENTITY_SECRET értékével. Enélkül minden vásárló vendégként jelenik meg.',
    },
    section: { en: 'Logged-in shoppers', hu: 'Bejelentkezett vásárlók' },
  },
  CUSTOMER_ORDERS_LIMIT: {
    type: 'number',
    required: false,
    default: '3',
    label: { en: 'Past orders to read', hu: 'Beolvasott korábbi rendelések' },
    help: {
      en: 'How many recent orders the bot may use as background context.',
      hu: 'Hány korábbi rendelést használhat a bot háttérinformációként.',
    },
    validate: { min: 0, max: 20 },
    section: { en: 'Logged-in shoppers', hu: 'Bejelentkezett vásárlók' },
  },
  WOOCOMMERCE_SYNC_VARIANTS: {
    type: 'boolean',
    required: false,
    default: 'false',
    label: { en: 'Read product variations', hu: 'Változatok beolvasása' },
    help: {
      en: 'Costs one extra request per variable product on every sync. Turn it on only if answers need to mention sizes or colours — the bot still cannot add a variable product to a cart either way.',
      hu: 'Szinkronizálásonként egy extra kérés minden változatos terméknél. Csak akkor kapcsold be, ha a válaszoknak méretet vagy színt kell említeniük — a bot változatos terméket így sem tud kosárba tenni.',
    },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
  WOOCOMMERCE_CURRENCY: {
    type: 'string',
    required: false,
    label: { en: 'Currency override', hu: 'Pénznem felülírása' },
    help: {
      en: 'Leave blank to read the shop’s own currency. Set an ISO code (HUF, EUR) only if that lookup is blocked.',
      hu: 'Hagyd üresen, hogy a bolt saját pénznemét olvassuk. Csak akkor állítsd be (HUF, EUR), ha a lekérdezés tiltott.',
    },
    validate: { pattern: '^[A-Z]{3}$' },
    section: { en: 'Advanced', hu: 'Haladó' },
  },
}

export type WooCredentials = {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
}

/**
 * A config value from the project, falling back to the environment.
 *
 * Blank counts as absent: an admin who clears a field means "unset", and an
 * empty string reaching an HMAC or a URL fails much further downstream.
 */
export function setting(ctx: StoreContext, key: string): string {
  const fromProject = ctx.config[key]?.trim() ?? ''
  if (fromProject.length > 0) return fromProject
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

export function credentials(ctx: StoreContext): WooCredentials {
  return {
    // Trailing slashes are the single most common way to get `//wp-json` into
    // an upstream URL, which WordPress answers with a redirect that drops the
    // Authorization header.
    baseUrl: requiredSetting(ctx, 'WOOCOMMERCE_URL').replace(/\/+$/, ''),
    consumerKey: requiredSetting(ctx, 'WOOCOMMERCE_CONSUMER_KEY'),
    consumerSecret: requiredSetting(ctx, 'WOOCOMMERCE_CONSUMER_SECRET'),
  }
}

function fromEnvironment(key: string): string {
  return process.env[key]?.trim() ?? ''
}
