import { IsBoolean, IsDateString, IsEnum } from 'class-validator';

import { HolidayType } from '../holiday.entity';

export class UpdateHolidayWorkStatusDto {
  @IsDateString()
  date!: string;

  @IsEnum(HolidayType)
  holidayType!: HolidayType;

  @IsBoolean()
  isChomed!: boolean;
}
