import { IsEnum, IsNotEmpty } from 'class-validator';

import { IllnessWageMaintenance } from '../legal-entity.entity';

/**
 * JUR-025/037 — décision RH explicite, contrôlée et historisée sur le régime
 * d'acquisition applicable aux arrêts maladie/accident non professionnels
 * (maintien de salaire conventionnel Syntec 5.5 ou socle légal L3141-5-1).
 */
export class UpdateLegalEntityIllnessRegimeDto {
  @IsEnum(IllnessWageMaintenance)
  @IsNotEmpty()
  illnessWageMaintenance!: IllnessWageMaintenance;
}
