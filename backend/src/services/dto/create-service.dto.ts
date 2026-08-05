import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import {
  ServiceType,
  ValidationMode,
} from '../service.entity';

export class CreateServiceDto {
  @IsString()
  @Length(2, 150)
  name!: string;

  @IsEnum(ServiceType)
  serviceType!: ServiceType;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  externalCompanyName?: string;

  @IsOptional()
  @IsEnum(ValidationMode)
  validationMode?: ValidationMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  takeoverDelayDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minimumPresence?: number;

  @IsOptional()
  @IsBoolean()
  hasMinimumPresenceRule?: boolean;
}
