
export interface ReminderDeadline {
  key: '3M' | '2M' | '1M' | '15D' | '7D';
  date: string;
}

export const REMINDER_DEADLINE_DEFINITIONS: ReadonlyArray<{
  key: ReminderDeadline['key'];
  label: string;
  months: number;
  days: number;
}> = [
  { key: '3M', label: '3 mois', months: 3, days: 0 },
  { key: '2M', label: '2 mois', months: 2, days: 0 },
  { key: '1M', label: '1 mois', months: 1, days: 0 },
  { key: '15D', label: '15 jours', months: 0, days: 15 },
  { key: '7D', label: '7 jours', months: 0, days: 7 },
];

const PERIOD_PATTERN = /^(\d{4})-(\d{4})$/;

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export interface ParsedReferencePeriod {
  startYear: number;
  endYear: number;
}

export function parseReferencePeriod(
  referencePeriod: string,
): ParsedReferencePeriod {
  const match = PERIOD_PATTERN.exec(referencePeriod);
  if (!match) {
    throw new Error(
      `La période de référence « ${referencePeriod} » doit respecter le format AAAA-AAAA.`,
    );
  }
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) {
    throw new Error(
      'Les deux années de la période de référence doivent être consécutives.',
    );
  }
  return { startYear, endYear };
}

function parseMonthDay(startMonthDay: string): { month: number; day: number } {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(startMonthDay)) {
    throw new Error(
      `REFERENCE_PERIOD_START doit respecter le format MM-JJ (reçu : « ${startMonthDay} »).`,
    );
  }
  const [month, day] = startMonthDay.split('-').map(Number);
  const probe = new Date(Date.UTC(2024, month - 1, day));
  if (
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(
      `REFERENCE_PERIOD_START contient une date invalide (${startMonthDay}).`,
    );
  }
  return { month, day };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateString(
  year: number,
  month: number,
  day: number,
): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function subtractMonthsClamped(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const raw = month - months;
  const targetYear = year + Math.floor((raw - 1) / 12);
  const normalizedMonth = (((raw - 1) % 12) + 12) % 12 + 1;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth, 0),
  ).getUTCDate();
  return formatDateString(targetYear, normalizedMonth, Math.min(day, lastDay));
}

export function currentReferencePeriod(
  date: string,
  startMonthDay: string,
): string {
  const [year] = date.split('-').map(Number);
  const { month, day } = parseMonthDay(startMonthDay);
  const startOfYear = formatDateString(year, month, day);
  if (date >= startOfYear) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

export function referencePeriodStartDate(
  referencePeriod: string,
  startMonthDay: string,
): string {
  const { startYear } = parseReferencePeriod(referencePeriod);
  const { month, day } = parseMonthDay(startMonthDay);
  return formatDateString(startYear, month, day);
}

export function referencePeriodEndDate(
  referencePeriod: string,
  startMonthDay: string,
): string {
  const { endYear } = parseReferencePeriod(referencePeriod);
  const { month, day } = parseMonthDay(startMonthDay);
  const nextStart = formatDateString(endYear, month, day);
  return addDays(nextStart, -1);
}

export function nextReferencePeriod(referencePeriod: string): string {
  const { endYear } = parseReferencePeriod(referencePeriod);
  return `${endYear}-${endYear + 1}`;
}

export function counterReferencePeriod(
  referencePeriod: string,
  counterType: 'N-1' | 'N' | 'N+1',
): string {
  const { startYear, endYear } = parseReferencePeriod(referencePeriod);
  const offset = counterType === 'N-1' ? -1 : counterType === 'N+1' ? 1 : 0;
  return `${startYear + offset}-${endYear + offset}`;
}

export function reminderDeadlines(
  referencePeriod: string,
  startMonthDay: string,
): ReminderDeadline[] {
  const endDate = referencePeriodEndDate(referencePeriod, startMonthDay);
  return REMINDER_DEADLINE_DEFINITIONS.map((definition) => {
    const date =
      definition.months > 0
        ? subtractMonthsClamped(endDate, definition.months)
        : addDays(endDate, -definition.days);
    return { key: definition.key, date };
  });
}

export function balanceReminderType(
  deadlineKey: ReminderDeadline['key'],
  referencePeriod: string,
): string {
  return `BALANCE_REMINDER_${deadlineKey}_${referencePeriod}`;
}

export function balanceRecapType(
  deadlineKey: ReminderDeadline['key'],
  referencePeriod: string,
): string {
  return `BALANCE_RECAP_${deadlineKey}_${referencePeriod}`;
}

export function reminderDeadlineLabel(
  deadlineKey: ReminderDeadline['key'],
): string {
  return (
    REMINDER_DEADLINE_DEFINITIONS.find((item) => item.key === deadlineKey)
      ?.label ?? deadlineKey
  );
}

export function formatFrenchDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${FRENCH_MONTHS[month - 1]} ${year}`;
}
