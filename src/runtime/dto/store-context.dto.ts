import { Type } from 'class-transformer'
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

import type { StoreContextData } from '../../contract'
import { IsStringRecord } from './is-string-record'

const MAX_IDENTITY_TOKEN = 8192

export class StoreContextDto implements StoreContextData {
  @IsString()
  @MaxLength(64)
  projectId!: string

  @IsStringRecord()
  config!: Record<string, string>

  @IsString()
  @MaxLength(35)
  locale!: string

  @IsOptional()
  @IsStringRecord()
  storeSession?: Record<string, string>

  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTITY_TOKEN)
  identityToken?: string

  @IsString()
  @MaxLength(64)
  requestId!: string
}

/** Base for every POST body on the adapter surface. */
export class ContextRequestDto {
  @ValidateNested()
  @Type(() => StoreContextDto)
  context!: StoreContextDto
}
