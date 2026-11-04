import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  CarryoverLotAbsenceStatus,
  CarryoverLotOrigin,
  CarryoverLotRegime,
  CarryoverLotTargetCounter,
} from '../../carryover-lot.entity';

const PERIOD = /^\d{4}-\d{4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Correction RH d'un lot. Champs factuels uniquement ; la justification
 * (`reason`) est obligatoire. Les confirmations juridiques ne font PAS partie
 * de ce DTO (elles ne peuvent être modifiées que par l'action dédiée
 * `confirm`, qui exige une preuve et est journalisée).
 */
export class UpdateCarryoverLotDto {
  @IsOptional()
  @Matches(PERIOD)
  sourceReferencePeriod?: string;

  @IsOptional()
  @Matches(PERIOD)
  targetReferencePeriod?: string;

  @IsOptional()
  @IsEnum(CarryoverLotTargetCounter)
  targetCounterType?: CarryoverLotTargetCounter;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  remainingDays?: number | null;

  @IsOptional()
  @IsEnum(CarryoverLotOrigin)
  origin?: CarryoverLotOrigin;

  @IsOptional()
  @IsEnum(CarryoverLotRegime)
  regime?: CarryoverLotRegime;

  @IsOptional()
  @IsEnum(CarryoverLotAbsenceStatus)
  absenceStatus?: CarryoverLotAbsenceStatus;

  @IsOptional()
  @Matches(DATE)
  absenceStartDate?: string | null;

  @IsOptional()
  @Matches(DATE)
  absenceEndDate?: string | null;

  @IsOptional()
  @Matches(DATE)
  repriseDate?: string | null;

  @IsOptional()
  @Matches(DATE)
  informationDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  informationMode?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  proofId?: number | null;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
