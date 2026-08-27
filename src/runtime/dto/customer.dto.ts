import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator'

import { ContextRequestDto } from './store-context.dto'

const MAX_TOKEN = 8192
const MAX_ORDERS = 50

export class CustomerResolveDto extends ContextRequestDto {
  /** The storefront's signed identity blob, opaque to the platform. */
  @IsString()
  @MaxLength(MAX_TOKEN)
  token!: string
}

export class CustomerOrdersDto extends ContextRequestDto {
  @IsString()
  @MaxLength(256)
  customerId!: string

  @IsInt()
  @Min(1)
  @Max(MAX_ORDERS)
  limit!: number
}
