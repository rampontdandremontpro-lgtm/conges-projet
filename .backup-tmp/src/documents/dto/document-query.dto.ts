import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

import { DocumentStatus } from '../document.entity';

export class DocumentQueryDto {
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaveRequestId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  absenceDeclarationId?: number;
}
