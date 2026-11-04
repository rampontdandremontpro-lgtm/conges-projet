import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

import { DayPeriod } from '../../../leave-requests/leave-request.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-\d{4}$/;

/**
 * Prévisualisation (lecture seule) : dates fournies explicitement.
 * Les jours non décomptés/fériés sont déterminés CÔTÉ SERVEUR (jamais via API).
 */
export class PreviewCarryoverAllocationDto {
  @Matches(DATE)
  startDate!: string;

  @Matches(DATE)
  endDate!: string;

  @IsEnum(DayPeriod)
  startPeriod!: DayPeriod;

  @IsEnum(DayPeriod)
  endPeriod!: DayPeriod;
}

/**
 * Consommation / réservation : le service recharge la demande enregistrée et
 * ne fait confiance qu'à elle (salarié, dates, périodes, type, statut).
 */
export class ConsumeCarryoverAllocationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @Matches(PERIOD)
  referencePeriod!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class ReserveCarryoverAllocationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @Matches(PERIOD)
  referencePeriod!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class ReleaseCarryoverAllocationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class RestoreCarryoverAllocationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class FinalizeCarryoverAllocationDto {
  @IsInt()
  @Min(1)
  leaveRequestId!: number;

  @IsIn(['VALIDATE', 'REFUSE'])
  decision!: 'VALIDATE' | 'REFUSE';

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
