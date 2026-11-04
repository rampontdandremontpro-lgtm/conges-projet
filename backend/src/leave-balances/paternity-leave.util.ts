/**
 * JUR-031 — congé de paternité et d'accueil de l'enfant (règles légales
 * certaines, Code du travail). Composant PUR (aucune écriture).
 *
 * Références : Code du travail (congé de paternité et d'accueil de l'enfant),
 * notamment la naissance simple (25 jours calendaires), les naissances
 * multiples (32 jours calendaires), la première période de 4 jours
 * calendaires consécutifs après le congé de naissance et la seconde période
 * de 21 ou 28 jours calendaires, fractionnable en deux périodes au maximum
 * d'au moins 5 jours chacune.
 *
 * Les jours de paternité sont des JOURS CALENDAIRES : samedis, dimanches et
 * jours fériés inclus (jamais de conversion en jours ouvrés/ouvrables).
 */
export type PaternityLeaveUnit = 'CALENDAIRES';

export type PaternityPeriodLabel = 'PREMIERE' | 'SECONDE';

export interface PaternityLeaveRule {
  totalDays: number;
  firstPeriodDays: number;
  secondPeriodDays: number;
  unit: PaternityLeaveUnit;
  fractionnement: string;
  reference: string;
  anomalies: string[];
}

export const PATERNITY_FIRST_PERIOD_DAYS = 4;
export const PATERNITY_SECOND_PERIOD_MIN_FRACTION_DAYS = 5;
export const PATERNITY_SECOND_PERIOD_MAX_FRACTIONS = 2;
export const PATERNITY_DEADLINE_MONTHS = 6;
/** Prévenance normale de l'employeur pour la seconde période (en jours). */
export const PATERNITY_NOTICE_DAYS = 30;

export function applicablePaternityLeaveRule(
  nbEnfants?: number,
): PaternityLeaveRule {
  const multiples = nbEnfants !== undefined && nbEnfants >= 2;
  const totalDays = multiples ? 32 : 25;
  const firstPeriodDays = PATERNITY_FIRST_PERIOD_DAYS;
  const secondPeriodDays = multiples ? 28 : 21;

  return {
    totalDays,
    firstPeriodDays,
    secondPeriodDays,
    unit: 'CALENDAIRES',
    fractionnement:
      'Première période de 4 jours calendaires consécutifs après le congé de naissance ; seconde période de 21 ou 28 jours calendaires, fractionnable en deux périodes au maximum d’au moins 5 jours chacune.',
    reference: 'Code du travail — congé de paternité et d’accueil de l’enfant',
    anomalies:
      nbEnfants === undefined
        ? ['Nombre d’enfants à naître manquant — 25 ou 32 jours à déterminer par la RH.']
        : [],
  };
}

/** Nombre de jours calendaires inclus entre deux dates (bornes comprises). */
export function paternityCalendarDays(
  startDate: string,
  endDate: string,
): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  if (end.getTime() < start.getTime()) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsIso(dateIso: string, months: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/**
 * Période de paternité valide (période simple) : la première période doit
 * comporter exactement 4 jours calendaires consécutifs ; chaque fraction de
 * la seconde période doit comporter au moins 5 jours calendaires.
 */
export function validatePaternityPeriodShape(input: {
  periode: PaternityPeriodLabel;
  startDate: string;
  endDate: string;
}): string[] {
  const errors: string[] = [];
  const days = paternityCalendarDays(input.startDate, input.endDate);

  if (input.periode === 'PREMIERE' && days !== PATERNITY_FIRST_PERIOD_DAYS) {
    errors.push(
      `La première période doit comporter exactement ${PATERNITY_FIRST_PERIOD_DAYS} jours calendaires consécutifs (${days} demandé(s)).`,
    );
  }

  if (
    input.periode === 'SECONDE' &&
    days < PATERNITY_SECOND_PERIOD_MIN_FRACTION_DAYS
  ) {
    errors.push(
      `Chaque fraction de la seconde période doit comporter au moins ${PATERNITY_SECOND_PERIOD_MIN_FRACTION_DAYS} jours calendaires (${days} demandé(s)).`,
    );
  }

  return errors;
}
