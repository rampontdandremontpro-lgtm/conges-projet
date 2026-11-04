/**
 * JUR-027 — Lot L2 : utilitaires de dates (module PUR, sans dépendance).
 *
 * Toutes les dates sont des chaînes ISO `YYYY-MM-DD` (ordre lexicographique =
 * ordre chronologique). Aucune date n'est « inventée » : une chaîne invalide
 * est signalée et jamais réinterprétée.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Valide une date ISO `YYYY-MM-DD` réelle (rejette 2024-02-30, etc.). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function parseDate(value: string): ParsedDate {
  if (!isValidDateString(value)) {
    throw new Error(`Date invalide ou absente : « ${String(value)} »`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Ajoute des mois à une date en plafonnant au dernier jour du mois cible
 * (ex. 31/01 + 1 mois = 28/02 ou 29/02 ; 31/01 + 15 mois = 30/04).
 */
export function addMonthsClamp(value: string, months: number): string {
  const { year, month, day } = parseDate(value);
  if (!Number.isInteger(months) || months < 0) {
    throw new Error(`Nombre de mois invalide : ${months}`);
  }
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  return formatDate(targetYear, targetMonth, Math.min(day, maxDay));
}

/** Ajoute un nombre de jours calendaires (peut être négatif). */
export function addDays(value: string, days: number): string {
  const { year, month, day } = parseDate(value);
  const utc = Date.UTC(year, month - 1, day) + days * 86_400_000;
  const d = new Date(utc);
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Nombre de jours calendaires entre deux dates : `to − from` (peut être négatif). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * Compare deux dates ISO : -1 si a < b, 0 si égales, 1 si a > b.
 * (L'ordre lexicographique est identique à l'ordre chronologique pour ISO.)
 */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
