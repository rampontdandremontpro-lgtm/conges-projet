import { IsEnum } from 'class-validator';

import { LeaveTypeAbsenceKind } from '../leave-type.entity';

/**
 * JUR-028 — classification métier explicite d'un type d'absence par la RH.
 */
export class UpdateLeaveTypeAbsenceKindDto {
  @IsEnum(LeaveTypeAbsenceKind, {
    message:
      'absenceKind invalide. Valeurs admises : NON_CLASSIFIE, NON_MEDICAL, ARRET_MALADIE, ENFANT_MALADE, AT_MP, MARIAGE_PACS, MARIAGE_ENFANT, PATERNITE_ACCUEIL, NAISSANCE, ADOPTION, DECES, DECES_ENFANT, DEUIL_ENFANT, ANNONCE_HANDICAP_ENFANT.',
  })
  absenceKind!: LeaveTypeAbsenceKind;
}
