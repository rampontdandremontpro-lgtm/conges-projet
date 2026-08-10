import type { SubmissionRules } from '../settings/settings.service';

export interface SubmissionNoticeInfo {
  daysBeforeStart: number;
  requiredNoticeDays: number;
  isLongLeave: boolean;
  overlapsSummerPeriod: boolean;
  isNoticeCompliant: boolean;
  isDerogationWindow: boolean;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_RULES: SubmissionRules = {
  normalDeadlineDays: 30,
  specialDeadlineDays: 60,
  specialDurationThresholdDays: 21,
  derogationLastAllowedDay: 3,
  summerPeriodStart: '05-01',
  summerPeriodEnd: '10-31',
};

export function evaluateSubmissionNotice(
  startDateValue: string,
  endDateValue: string,
  calendarDuration: number,
  now: Date = new Date(),
  rules: SubmissionRules = DEFAULT_RULES,
): SubmissionNoticeInfo {
  const startDate = parseDate(startDateValue);
  const endDate = parseDate(endDateValue);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const daysBeforeStart = Math.floor(
    (startDate.getTime() - today.getTime()) /
      MILLISECONDS_PER_DAY,
  );

  const isLongLeave =
    calendarDuration >= rules.specialDurationThresholdDays;
  const overlapsSummerPeriod = overlapsConfiguredPeriod(
    startDate,
    endDate,
    rules.summerPeriodStart,
    rules.summerPeriodEnd,
  );
  const requiredNoticeDays =
    isLongLeave || overlapsSummerPeriod
      ? rules.specialDeadlineDays
      : rules.normalDeadlineDays;

  return {
    daysBeforeStart,
    requiredNoticeDays,
    isLongLeave,
    overlapsSummerPeriod,
    isNoticeCompliant: daysBeforeStart >= requiredNoticeDays,
    isDerogationWindow:
      daysBeforeStart >= rules.derogationLastAllowedDay &&
      daysBeforeStart < rules.normalDeadlineDays,
  };
}

export function calculateDerogationExpiry(
  startDateValue: string,
  derogationLastAllowedDay = 3,
): Date {
  const startDate = parseDate(startDateValue);
  startDate.setUTCDate(
    startDate.getUTCDate() - (derogationLastAllowedDay - 1),
  );
  return startDate;
}

function overlapsConfiguredPeriod(
  startDate: Date,
  endDate: Date,
  periodStart: string,
  periodEnd: string,
): boolean {
  const [startMonth, startDay] = periodStart.split('-').map(Number);
  const [endMonth, endDay] = periodEnd.split('-').map(Number);

  for (
    let year = startDate.getUTCFullYear() - 1;
    year <= endDate.getUTCFullYear() + 1;
    year += 1
  ) {
    const configuredStart = new Date(
      Date.UTC(year, startMonth - 1, startDay),
    );
    const endYear =
      endMonth < startMonth ||
      (endMonth === startMonth && endDay < startDay)
        ? year + 1
        : year;
    const configuredEnd = new Date(
      Date.UTC(endYear, endMonth - 1, endDay),
    );

    if (
      startDate.getTime() <= configuredEnd.getTime() &&
      endDate.getTime() >= configuredStart.getTime()
    ) {
      return true;
    }
  }

  return false;
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Date invalide : ${value}`);
  }

  return date;
}
