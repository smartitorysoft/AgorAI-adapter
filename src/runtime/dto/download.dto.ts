import { Type } from 'class-transformer'
import { IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator'

import { ContextRequestDto } from './store-context.dto'

const MAX_KEY = 64
const MAX_PROJECT_KEY = 128

export class DownloadTargetDto {
  /**
   * `require_tld: false` because a deployment reached at `http://platform:8080`
   * on a private network is a normal deployment, not a malformed URL — the
   * same reason the platform's own adapter URL check allows one.
   */
  @IsUrl({ require_tld: false })
  platformUrl!: string

  @IsString()
  @MaxLength(MAX_PROJECT_KEY)
  projectKey!: string
}

export class DownloadDto extends ContextRequestDto {
  @IsString()
  @MaxLength(MAX_KEY)
  key!: string

  @ValidateNested()
  @Type(() => DownloadTargetDto)
  target!: DownloadTargetDto
}
