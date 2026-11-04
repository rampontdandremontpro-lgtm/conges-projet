/**
 * JUR-021 / JUR-022 — Fractionnement des congés payés.
 *
 * Moteur PUR et partagé (aucune dépendance base/service/HTTP) :
 *  - construit la liste datée des jours décomptés selon l'unité du régime
 *    (OUVRABLE : du lundi au samedi ; OUVRE : du lundi au vendredi) en excluant
 *    les dimanches, les jours fériés/fermetures et en gérant les demi-journées ;
 *  - détermine les jours du congé principal pris HORS de la période légale
 *    (par défaut hors du 1er mai au 31 octobre) ;
 *  - exclut la cinquième semaine (jours au-delà du plafond du congé principal :
 *    24 jours ouvrables / 20 jours ouvrés) ;
 *  - applique les seuils du régime (Syntec jours ouvrés / légal supplétif jours
 *    ouvrables) sans cumuler les deux régimes.
 */
import { DayPeriod } from '../leave-requests/leave-request.entity';

export type FractionnementRegime = 'SYNTEC' | 'LEGAL';

export interface FractionnementThresholds {
  /** Nombre minimal de jours éligibles pour +1 jour (inclus). */
  oneDayMin: number;
  /** Nombre minimal de jours éligibles pour +2 jours (inclus). */
  twoDaysMin: number;
}

export const SYNTEC_FRACTIONNEMENT_THRESHOLDS: FractionnementThresholds = {
  oneDayMin: 3,
  twoDaysMin: 5,
};

export const LEGAL_FRACTIONNEMENT_THRESHOLDS: FractionnementThresholds = {
  oneDayMin: 3,
  twoDaysMin: 6,
};

export interface FractionnementDay {
  /** Date ISO YYYY-MM-DD. */
  date: string;
  /** Valeur décomptée : 1 (journée) ou 0.5 (demi-journée). */
  value: number;
}

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Somme des valeurs d'une liste de journées (arrondie à 2 décimales). */
export function sumFractionnementDays(
  days: readonly FractionnementDay[],
): number {
  return round2(days.reduce((total, day) => total + day.value, 0));
}

/**
 * Liste datée des jours décomptés pour le fractionnement.
 *
 * - `includeSaturdays = true`  → unité OUVRABLE (lundi → samedi) ;
 * - `includeSaturdays = false` → unité OUVRÉE (lundi → vendredi).
 *
 * Les dimanches sont toujours exclus, ainsi que les dates non déductibles
 * (jours fériés, fermetures). Les demi-journées sont reproduites (0.5).
 */
