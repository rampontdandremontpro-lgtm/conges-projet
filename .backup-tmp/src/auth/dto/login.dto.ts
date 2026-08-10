import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail({}, {
    message: 'L’adresse e-mail n’est pas valide.',
  })
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(1, {
    message: 'Le mot de passe est obligatoire.',
  })
  @MaxLength(64)
  password!: string;
}