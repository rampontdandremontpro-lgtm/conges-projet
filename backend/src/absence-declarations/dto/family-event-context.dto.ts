import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * JUR-029/030 — contexte d'un événement familial (date réelle, lien, âge,
 * personne à charge). La date de l'événement peut différer du début du congé.
 */
export class FamilyEventContextDto {
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @IsOptional()
  @IsString()
  lien?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  enfantAge?: number;

  @IsOptional()
  @IsBoolean()
  aCharge?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  nbEnfantsCharge?: number;

  @IsOptional()
  @IsBoolean()
  enfantEstParent?: boolean;

  @IsOptional()
  @IsBoolean()
  personneChargeMoins25?: boolean;

  @IsOptional()
  @IsIn(['HANDICAP', 'PATHOLOGIE_CHRONIQUE', 'CANCER'], {
    message: 'natureAnnonce doit être HANDICAP, PATHOLOGIE_CHRONIQUE ou CANCER.',
  })
  natureAnnonce?: string;

  // ── JUR-031 — congé de paternité et d'accueil de l'enfant ────────────────
  @IsOptional()
  @IsDateString()
  dateNaissance?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nbEnfants?: number;

  /** Identifiant stable de l'événement de naissance (rattache les périodes). */
  @IsOptional()
  @IsString()
  naissanceId?: string;

  @IsOptional()
  @IsIn(['PREMIERE', 'SECONDE'])
  periode?: string;

  @IsOptional()
  @IsDateString()
  prevenanceDate?: string;

  @IsOptional()
  @IsBoolean()
  hospitalisationEnfant?: boolean;

  @IsOptional()
  @IsBoolean()
  decesMere?: boolean;

  @IsOptional()
  @IsBoolean()
  naissancePrematuree?: boolean;
}
