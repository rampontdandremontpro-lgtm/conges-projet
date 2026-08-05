import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RefuseLeaveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsBoolean()
  emergencyTakeover?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  takeoverReason?: string;
}
