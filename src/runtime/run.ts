import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import type { AgorAIAdapter } from '../contract'
import { AdapterModule } from './adapter.module'
import { buildManifest } from './define-adapter'
import { RuntimeOptions, type RunOptions } from './options'
import { ValidationPipe } from './validation.pipe'

/**
 * Boots the adapter's HTTP server. This is the whole deployment story: one
 * file, one `run()`, one container.
 */
export async function run(
  adapter: AgorAIAdapter,
  options: RunOptions = {}
): Promise<NestExpressApplication> {
  const logger = new Logger('AgorAIAdapter')
  const resolved = new RuntimeOptions(options)

  const app = await NestFactory.create<NestExpressApplication>(
    AdapterModule.register(adapter, resolved, options.modules ?? []),
    // The signature covers the bytes as sent. Re-serialising the parsed body
    // would change key order and whitespace, and every signature would fail.
    { rawBody: true, bufferLogs: false }
  )

  app.useGlobalPipes(ValidationPipe)
  if (resolved.globalPrefix) {
    app.setGlobalPrefix(resolved.globalPrefix)
  }

  // No CORS. Only the platform backend talks to an adapter, server to server;
  // a browser that can reach this directly is already a misconfiguration.
  await app.listen(resolved.port)

  const manifest = buildManifest(adapter)
  logger.log(
    `${manifest.name}@${manifest.version} listening on :${resolved.port} ` +
      `(contract v${manifest.contractVersion}, sdk ${manifest.sdkVersion})`
  )
  logger.log(`Capabilities: ${describeCapabilities(manifest)}`)

  if (resolved.allowUnsigned) {
    logger.warn(
      'Request signatures are DISABLED. Never run this way outside local development.'
    )
  }

  return app
}

function describeCapabilities(
  manifest: ReturnType<typeof buildManifest>
): string {
  const { capabilities } = manifest
  const parts = ['catalog']
  if (capabilities.catalog.categories) parts.push('categories')
  if (capabilities.catalog.incrementalSync) parts.push('incremental-sync')
  if (capabilities.cart.supported) parts.push(`cart(${capabilities.cart.mode})`)
  if (capabilities.navigation.supported) {
    parts.push(`navigation(${capabilities.navigation.kinds.join('|')})`)
  }
  if (capabilities.customer.identity) parts.push('identity')
  if (capabilities.customer.orders) parts.push('orders')
  if (capabilities.webhooks.supported) parts.push('webhooks')
  return parts.join(', ')
}
