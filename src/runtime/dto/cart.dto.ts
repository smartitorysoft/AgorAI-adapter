import { Type } from 'class-transformer'
import {
  Allow,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

import type { AdapterCart, CartLineOp, CartOpMode } from '../../contract'
import { ContextRequestDto } from './store-context.dto'

const CART_MODES: CartOpMode[] = ['set', 'add', 'remove']
const MAX_QUANTITY = 999

export class CartLineOpDto implements CartLineOp {
  @IsString()
  @MaxLength(256)
  productId!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  variantId?: string | null

  @IsIn(CART_MODES)
  mode!: CartOpMode

  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity!: number
}

export class CartApplyDto extends ContextRequestDto {
  @ValidateNested()
  @Type(() => CartLineOpDto)
  op!: CartLineOpDto

  /**
   * The cart as it stands. Validated only as "an object" on purpose: it is
   * produced by the platform from this adapter's own `normalize`, never by a
   * shopper, and the signature check already establishes who is calling.
   */
  @IsOptional()
  @IsObject()
  cart?: AdapterCart
}

export class CartNormalizeDto extends ContextRequestDto {
  /**
   * Whatever the store answered. Arbitrary by definition, so it carries
   * `@Allow()` — without a decorator the whitelisting pipe would strip it.
   */
  @Allow()
  raw!: unknown
}
