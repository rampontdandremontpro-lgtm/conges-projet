import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * JUR-029/030 — enregistrement RH d'une déclaration. Pour un cas incertain
 * (droits non vérifiables automatiquement), une justification explicite est
 * requise afin que la décision RH soit tracée et motivée.
 */
export class RegisterAbsenceDeclarationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  decisionReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  decisionSource?: string;
}
