import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { HolidayType } from '../holiday.entity';

export class CreateHolidayDto {
  @IsDateString()
  date!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @IsEnum(HolidayType)
  holidayType!: HolidayType;

  @IsOptional()
  @IsBoolean()
  deductible?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;
}
