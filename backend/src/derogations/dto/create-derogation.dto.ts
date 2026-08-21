import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDerogationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}
