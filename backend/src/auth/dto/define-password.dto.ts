import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DefinePasswordDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, {
    message:
      'Le jeton de définition du mot de passe n’est pas valide.',
  })
  token!: string;

  @IsString()
  @MinLength(12, {
    message:
      'Le mot de passe doit contenir au moins 12 caractères.',
  })
  @MaxLength(64, {
    message:
      'Le mot de passe ne doit pas dépasser 64 caractères.',
  })
  password!: string;
}