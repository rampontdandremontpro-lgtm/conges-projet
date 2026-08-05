import {
  IsEmail,
  MaxLength,
} from 'class-validator';

export class RequestPasswordDto {
  @IsEmail({}, {
    message: 'L’adresse e-mail n’est pas valide.',
  })
  @MaxLength(180)
  email!: string;
}