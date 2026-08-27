import { Type } from 'class-transformer'
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

import { NAVIGATION_KINDS, type NavigationKind } from '../../contract'
import { ContextRequestDto } from './store-context.dto'

const MAX_QUERY = 500

/**
 * The flattened wire form of `NavigationTarget`.
 *
 * The contract type is a discriminated union, which class-validator cannot
 * express directly, so the transport carries every field as optional and the
 * controller narrows it back into the union.
 */
export class NavigationTargetDto {
  @IsIn(NAVIGATION_KINDS)
  kind!: NavigationKind

  /** Set for `product` and `category`. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  id?: string

  /** Set for `search`. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY)
  query?: string

  /** Set for `page`. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  slug?: string
}

export class NavigationResolveDto extends ContextRequestDto {
  @ValidateNested()
  @Type(() => NavigationTargetDto)
  target!: NavigationTargetDto
}
