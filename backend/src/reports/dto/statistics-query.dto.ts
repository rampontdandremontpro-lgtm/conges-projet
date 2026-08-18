import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { UserRole } from '../../users/user.entity';

export enum StatisticsDataType {
  ALL = 'ALL',
  LEAVE = 'LEAVE',
  ABSENCE = 'ABSENCE',
}

const STATISTICS_ROLES = [
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
] as const;

export class StatisticsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  serviceId?: number;

  @IsOptional()
  @IsIn(STATISTICS_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsIn(Object.values(StatisticsDataType))
  dataType?: StatisticsDataType;
}
