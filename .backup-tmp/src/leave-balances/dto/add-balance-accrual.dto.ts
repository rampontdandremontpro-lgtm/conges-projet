import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class AddBalanceAccrualDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Le mois d’acquisition doit respecter le format AAAA-MM.',
  })
  accrualMonth!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999.99)
  days!: number;

  @IsOptional()
  @IsString()
  @Length(3, 1000)
  reason?: string;
}
