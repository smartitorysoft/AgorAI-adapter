import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

import { ContextRequestDto } from './store-context.dto'

const MAX_CURSOR = 1024
const MAX_IDS_PER_CALL = 200
const MAX_PAGE_SIZE = 250

export class CatalogListOptionsDto {
  /** Opaque to the platform: whatever the adapter handed back last time. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR)
  cursor?: string

  @IsOptional()
  @IsISO8601()
  updatedSince?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number
}

export class CatalogListDto extends ContextRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogListOptionsDto)
  options?: CatalogListOptionsDto
}

export class CatalogGetDto extends ContextRequestDto {
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_CALL)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  ids!: string[]
}
