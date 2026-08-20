import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ValidatePasswordTokenDto {
  @IsString()
  @MinLength(20, {
    message: 'Le jeton de réinitialisation du mot de passe n’est pas valide.',
  })
  @MaxLength(2048)
  token!: string;
}
