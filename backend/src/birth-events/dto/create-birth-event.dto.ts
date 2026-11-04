import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';

export class CreateBirthEventDto {
  @IsDateString()
  dateNaissance!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  nbEnfants!: number;
}
