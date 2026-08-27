import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class LeaveBalanceProjectionQueryDto {
  @IsDateString()
  startDate!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  excludeRequestId?: number;
}
