import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class PrepareNotificationDto {
  @IsInt()
  employeeId!: number;
}

export class TransmitNotificationDto {
  @IsString()
  mode!: string;
}

export class AttachProofDto {
  @IsString()
  mode!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/)
  receivedAt!: string;

  @IsOptional()
  @IsString()
  proofReference?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  contentBase64?: string;
}

export class ReasonDto {
  @IsString()
  reason!: string;
}

export class VerifyProofDto {
  @IsIn(['CONFORME', 'NON_CONFORME'])
  result!: 'CONFORME' | 'NON_CONFORME';

  @IsString()
  note!: string;

  @IsBoolean()
  recipientIdentityConfirmed!: boolean;

  @IsBoolean()
  requiredInfoPresent!: boolean;
}
