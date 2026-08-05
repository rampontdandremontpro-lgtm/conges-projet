import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { DayPeriod } from '../leave-request.entity';

export class CreateLeaveRequestDto {
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
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
