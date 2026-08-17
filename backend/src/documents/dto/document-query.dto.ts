import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

import { DocumentStatus } from '../document.entity';

export const DOCUMENT_LIBRARY_CATEGORIES = [
  'JUSTIFICATIFS',
  'CONGES',
  'ANNULATIONS',
] as const;

export type DocumentLibraryCategory =
  (typeof DOCUMENT_LIBRARY_CATEGORIES)[number];

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

  @IsOptional()
  @IsIn(DOCUMENT_LIBRARY_CATEGORIES)
  category?: DocumentLibraryCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
