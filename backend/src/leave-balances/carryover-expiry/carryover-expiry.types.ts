/**
 * JUR-027 — Lot L2 : moteur de calcul des échéances légales des congés
 * reportés après maladie (module PUR, sans base de données ni service métier).
 *
 * Types et constantes partagés.
 *
 * Régimes couverts (Code du travail, mis à jour 24/04/2024) :
 *  - GENERAL   : L3141-19-1 — point de départ = date de réception des
 *                informations obligatoires (L3141-19-3) après la reprise.
 *  - ARRET_LONG: L3141-19-2 — congés acquis pendant une suspension d'au moins
 *                un an (L3141-5, 5° ou 7°) ; point de départ = fin de la
 *                période de référence d'acquisition ; suspension du reliquat
 *                en cas de reprise avant expiration.
 */

export type CarryoverRegime = 'GENERAL' | 'ARRET_LONG';

/** Situation d'absence explicite (jamais déduite d'une date manquante). */
export type AbsenceStatus = 'ABSENT' | 'REPRIS' | 'INCONNU';

/** État courant du délai de report. */
export enum CarryoverDelayStatus {
  /** Le délai n'a pas encore commencé. */
  EN_ATTENTE = 'EN_ATTENTE',
  /** Le délai est en cours de décompte. */
  EN_COURS = 'EN_COURS',
  /** Le délai est suspendu (reprise avant expiration, information non reçue). */
  SUSPENDU = 'SUSPENDU',
  /** Le délai est expiré. */
  EXPIRE = 'EXPIRE',
  /** Une information manque, est incohérente ou non confirmée : échéance non opposable. */
  A_VERIFIER = 'A_VERIFIER',
}

/** Entrée du calcul. Toutes les dates sont au format ISO `YYYY-MM-DD`. */
export interface CarryoverExpiryInput {
  /** Régime juridique : GENERAL (L3141-19-1) ou ARRET_LONG (L3141-19-2). */
  regime: CarryoverRegime;

  /** Fin de la période de référence d'acquisition (requis pour ARRET_LONG). */
  referencePeriodEnd?: string | null;

  /**
   * Situation d'absence explicite :
   *  - `ABSENT` : salarié toujours absent (confirmé) — aucune date de reprise attendue ;
   *  - `REPRIS` : salarié a repris — `repriseDate` doit être une date fiable ;
   *  - `INCONNU` (défaut) : situation inconnue — aucune échéance opposable.
   */
  absenceStatus?: AbsenceStatus | null;

  /** Date de reprise du travail (requise si `absenceStatus === 'REPRIS'`). */
  repriseDate?: string | null;

  /**
   * Date de réception des informations obligatoires (L3141-19-3).
   * Absente ou invalide → aucune échéance opposable.
   */
  informationDate?: string | null;

  /**
   * Confirmation de la réception à date certaine (L3141-19-3).
   * Une échéance n'est OPPOSABLE que si `=== true`.
   * `false` ou non renseigné → échéance indicative uniquement, statut A_VERIFIER.
   */
  informationDateCertain?: boolean | null;

  /**
   * Condition L3141-19-2 (1/2) : congés acquis pendant les périodes mentionnées
   * aux 5° ou 7° de l'article L3141-5. Requise (`true`) pour ARRET_LONG.
   */
  acquiredDuringL3141_5_5or7?: boolean | null;

  /**
   * Condition L3141-19-2 (2/2) : suspension du contrat d'au moins un an à la
   * fin de la période de référence. Requise (`true`) pour ARRET_LONG.
   */
  suspensionAtLeastOneYearAtPeriodEnd?: boolean | null;

  /**
   * Durée de report en mois (défaut 15, socle légal). Une valeur > 15
   * correspond à une disposition conventionnelle plus favorable (L3141-21-1).
   */
  carryoverMonths?: number | null;

  /**
   * Date de référence pour déterminer l'état courant du délai.
   * Défaut : date du jour. À injecter dans les tests pour la déterminisme.
   */
  today?: string | null;
}

/** Information de suspension du délai (régime ARRET_LONG). */
export interface CarryoverSuspensionInfo {
  /** Début de la suspension (date de reprise). */
  from: string;
  /** Fin de la suspension (date de réception de l'information) ou null si inconnue. */
  to: string | null;
  /** Nombre de jours calendaires suspendus (= information − reprise). */
  calendarDays: number | null;
  /** Reliquat du délai au moment de la reprise (= échéance de base − reprise). */
  remainingDaysAtReprise: number;
}

/** Événement justifiant le calcul (traçabilité). */
export interface CarryoverEvent {
  date: string | null;
  label: string;
}

/** Résultat du calcul. */
export interface CarryoverExpiryResult {
  regime: CarryoverRegime;
  status: CarryoverDelayStatus;
  /** Point de départ du délai (information_date ou fin de période de référence). */
  startDate: string | null;
  /** Échéance de base avant suspension (= point de départ + N mois). */
  deadline: string | null;
  /**
   * Échéance OPPOSABLE (peut fonder une expiration automatique).
   * Nulle si les informations/conditions ne sont pas validées.
   */
  effectiveExpiresAt: string | null;
  /**
   * Échéance INDICATIVE (non opposable) lorsque la réception à date certaine
   * n'est pas confirmée. Nulle lorsqu'une échéance opposable est calculée.
   */
  indicativeExpiresAt: string | null;
  suspension: CarryoverSuspensionInfo | null;
  /** Situation d'absence résolue (ABSENT/REPRIS/INCONNU) ou null si indéterminée. */
  absenceStatus: AbsenceStatus | null;
  /** Dates et événements justifiant le calcul. */
  events: CarryoverEvent[];
  /** Informations manquantes, invalides, incohérentes ou non confirmées. */
  missingInformation: string[];
  /** Points non bloquants à signaler. */
  warnings: string[];
  /** Fondement légal utilisé. */
  legalBasis: string;
  /** Durée de report réellement appliquée (>= 15). */
  monthsApplied: number;
}

/** Socle légal : 15 mois (L3141-19-1 et L3141-19-2). */
export const LEGAL_CARRYOVER_MONTHS = 15;
