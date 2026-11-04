import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTakePeriodReportDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId!: number;

  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'referencePeriod doit respecter le format AAAA-AAAA.',
  })
  referencePeriod!: string;

  @IsString()
  @Length(3, 1000)
  justification!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  documentId?: number;

  @IsDateString()
  newDeadline!: string;
}
