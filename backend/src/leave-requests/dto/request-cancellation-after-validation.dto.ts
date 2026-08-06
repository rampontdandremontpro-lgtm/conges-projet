import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RequestCancellationAfterValidationDto {
  @IsString()
  @MinLength(3, {
    message: 'Le motif doit contenir au moins 3 caractères.',
  })
  @MaxLength(2000, {
    message: 'Le motif ne doit pas dépasser 2 000 caractères.',
  })
  reason!: string;
}
