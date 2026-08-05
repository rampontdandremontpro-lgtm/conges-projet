import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import {
  LeaveAccrualMode,
  LeaveTypeCategory,
} from '../leave-type.entity';

export class CreateLeaveTypeDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEnum(LeaveTypeCategory)
  category!: LeaveTypeCategory;

  @IsOptional()
  @IsBoolean()
  deductsPaidLeaveBalance?: boolean;

  @IsOptional()
  @IsBoolean()
  documentRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  documentCanBeAddedLater?: boolean;

  @IsOptional()
  @IsBoolean()
  employeeCanCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  rhOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsDays?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsHalfDays?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsHours?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresValidation?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresEmployeeSignature?: boolean;

  @IsOptional()
  @IsEnum(LeaveAccrualMode)
  accrualMode?: LeaveAccrualMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(2.5)
  monthlyAccrualDays?: number;
}
