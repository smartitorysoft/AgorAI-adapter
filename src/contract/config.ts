/**
 * The config schema an adapter declares, and which the platform turns directly
 * into the project's settings form.
 *
 * This is the mechanism behind "the shop owner only has to fill in env
 * variables": the adapter is the one thing that knows what a store connection
 * needs, so it says so, and the UI is generated rather than written per store.
 */

/** Human-facing text, keyed by locale. `en` is the required fallback. */
export type LocalizedText = {
  en: string
} & Record<string, string>

export type ConfigFieldType =
  'string' | 'secret' | 'url' | 'number' | 'boolean' | 'select'

export type ConfigFieldOption = {
  value: string
  label: LocalizedText
}

export type ConfigFieldValidation = {
  /** JS-flavoured regex source, applied to the raw string value. */
  pattern?: string
  /** Inclusive bounds. On `string`/`secret`/`url` they bound the length. */
  min?: number
  max?: number
}

export type ConfigField = {
  key: string
  type: ConfigFieldType
  required: boolean
  label: LocalizedText
  help?: LocalizedText
  /** Prefilled in the form. Never use this for a secret. */
  default?: string
  /**
   * The platform mints this value instead of the admin inventing one.
   *
   * On the first save that leaves it empty the platform writes a random
   * 32-byte hex string. The field still renders and is still editable — a shop
   * migrating from a secret it already has must be able to paste that one in —
   * but nobody has to run `openssl rand` to get started, and nobody ends up
   * with `changeme` in production.
   *
   * Only meaningful on `secret`. A generated value is stored and read back
   * exactly like a typed one, so nothing downstream knows the difference.
   */
  generated?: boolean
  /**
   * This field holds the storefront's own address.
   *
   * The platform cannot otherwise tell which of an adapter's config keys is a
   * URL a browser loads pages from, and it needs to: that origin is the one
   * allowed to embed the widget, and a shop that has to work that out for
   * itself gets a widget that silently never appears. At most one field per
   * adapter may carry this, and it must be a required `url`.
   */
  role?: 'storeUrl'
  /** Required when `type` is `'select'`, ignored otherwise. */
  options?: ConfigFieldOption[]
  validate?: ConfigFieldValidation
  /**
   * Groups fields into labelled sections in the UI. Fields with no section
   * render first, in declaration order.
   */
  section?: LocalizedText
}

/**
 * What an adapter author writes. The key is the config key, so it cannot drift
 * from the field it describes.
 */
export type ConfigSchemaInput = Record<
  string,
  Omit<ConfigField, 'key'> & { key?: never }
>

/** The normalized array form that travels in the manifest. */
export type ConfigSchema = ConfigField[]

export function toConfigSchema(input: ConfigSchemaInput): ConfigSchema {
  return Object.entries(input).map(([key, field]) => ({ ...field, key }))
}

/**
 * Whether a value for this field should be redacted in logs and write-only in
 * the UI. Kept as a function rather than a bare `=== 'secret'` comparison so
 * adding another sensitive type later touches one place.
 */
export function isSecretField(field: ConfigField): boolean {
  return field.type === 'secret'
}
