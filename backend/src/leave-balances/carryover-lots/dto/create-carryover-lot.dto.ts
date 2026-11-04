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
 * Création d'un lot de congés reportés pour maladie.
 *
 * IMPORTANT : les confirmations juridiques (`informationDateCertain`,
 * `acquiredDuringL3141_5_5or7`, `suspensionAtLeastOneYearAtPeriodEnd`) ne font
 * PAS partie de ce DTO. Le `ValidationPipe` global (`forbidNonWhitelisted`)
 * rejette tout champ supplémentaire : une simple donnée du frontend ne peut
 * jamais confirmer une preuve de réception ou une condition légale.
 */
export class CreateCarryoverLotDto {
  @IsInt()
  @Min(1)
  employeeId!: number;

  @Matches(PERIOD)
  sourceReferencePeriod!: string;

  @Matches(PERIOD)
  targetReferencePeriod!: string;

  @IsOptional()
  @IsEnum(CarryoverLotTargetCounter)
  targetCounterType?: CarryoverLotTargetCounter;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days!: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;

  /** Clé d'idempotence OBLIGATOIRE : empêche la création de doublons. */
  @IsString()
  @MinLength(1)
  @MaxLength(190)
  idempotencyKey!: string;
}
