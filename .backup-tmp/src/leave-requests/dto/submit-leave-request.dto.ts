import {
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SignatureType } from '../leave-request.entity';

export class SubmitLeaveRequestDto {
  @IsEnum(SignatureType)
  signatureType!: SignatureType;

  @IsString()
  @MinLength(2)
  @MaxLength(1_000_000)
  signatureData!: string;
}
