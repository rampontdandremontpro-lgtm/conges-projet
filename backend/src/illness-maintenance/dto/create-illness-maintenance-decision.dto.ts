import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { IllnessMaintenanceBasis } from '../illness-maintenance-decision.entity';

/**
 * JUR-025/037 — création d'une décision RH de maintien de salaire pour un
 * arrêt maladie/accident non professionnel. La justification et le fondement
 * sont obligatoires (aucun maintien fictif).
 */
export class CreateIllnessMaintenanceDecisionDto {
  @IsInt()
  @IsNotEmpty()
  employeeId!: number;

  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;

  @IsEnum(IllnessMaintenanceBasis)
  @IsOptional()
  basis?: IllnessMaintenanceBasis;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  justification!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  basisReference?: string;

  @IsISO8601()
  @IsOptional()
  basisValidFrom?: string;

  @IsISO8601()
  @IsOptional()
  basisValidTo?: string;

  @IsInt()
  @IsOptional()
  basisDocumentId?: number;
}
