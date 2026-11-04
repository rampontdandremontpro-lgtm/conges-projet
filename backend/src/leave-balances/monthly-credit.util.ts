/**
 * JUR-025 / JUR-037 — classification juridique des absences et calcul du
 * crédit mensuel de congés payés. Composant PUR (aucune écriture).
 *
 * Sources :
 *  - L3141-3 : 2,5 jours ouvrables/mois de travail effectif.
 *  - L3141-5 (mod. loi 2024-364, en vigueur 24/04/2024) : AT/MP assimilé sans
 *    limite d'un an ; maternité/paternité/adoption et événements assimilés.
 *  - L3141-5-1 : maladie non professionnelle → 2 jours ouvrables/mois,
 *    plafond 24 jours ouvrables.
 *  - Syntec 5.5 : arrêt maladie/accident assimilé au travail effectif lorsqu'il
 *    donne lieu à maintien de salaire conventionnel (régime plus favorable).
 *
 * Règle de sécurité : une absence NON_CLASSIFIE n'ouvre PAS automatiquement les
 * mêmes droits qu'une présence effective. Elle réduit prudemment la base de
 * travail et déclenche une décision RH explicite (signalée par l'appelant).
 */
import { LeaveTypeAbsenceKind } from '../leave-types/leave-type.entity';

export type AbsenceJuridicalNature =
  | 'ASSIMILATED'
  | 'ILLNESS'
  | 'NON_ASSIMILATED'
  | 'UNCLASSIFIED';

const ASSIMILATED_KINDS: ReadonlySet<LeaveTypeAbsenceKind> = new Set([
  LeaveTypeAbsenceKind.AT_MP,
  LeaveTypeAbsenceKind.MARIAGE_PACS,
  LeaveTypeAbsenceKind.MARIAGE_ENFANT,
  LeaveTypeAbsenceKind.PATERNITE_ACCUEIL,
  LeaveTypeAbsenceKind.NAISSANCE,
  LeaveTypeAbsenceKind.ADOPTION,
  LeaveTypeAbsenceKind.DECES,
  LeaveTypeAbsenceKind.DECES_ENFANT,
  LeaveTypeAbsenceKind.DEUIL_ENFANT,
  LeaveTypeAbsenceKind.ANNONCE_HANDICAP_ENFANT,
]);

const NON_ASSIMILATED_KINDS: ReadonlySet<LeaveTypeAbsenceKind> = new Set([
  LeaveTypeAbsenceKind.ENFANT_MALADE,
  LeaveTypeAbsenceKind.NON_MEDICAL,
]);

export function classifyAbsenceKind(
  kind: LeaveTypeAbsenceKind,
): AbsenceJuridicalNature {
  if (kind === LeaveTypeAbsenceKind.ARRET_MALADIE) {
    return 'ILLNESS';
  }
  if (ASSIMILATED_KINDS.has(kind)) {
    return 'ASSIMILATED';
  }
  if (NON_ASSIMILATED_KINDS.has(kind)) {
    return 'NON_ASSIMILATED';
  }
  return 'UNCLASSIFIED';
}

export interface AbsenceBreakdown {
  /** Jours de maladie non professionnelle SANS maintien de salaire (2 j/mois). */
  illnessDays: number;
  /** Jours de maladie non professionnelle COUVERTS par une décision de maintien
   *  (assimilés au travail effectif, 2,5 j/mois). */
  maintainedIllnessDays: number;
  /** Jours de maladie dont le maintien ne repose QUE sur une décision
   *  LEGACY_PENDING (validité indéterminée) : NON assimilés au calcul courant
   *  (2 j/mois), mais protégés de tout retrait injustifié s'ils avaient déjà
   *  été crédités avant la structuration. */
  legacyMaintainedIllnessDays: number;
  /** Jours AT/MP (assimilés, comptés comme travail effectif). */
  atMpDays: number;
  /** Jours assimilés (AT/MP + événements + maladie avec maintien). */
  assimilatedDays: number;
  /** Jours non assimilés (enfant malade, non médical…). */
  nonAssimilatedDays: number;
  /** Jours non classifiés → décision RH requise (jamais réduits définitivement). */
  unclassifiedDays: number;
  /** Jours couverts par plusieurs absences de natures CONTRADICTOIRES → anomalie RH. */
  conflictDays: number;
  /** Jours contradictoires BRUTS (avant application d'une décision RH de
   *  classification retenue) : servent à savoir si la cause existe encore. */
  rawConflictDays: number;
  /** Jours contradictoires bruts PAR conflit (clé = identifiants triés des
   *  déclarations chevauchantes). Permet de scoper une décision RH. */
  conflictDaysByKey: Record<string, number>;
  /** Jours historiques (avant 24/04/2024) maladie/AT-MP à vérifier par la RH. */
  historicalPendingDays: number;
}

export interface MonthCreditInput {
  daysPresent: number;
  daysInMonth: number;
  daysPerEmployee: number;
  illnessMonthlyRate: number;
  /** Maladie SANS maintien (2 j/mois). */
  illnessDays: number;
  nonAssimilatedDays: number;
  unclassifiedDays: number;
}

export interface MonthCreditResult {
  /**
   * Composantes NON arrondies (précision interne) : elles ne doivent jamais
   * être additionnées après un arrondi individuel. Le total est arrondi une
   * seule fois (totalCredit).
   */
  workedCredit: number;
  illnessCredit: number;
  workedDays: number;
  illnessDays: number;
  /** Total arrondi une seule fois (pas d'arrondi intermédiaire par nature). */
  totalCredit: number;
}

/**
 * Arrondi de stockage : une seule opération d'arrondi sur le TOTAL, afin de ne
 * pas cumuler d'arrondis mensuels successifs (pas de perte de droit par
 * double arrondi worked/illness).
 */
export function roundCredit(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeMonthCredit(
  input: MonthCreditInput,
): MonthCreditResult {
  const daysInMonth = input.daysInMonth;
  const illnessDays = Math.min(Math.max(0, input.illnessDays), daysInMonth);
  const nonAssimilatedDays = Math.min(
    Math.max(0, input.nonAssimilatedDays),
    daysInMonth,
  );
  const unclassifiedDays = Math.min(
    Math.max(0, input.unclassifiedDays),
    daysInMonth,
  );

  // Base de travail effectif : présence calendaire − absences non assimilées −
  // absences non classifiées (exclues de l'automatique, décision RH requise) −
  // maladie non professionnelle SANS maintien. La maladie AVEC maintien reste
  // dans la base (assimilée) : elle n'est donc pas soustraite ici.
  const workedDays = Math.max(
    0,
    input.daysPresent - nonAssimilatedDays - unclassifiedDays - illnessDays,
  );

  const workedCredit = (input.daysPerEmployee * workedDays) / daysInMonth;
  const illnessCredit = (input.illnessMonthlyRate * illnessDays) / daysInMonth;

  const total = workedCredit + illnessCredit;

  return {
    // Précision interne conservée : arrondi uniquement sur le total.
    workedCredit,
    illnessCredit,
    workedDays,
    illnessDays,
    totalCredit: roundCredit(total),
  };
}
