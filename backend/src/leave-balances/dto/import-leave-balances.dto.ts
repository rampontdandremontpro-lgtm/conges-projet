import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, Matches, Min, ValidateNested } from 'class-validator';

export class ImportLeaveBalanceRowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  acquiredDays!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  takenDays!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  balanceDays!: number;
}

export class ImportLeaveBalancesDto {
  @Matches(/^\d{4}-\d{4}$/)
  referencePeriod!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportLeaveBalanceRowDto)
  rows!: ImportLeaveBalanceRowDto[];
}
