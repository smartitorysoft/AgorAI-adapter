import type { DynamicModule, Type } from '@nestjs/common'

const DEFAULT_PORT = 4000
const DEFAULT_TOLERANCE_SECONDS = 300

/**
 * What an adapter author may override when calling `run()`. Everything has an
 * environment-variable equivalent, because the deployment story is "one
 * container, configured with env".
 */
export type RunOptions = {
  /** Defaults to `PORT`, then 4000. */
  port?: number
  /** Defaults to `ADAPTER_SHARED_SECRET`. */
  sharedSecret?: string
  /**
   * Accept unsigned requests. Local development only — `run()` refuses to start
   * with this on unless `NODE_ENV` is not `production`.
   */
  allowUnsigned?: boolean
  /** Replay window either side of the signed timestamp. Defaults to 300s. */
  signatureToleranceSeconds?: number
  /** Mounted under this prefix, e.g. `adapter`. Routes are `/v1/...` by default. */
  globalPrefix?: string
  /**
   * Extra Nest modules to compose alongside the adapter's own.
   *
   * The one thing this is for: a **store-facing** endpoint. Every route `run()`
   * mounts is platform-facing and signed, but a store that wants to push
   * changes — a WooCommerce webhook, say — calls the adapter directly, and
   * there is no `run()` option that could describe such a route generically.
   *
   * `APP_GUARD` still covers whatever these mount, so a store-facing route has
   * to opt out with `@SkipSignature()` **and authenticate itself some other
   * way**. Read that decorator's comment before using it.
   */
  modules?: Array<DynamicModule | Type>
}

/** Resolved, validated runtime configuration. A class so Nest can inject it. */
export class RuntimeOptions {
  readonly port: number

  readonly sharedSecret: string

  readonly allowUnsigned: boolean

  readonly signatureToleranceSeconds: number

  readonly globalPrefix?: string

  constructor(options: RunOptions, env: NodeJS.ProcessEnv = process.env) {
    this.port = options.port ?? numberFrom(env.PORT) ?? DEFAULT_PORT
    this.sharedSecret = options.sharedSecret ?? env.ADAPTER_SHARED_SECRET ?? ''
    this.allowUnsigned =
      options.allowUnsigned ?? env.ADAPTER_ALLOW_UNSIGNED === 'true'
    this.signatureToleranceSeconds =
      options.signatureToleranceSeconds ??
      numberFrom(env.ADAPTER_SIGNATURE_TOLERANCE_SECONDS) ??
      DEFAULT_TOLERANCE_SECONDS
    this.globalPrefix = options.globalPrefix ?? env.ADAPTER_GLOBAL_PREFIX

    this.assertUsable(env)
  }

  /**
   * Fails closed. An adapter holds live store credentials on every request, so
   * starting one that accepts unsigned traffic in production would expose a
   * shop's whole catalogue and order history to anyone who finds the URL.
   */
  private assertUsable(env: NodeJS.ProcessEnv): void {
    const isProduction = env.NODE_ENV === 'production'

    if (this.allowUnsigned) {
      if (isProduction) {
        throw new Error(
          'ADAPTER_ALLOW_UNSIGNED is set in production. Refusing to start: the ' +
            'adapter would accept store requests from anyone who can reach it.'
        )
      }
      return
    }

    if (this.sharedSecret.length < 32) {
      throw new Error(
        'ADAPTER_SHARED_SECRET must be set and at least 32 characters. ' +
          'Generate one with `openssl rand -hex 32` and paste the same value ' +
          "into the project's Store screen on the platform."
      )
    }
  }
}

function numberFrom(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
