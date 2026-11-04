import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Confirmation RH d'une preuve de réception et (pour ARRET_LONG) des
 * conditions L3141-19-2. Action explicite, exigée pour rendre une échéance
 * OPPOSABLE. Sans `proofId`, aucune confirmation n'est possible.
 */
export class ConfirmCarryoverLotDto {
  @IsInt()
  @Min(1)
  proofId!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  acquiredDuringL3141_5_5or7?: boolean;

  @IsOptional()
  @IsBoolean()
  suspensionAtLeastOneYearAtPeriodEnd?: boolean;
}
