import { ValidationPipe as NestValidationPipe } from '@nestjs/common'

/**
 * A single pre-built instance, matching the house style in consuela's
 * `src/utils/pipes/validation.pipe.ts`.
 *
 * `forbidNonWhitelisted` is what makes an unrecognised field an error rather
 * than something silently dropped: when the platform and an adapter disagree
 * about the contract, a loud 400 at the boundary beats a request that half
 * works.
 */
export const ValidationPipe = new NestValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
})
