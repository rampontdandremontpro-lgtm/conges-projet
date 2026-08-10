import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CancelLeaveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
