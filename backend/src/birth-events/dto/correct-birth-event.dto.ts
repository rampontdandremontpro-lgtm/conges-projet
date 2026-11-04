import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CorrectBirthEventDto {
  @IsOptional()
  @IsDateString()
  dateNaissance?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nbEnfants?: number;

  @IsString()
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @MaxLength(500)
  source!: string;
}
