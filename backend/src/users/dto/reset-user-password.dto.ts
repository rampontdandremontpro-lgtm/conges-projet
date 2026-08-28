import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetUserPasswordDto {
  @IsString()
  @MinLength(12, {
    message: 'Le mot de passe temporaire doit contenir au moins 12 caractères.',
  })
  @MaxLength(64, {
    message: 'Le mot de passe temporaire ne doit pas dépasser 64 caractères.',
  })
  temporaryPassword!: string;
}
