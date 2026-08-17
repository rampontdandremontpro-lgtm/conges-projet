import { Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
  NotEquals,
} from 'class-validator';

export class CorrectLeaveBalanceDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0, {
    message: 'La correction ne peut pas être égale à zéro.',
  })
  @Min(-99999.99)
  @Max(99999.99)
  days!: number;

  @IsString()
  @Length(3, 1000)
  reason!: string;
}
