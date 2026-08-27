import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'

import {
  type AdapterErrorCode,
  type AdapterErrorResponse,
  AdapterRateLimitedError,
  isAdapterError,
  statusForAdapterError,
} from '../contract'

/**
 * Turns anything thrown inside an adapter into the one error envelope the
 * platform understands.
 *
 * The important rule is the last branch: an error that is not an `AdapterError`
 * has its message replaced rather than forwarded. Adapters talk to stores using
 * credentials, and upstream client libraries habitually put the failing URL —
 * query string, API key and all — into the message. Forwarding that would write
 * a shop's secrets into the platform's logs.
 */
@Catch()
export class AdapterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AdapterException')

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const requestId = requestIdOf(request)

    const { status, body } = this.render(exception, requestId)

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : undefined
      )
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} ${body.error.code}: ${body.error.message}`
      )
    }

    if (
      exception instanceof AdapterRateLimitedError &&
      exception.retryAfterSeconds
    ) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds))
    }

    response.status(status).json(body)
  }

  private render(
    exception: unknown,
    requestId: string | undefined
  ): { status: number; body: AdapterErrorResponse } {
    if (isAdapterError(exception)) {
      return {
        status: statusForAdapterError(exception.code),
        body: envelope(
          exception.code,
          exception.message,
          requestId,
          exception.detail,
          exception instanceof AdapterRateLimitedError
            ? exception.retryAfterSeconds
            : undefined
        ),
      }
    }

    // Validation failures arrive here as Nest HttpExceptions. Their bodies are
    // safe to surface: they describe the request we were sent, not the store.
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      return {
        status,
        body: envelope(
          status === 400 || status === 422 ? 'INVALID_REQUEST' : 'INTERNAL',
          exception.message,
          requestId,
          detailFrom(exception)
        ),
      }
    }

    return {
      status: 500,
      body: envelope(
        'INTERNAL',
        'The adapter failed to handle the request.',
        requestId
      ),
    }
  }
}

function envelope(
  code: AdapterErrorCode,
  message: string,
  requestId: string | undefined,
  detail?: string,
  retryAfterSeconds?: number
): AdapterErrorResponse {
  return {
    error: {
      code,
      message,
      ...(detail ? { detail } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
    ...(requestId ? { requestId } : {}),
  }
}

/** Pulls class-validator's per-field messages out of a Nest HttpException. */
function detailFrom(exception: HttpException): string | undefined {
  const body = exception.getResponse()
  if (typeof body === 'string') return undefined
  const { message } = body as { message?: unknown }
  if (Array.isArray(message)) return message.join('; ')
  return typeof message === 'string' ? message : undefined
}

function requestIdOf(request: Request): string | undefined {
  const body = request.body as { context?: { requestId?: unknown } } | undefined
  const id = body?.context?.requestId
  return typeof id === 'string' ? id : undefined
}
