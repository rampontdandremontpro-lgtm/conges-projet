import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateValidatorReplacementDto {
  @IsInt()
  @Min(1)
  employeeId!: number;

  @IsInt()
  @Min(1)
  replacementValidatorId!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
