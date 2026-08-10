import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateDerogationDto {
  @IsString()
  @MinLength(10, {
    message:
      'Le motif de la demande de dérogation doit contenir au moins 10 caractères.',
  })
  @MaxLength(2_000)
  reason!: string;
}
