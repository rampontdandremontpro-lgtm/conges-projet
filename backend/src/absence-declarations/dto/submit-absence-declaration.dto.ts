import { IsBoolean, IsOptional } from 'class-validator';

export class SubmitAbsenceDeclarationDto {
  @IsOptional()
  @IsBoolean()
  certifiedAccurate?: boolean;
}
