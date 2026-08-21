import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateDerogationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}
