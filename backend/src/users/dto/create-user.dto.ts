import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

import {
  EmploymentType,
  UserRole,
} from '../user.entity';

export class CreateUserDto {
  @IsString()
  @Length(2, 100)
  nom!: string;

  @IsString()
  @Length(2, 100)
  prenom!: string;

  @IsEmail()
  @Length(5, 190)
  email!: string;

  @IsOptional()
  @IsString()
  @Length(12, 64)
  password?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  serviceId?: number;

  @IsOptional()
  @IsString()
  @Length(2, 255)
  microsoftId?: string;
}