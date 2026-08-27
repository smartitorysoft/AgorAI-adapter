import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { AdapterSignatureError } from '../contract'
import { RuntimeOptions } from './options'
import { SKIP_SIGNATURE } from './public.decorator'
import { signatureHeaders, verifySignature } from './sign'

/**
 * Authenticates the platform to the adapter.
 *
 * The scheme itself lives in `sign.ts`, next to the signer, because the same
 * verification runs on the platform side for an adapter's reindex webhook —
 * see `verifySignature`.
 *
 * Every rejection is the same generic message. Telling a caller whether the
 * timestamp or the signature was wrong is free information for someone probing.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name)

  /**
   * `RuntimeOptions` is injected by explicit token rather than by parameter
   * type. `emitDecoratorMetadata` only records a class it can see as a *value*,
   * and a `import type` (which is what lint prefers for a type-position use)
   * erases it to `Function` — which Nest then cannot resolve.
   */
  constructor(
    private readonly reflector: Reflector,
    @Inject(RuntimeOptions) private readonly options: RuntimeOptions
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SIGNATURE, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) return true

    if (this.options.allowUnsigned) return true

    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>()

    // `rawBody` is populated by `NestFactory.create(..., { rawBody: true })`.
    // Re-serialising the parsed body would not do: key order and whitespace
    // would differ from what the platform signed.
    const result = verifySignature({
      raw: request.rawBody ?? Buffer.alloc(0),
      ...signatureHeaders(request.headers),
      secret: this.options.sharedSecret,
      toleranceSeconds: this.options.signatureToleranceSeconds,
    })

    if (!result.ok) {
      if (result.reason === 'stale') {
        this.logger.warn(
          'Rejected a request whose timestamp was outside the replay window. Check the clock on the platform host.'
        )
      }
      throw new AdapterSignatureError()
    }
    return true
  }
}
