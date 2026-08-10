import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DayPeriod } from '../../leave-requests/leave-request.entity';

export class CreateAbsenceDeclarationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  employeeId?: number;

  @IsInt()
  @Min(1)
  leaveTypeId!: number;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(744)
  durationHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
