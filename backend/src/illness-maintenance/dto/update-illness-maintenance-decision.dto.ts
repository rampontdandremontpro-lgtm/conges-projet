import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { IllnessMaintenanceBasis } from '../illness-maintenance-decision.entity';

export class UpdateIllnessMaintenanceDecisionDto {
  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;

  @IsEnum(IllnessMaintenanceBasis)
  @IsOptional()
  basis?: IllnessMaintenanceBasis;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  @IsOptional()
  justification?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  basisReference?: string;

  @IsISO8601()
  @IsOptional()
  basisValidFrom?: string;

  @IsISO8601()
  @IsOptional()
  basisValidTo?: string;

  @IsInt()
  @IsOptional()
  basisDocumentId?: number;
}
