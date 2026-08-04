import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

import { ServiceType } from '../service.entity';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  externalCompanyName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minimumPresence?: number;

  @IsOptional()
  @IsBoolean()
  hasMinimumPresenceRule?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}