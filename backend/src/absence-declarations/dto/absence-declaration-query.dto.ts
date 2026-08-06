import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

import { AbsenceDeclarationStatus } from '../absence-declaration.entity';

export class AbsenceDeclarationQueryDto {
  @IsOptional()
  @IsEnum(AbsenceDeclarationStatus)
  status?: AbsenceDeclarationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
