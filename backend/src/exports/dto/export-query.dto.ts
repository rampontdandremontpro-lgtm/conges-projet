import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId?: number;

  @IsOptional()
  @IsIn(['EXTERNE'])
  serviceScope?: 'EXTERNE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;


  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaveTypeId?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{4}$/)
  referencePeriod?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).toLowerCase())
  @IsEnum(ExportFormat)
  format: ExportFormat = ExportFormat.CSV;
}
