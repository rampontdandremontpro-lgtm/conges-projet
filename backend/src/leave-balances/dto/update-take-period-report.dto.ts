import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpdateTakePeriodReportDto {
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  justification?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  documentId?: number;

  @IsOptional()
  @IsDateString()
  newDeadline?: string;
}
