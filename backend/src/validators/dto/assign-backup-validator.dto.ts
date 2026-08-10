import { IsInt, Min } from 'class-validator';

export class AssignBackupValidatorDto {
  @IsInt()
  @Min(1)
  validatorId!: number;
}
