import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { LeaveBalanceCounterType } from '../leave-balance.entity';

export class InitializeLeaveBalanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId!: number;

  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message:
      'La période de référence doit respecter le format AAAA-AAAA.',
  })
  referencePeriod!: string;

  @IsEnum(LeaveBalanceCounterType)
  counterType!: LeaveBalanceCounterType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999.99)
  acquiredDays?: number;

  @IsOptional()
  @IsString()
  @Length(3, 1000)
  reason?: string;
}
