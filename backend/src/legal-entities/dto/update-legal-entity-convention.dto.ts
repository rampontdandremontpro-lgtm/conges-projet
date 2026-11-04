import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  LegalEntityAccordType,
  LegalEntityConventionType,
} from '../legal-entity.entity';

/**
 * JUR-024 — convention de branche + accord d'entreprise (champs séparés).
 */
export class UpdateLegalEntityConventionDto {
  @IsEnum(LegalEntityConventionType, {
    message: 'conventionType doit être NON_RENSEIGNEE, LEGAL ou SYNTEC.',
  })
  conventionType!: LegalEntityConventionType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  idcc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  conventionName?: string;

  @IsOptional()
  @IsEnum(LegalEntityAccordType, {
    message: 'accordType doit être NONE ou ACCORD_ENTREPRISE.',
  })
  accordType?: LegalEntityAccordType;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  accordName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  accordIdcc?: string;

  @IsOptional()
  @IsISO8601()
  accordValidFrom?: string;

  @IsOptional()
  @IsISO8601()
  accordValidTo?: string;

  @IsOptional()
  @IsInt()
  accordDocumentId?: number;
}
