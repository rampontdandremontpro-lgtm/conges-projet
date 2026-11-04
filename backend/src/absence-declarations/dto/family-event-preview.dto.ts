import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

import { DayPeriod } from '../../leave-requests/leave-request.entity';
import { FamilyEventContextDto } from './family-event-context.dto';

/**
 * JUR-029/030 — aperçu du droit d'événement familial (règle, jours demandés,
 * anomalies, quota) avant création/modification d'une déclaration.
 */
export class FamilyEventPreviewDto {
  @IsInt()
  @Min(1)
  leaveTypeId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  employeeId?: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsEnum(DayPeriod)
  startPeriod?: DayPeriod;

  @IsOptional()
  @IsEnum(DayPeriod)
  endPeriod?: DayPeriod;

  @IsOptional()
  @ValidateNested()
  @Type(() => FamilyEventContextDto)
  familyEventContext?: FamilyEventContextDto;
}