export function buildFractionnementDayList(
  startDate: string,
  endDate: string,
  startPeriod: DayPeriod,
  endPeriod: DayPeriod,
  nonDeductibleDates: ReadonlySet<string>,
  includeSaturdays: boolean,
): FractionnementDay[] {
  const days: FractionnementDay[] = [];
  const currentDate = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (currentDate.getTime() <= end.getTime()) {
    const dateValue = currentDate.toISOString().slice(0, 10);
    const weekday = currentDate.getUTCDay();
    const isSunday = weekday === 0;
    const isSaturday = weekday === 6;
    const isNonDeductible = nonDeductibleDates.has(dateValue);

    if (!isSunday && !isNonDeductible && !(isSaturday && !includeSaturdays)) {
      let value = 1;

      if (dateValue === startDate && startPeriod === DayPeriod.APRES_MIDI) {
        value -= 0.5;
      }
      if (dateValue === endDate && endPeriod === DayPeriod.MATIN) {
        value -= 0.5;
      }

      if (value > 0) {
        days.push({ date: dateValue, value: round2(value) });
      }
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return days;
}

function monthDayParts(monthDay: string): { month: number; day: number } {
  const match = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(monthDay);
  if (!match) {
    throw new Error(`Format MM-JJ invalide : ${monthDay}`);
  }
  return { month: Number(match[1]), day: Number(match[2]) };
}

/**
 * Vrai si la date est HORS de la période légale `[startMMDD, endMMDD]`
 * (comparaison sur le mois et le jour, indépendamment de l'année).
 */
export function isOutsideEligiblePeriod(
  date: string,
  startMonthDay: string,
  endMonthDay: string,
): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const start = monthDayParts(startMonthDay);
  const end = monthDayParts(endMonthDay);

  // Cas sans chevauchement d'année (ex. 05-01 → 10-31).
  if (
    start.month < end.month ||
    (start.month === end.month && start.day <= end.day)
  ) {
    const afterStart =
      month > start.month || (month === start.month && day >= start.day);
    const beforeEnd =
      month < end.month || (month === end.month && day <= end.day);
    return !(afterStart && beforeEnd);
  }

  // Fenêtre chevauchant le changement d'année (ex. 11-01 → 04-30).
  const beforeEnd =
    month < end.month || (month === end.month && day <= end.day);
  const afterStart =
    month > start.month || (month === start.month && day >= start.day);
  return !(beforeEnd || afterStart);
}

export interface FractionnementInput {
  regime: FractionnementRegime;
  /** Journées datées du congé principal, triées par date croissante. */
  days: readonly FractionnementDay[];
  eligiblePeriodStart: string;
  eligiblePeriodEnd: string;
  /** Plafond du congé principal (5e semaine exclue) : 24 ouvrables / 20 ouvrés. */
  mainLeaveCap: number;
  thresholds: FractionnementThresholds;
}

export interface FractionnementResult {
  /** Jours retenus dans le congé principal (jusqu'au plafond). */
  mainLeaveDays: FractionnementDay[];
  /** Jours au-delà du plafond (cinquième semaine, exclus du calcul). */
  fifthWeekDays: FractionnementDay[];
  /** Jours du congé principal pris hors période légale. */
  outsidePeriodDays: number;
  /** Jours de fractionnement attribués (0, 1 ou 2). */
  bonusDays: number;
}

/**
 * Calcule le bonus de fractionnement à partir des journées datées du congé
 * principal. La cinquième semaine (jours au-delà de `mainLeaveCap`) est exclue,
 * puis les seuils du régime sont appliqués aux jours hors période.
 */
export function computeFractionnement(
  input: FractionnementInput,
): FractionnementResult {
  const sorted = [...input.days].sort((a, b) => a.date.localeCompare(b.date));

  const mainLeaveDays: FractionnementDay[] = [];
  const fifthWeekDays: FractionnementDay[] = [];
  let remainingCap = round2(input.mainLeaveCap);

  for (const day of sorted) {
    if (remainingCap <= 0) {
      fifthWeekDays.push(day);
      continue;
    }
    const take = round2(Math.min(day.value, remainingCap));
    remainingCap = round2(remainingCap - take);
    mainLeaveDays.push({ date: day.date, value: take });
    if (day.value - take > 0.001) {
      fifthWeekDays.push({ date: day.date, value: round2(day.value - take) });
    }
  }

  const outsidePeriodDays = round2(
    mainLeaveDays
      .filter((day) =>
        isOutsideEligiblePeriod(
          day.date,
          input.eligiblePeriodStart,
          input.eligiblePeriodEnd,
        ),
      )
      .reduce((total, day) => total + day.value, 0),
  );

  const bonusDays = computeFractionnementBonus(
    input.regime,
    outsidePeriodDays,
    input.thresholds,
  );

  return {
    mainLeaveDays,
    fifthWeekDays,
    outsidePeriodDays,
    bonusDays,
  };
}

/** Seuils du régime appliqués aux jours éligibles hors période. */
export function computeFractionnementBonus(
  regime: FractionnementRegime,
  eligibleOutsideDays: number,
  thresholds: FractionnementThresholds,
): number {
  const normalized = round2(eligibleOutsideDays);
  if (normalized >= thresholds.twoDaysMin) return 2;
  if (normalized >= thresholds.oneDayMin) return 1;
  return 0;
}

/** Seuils par défaut d'un régime (jours ouvrés Syntec / ouvrables supplétif). */
export function defaultThresholdsForRegime(
  regime: FractionnementRegime,
): FractionnementThresholds {
  return regime === 'SYNTEC'
    ? SYNTEC_FRACTIONNEMENT_THRESHOLDS
    : LEGAL_FRACTIONNEMENT_THRESHOLDS;
}

/** Plafond du congé principal par défaut d'un régime. */
export function defaultMainLeaveCapForRegime(
  regime: FractionnementRegime,
): number {
  return regime === 'SYNTEC' ? 20 : 24;
}
