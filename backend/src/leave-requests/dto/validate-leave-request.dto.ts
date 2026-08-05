import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SignatureType } from '../leave-request.entity';

export class ValidateLeaveRequestDto {
  @IsEnum(SignatureType)
  signatureType!: SignatureType;

  @IsString()
  @MinLength(2)
  @MaxLength(700000)
  signatureData!: string;

  @IsOptional()
  @IsBoolean()
  rhConfirmedDirectorAgreement?: boolean;

  @IsOptional()
  @IsBoolean()
  emergencyTakeover?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  takeoverReason?: string;
}
