import {
  IsInt,
  IsNumber,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ExceptionalCarryoverDto {
  @IsInt()
  @Min(1)
  employeeId!: number;

  @Matches(/^\d{4}-\d{4}$/)
  closingReferencePeriod!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
