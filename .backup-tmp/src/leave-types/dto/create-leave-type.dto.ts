import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { LeaveTypeCategory } from '../leave-type.entity';

export class CreateLeaveTypeDto {
  @IsString()
  @Length(2, 160)
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
}
