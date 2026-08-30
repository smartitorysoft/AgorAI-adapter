import {
  CONTRACT_VERSION,
  type AdapterCapabilities,
  type AdapterDefinition,
  type AdapterDownload,
  type AdapterManifest,
  type AgorAIAdapter,
  type LocalizedText,
  type NavigationKind,
  toConfigSchema,
} from '../contract'
import { SDK_VERSION } from './version'

/**
 * Navigation targets assumed when an adapter provides a navigation port but does
 * not say which targets it handles. These three are what consuela used and what
 * effectively every storefront has; anything less common has to be declared.
 */
const DEFAULT_NAVIGATION_KINDS: NavigationKind[] = [
  'cart',
  'checkout',
  'product',
]

const NAME_PATTERN = /^[a-z][\da-z-]{1,38}[\da-z]$/

/**
 * Where a logo may come from.
 *
 * `http:` is excluded rather than forgotten: the admin UI is served over TLS,
 * and a mixed-content image is one a browser refuses to draw — a picker with a
 * broken card on it is worse than one with no card art at all.
 */
const LOGO_SCHEMES = ['data:image/', 'https://']

/**
 * Hex only, and validated here rather than trusted.
 *
 * The platform sets this as a CSS custom property on the picker's card, so the
 * narrow grammar is the point: a colour that cannot be anything but a colour
 * cannot become a style the adapter's author chose for somebody else's admin UI.
 */
const BRAND_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

/**
 * Validates an adapter definition and freezes it.
 *
 * The checks here are deliberately loud and at startup rather than lenient and
 * at request time: a config schema with a `select` field and no options, or a
 * cart port with no `normalize`, produces an adapter that looks healthy and then
 * fails in front of a shopper.
 */
export function defineAdapter(definition: AdapterDefinition): AgorAIAdapter {
  assertValid(definition)
  return Object.freeze({
    ...definition,
    __agoraiAdapter: true as const,
  })
}

function assertValid(definition: AdapterDefinition): void {
  if (!NAME_PATTERN.test(definition.name)) {
    throw new Error(
      `Adapter name "${definition.name}" must be lowercase kebab-case, 3-40 characters.`
    )
  }

  if (!definition.version) {
    throw new Error('Adapter definition is missing a version.')
  }

  for (const [key, field] of Object.entries(definition.config)) {
    if (!field.label?.en) {
      throw new Error(`Config field "${key}" needs an English label.`)
    }
    if (field.type === 'select' && !field.options?.length) {
      throw new Error(`Config field "${key}" is a select but has no options.`)
    }
    if (field.type === 'secret' && field.default !== undefined) {
      throw new Error(
        `Config field "${key}" is a secret and must not carry a default.`
      )
    }
  }

  assertStoreUrlRole(definition)
  assertDownloadDependencies(definition)

  const { logo } = definition
  if (logo && !LOGO_SCHEMES.some((scheme) => logo.startsWith(scheme))) {
    throw new Error(
      'Adapter logo must be a data:image/… URI or an https:// URL, got ' +
        `"${logo.slice(0, 32)}…".`
    )
  }

  const { brandColor } = definition
  if (brandColor && !BRAND_COLOR_PATTERN.test(brandColor)) {
    throw new Error(
      `Adapter brandColor must be #rgb or #rrggbb, got "${brandColor}".`
    )
  }

  if (definition.cart?.mode === 'client' && !definition.cart.normalize) {
    throw new Error(
      'A client-mode cart must provide normalize(): the widget hands back the ' +
        "store's raw response and only the adapter knows how to read it."
    )
  }
}

/**
 * At most one config field may claim to be the store's address, and it has to
 * be one the platform can rely on.
 *
 * The platform reads this field's value to authorise the origin allowed to
 * embed the widget. A second one would make "the store URL" ambiguous, and an
 * optional one would make it absent — both turn a silent CORS failure on a
 * shopper's page into the shop admin's problem to diagnose.
 */
