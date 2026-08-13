import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, {
    message: 'Le mot de passe actuel est obligatoire.',
  })
  @MaxLength(64)
  currentPassword!: string;

  @IsString()
  @MinLength(12, {
    message: 'Le nouveau mot de passe doit contenir au moins 12 caractères.',
  })
  @MaxLength(64, {
    message: 'Le nouveau mot de passe ne doit pas dépasser 64 caractères.',
  })
  newPassword!: string;
}
