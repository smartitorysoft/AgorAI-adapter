import {
  CONTRACT_VERSION,
  type AdapterCapabilities,
  type AdapterDefinition,
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

  if (definition.cart?.mode === 'client' && !definition.cart.normalize) {
    throw new Error(
      'A client-mode cart must provide normalize(): the widget hands back the ' +
        "store's raw response and only the adapter knows how to read it."
    )
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
    ...(adapter.documentationUrl
      ? { documentationUrl: adapter.documentationUrl }
      : {}),
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