function assertStoreUrlRole(definition: AdapterDefinition): void {
  const claimed = Object.entries(definition.config).filter(
    ([, field]) => field.role === 'storeUrl'
  )

  if (claimed.length > 1) {
    throw new Error(
      `Config fields ${claimed.map(([key]) => `"${key}"`).join(', ')} all ` +
        "claim role 'storeUrl'. Only one field may be the store's address."
    )
  }

  const [entry] = claimed
  if (!entry) return

  const [key, field] = entry
  if (field.type !== 'url' || !field.required) {
    throw new Error(
      `Config field "${key}" has role 'storeUrl' and must therefore be a ` +
        'required url field.'
    )
  }
}

/**
 * A download may only depend on config keys this adapter actually declares.
 *
 * Caught at startup rather than at download time, because the failure is
 * invisible from the shop's side: the platform silently cannot fingerprint a
 * key that does not exist, so the file quietly never goes stale and a rotated
 * secret is never noticed by anyone.
 */
function assertDownloadDependencies(definition: AdapterDefinition): void {
  const declared = new Set(Object.keys(definition.config))

  for (const download of definition.downloads ?? []) {
    for (const key of [
      ...(download.dependsOn ?? []),
      ...(download.requires ?? []),
    ]) {
      if (!declared.has(key)) {
        throw new Error(
          `Download "${download.key}" depends on config field "${key}", ` +
            'which this adapter does not declare.'
        )
      }
    }
  }
}

/** Builds the manifest the platform fetches, inferring what it can from the ports. */
export function buildManifest(adapter: AgorAIAdapter): AdapterManifest {
  return {
    name: adapter.name,
    displayName: adapter.displayName ?? fallbackDisplayName(adapter.name),
    version: adapter.version,
    sdkVersion: SDK_VERSION,
    contractVersion: CONTRACT_VERSION,
    configSchema: toConfigSchema(adapter.config),
    capabilities: buildCapabilities(adapter),
    ...(adapter.productAttributes
      ? { productAttributes: adapter.productAttributes }
      : {}),
    /*
     * Declared only when there is also something to render them with. An
     * adapter that lists a file and cannot produce it would put a button on the
     * Store screen that fails when pressed, which is worse than no button.
     */
    ...(adapter.downloads?.length && adapter.render
      ? { downloads: adapter.downloads.map((entry) => toDownload(entry)) }
      : {}),
    ...(adapter.logo ? { logo: adapter.logo } : {}),
    ...(adapter.brandColor ? { brandColor: adapter.brandColor } : {}),
    ...(adapter.documentationUrl
      ? { documentationUrl: adapter.documentationUrl }
      : {}),
  }
}

/**
 * `requires` folded into `dependsOn`, so the platform reads one complete list.
 *
 * A key that must be filled in is by definition one the file is built from, and
 * making an author write it twice is an invitation to write it once.
 */
function toDownload(download: AdapterDownload): AdapterDownload {
  const dependsOn = [
    ...new Set([...(download.dependsOn ?? []), ...(download.requires ?? [])]),
  ]

  return {
    ...download,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  }
}

function buildCapabilities(adapter: AgorAIAdapter): AdapterCapabilities {
  const declared = adapter.capabilities ?? {}

  return {
    catalog: {
      incrementalSync: declared.incrementalSync ?? false,
      categories: typeof adapter.catalog.categories === 'function',
      variants: declared.variants ?? false,
    },
    cart: {
      supported: Boolean(adapter.cart),
      // Reported even when unsupported so the field is never absent; the
      // platform reads it only when `supported` is true.
      mode: adapter.cart?.mode ?? 'server',
    },
    navigation: {
      supported: Boolean(adapter.navigation),
      kinds: adapter.navigation
        ? (declared.navigation ?? DEFAULT_NAVIGATION_KINDS)
        : [],
    },
    customer: {
      identity: typeof adapter.customer?.resolveIdentity === 'function',
      orders: typeof adapter.customer?.listOrders === 'function',
    },
    webhooks: {
      supported: declared.webhooks ?? false,
    },
  }
}

/** `acme-store` -> `Acme Store`, so an adapter without a display name still reads. */
function fallbackDisplayName(name: string): LocalizedText {
  const en = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return { en }
}
