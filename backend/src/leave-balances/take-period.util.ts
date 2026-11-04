/**
 * JUR-023 — Période de prise des congés (13 mois).
 *
 * Moteur PUR : calcule la fenêtre de prise d'une période de référence à partir
 * d'une date de début configurable (1er mai par défaut) et d'une durée
 * configurable (13 mois par défaut).
 *
 * Pour une période « AAAA-(AAAA+1) » :
 *   début  = AAAA-05-01 (ouverture de la période de prise) ;
 *   fin    = début + 13 mois − 1 jour = (AAAA+1)-05-31.
 */
import {
  addDays,
  formatDateString,
  parseReferencePeriod,
} from './reference-period.util';

export interface TakePeriod {
  referencePeriod: string;
  start: string;
  end: string;
}

function addMonthsClamped(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const raw = month + months;
  const targetYear = year + Math.floor((raw - 1) / 12);
  const targetMonth = ((raw - 1) % 12 + 12) % 12 + 1;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth, 0),
  ).getUTCDate();
  return formatDateString(targetYear, targetMonth, Math.min(day, lastDay));
}

export function takePeriodFor(
  referencePeriod: string,
  startMonthDay = '05-01',
  durationMonths = 13,
): TakePeriod {
  // La période de prise démarre le 1er mai de l'ANNÉE DE FIN de la période de
  // référence (Syntec 5.3) : pour « AAAA-(AAAA+1) », début = (AAAA+1)-05-01,
  // fin = début + durée − 1 jour = (AAAA+2)-05-31.
  const { endYear } = parseReferencePeriod(referencePeriod);
  const [month, day] = startMonthDay.split('-').map(Number);
  const start = formatDateString(endYear, month, day);
  const end = addDays(addMonthsClamped(start, durationMonths), -1);
  return { referencePeriod, start, end };
}

export type TakePeriodStatus =
  | 'NOT_OPENED'
  | 'WITHIN_PERIOD'
  | 'DEADLINE_APPROACHING'
  | 'DEADLINE_EXCEEDED';

export interface TakePeriodStatusInfo {
  status: TakePeriodStatus;
  daysUntilEnd: number;
}

/**
 * Statut de la période de prise à une date donnée (ex. aujourd'hui).
 * `alertDays` : seuil sous lequel on considère l'échéance « proche ».
 */
export function takePeriodStatus(
  takePeriod: TakePeriod,
  today: string,
  alertDays: number,
): TakePeriodStatusInfo {
  if (today < takePeriod.start) {
    return {
      status: 'NOT_OPENED',
      daysUntilEnd: diffDays(takePeriod.end, today),
    };
  }

  const daysUntilEnd = diffDays(takePeriod.end, today);
  if (today > takePeriod.end) {
    return { status: 'DEADLINE_EXCEEDED', daysUntilEnd };
  }
  if (daysUntilEnd <= alertDays) {
    return { status: 'DEADLINE_APPROACHING', daysUntilEnd };
  }
  return { status: 'WITHIN_PERIOD', daysUntilEnd };
}

function diffDays(end: string, today: string): number {
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
  return Math.round((endMs - todayMs) / 86_400_000);
}
