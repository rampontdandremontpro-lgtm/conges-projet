import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum ExportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
}

export class ExportQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).toLowerCase())
  @IsEnum(ExportFormat)
  format: ExportFormat = ExportFormat.CSV;
}
