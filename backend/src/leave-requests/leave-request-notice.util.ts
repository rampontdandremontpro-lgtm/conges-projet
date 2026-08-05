export interface SubmissionNoticeInfo {
  daysBeforeStart: number;
  requiredNoticeDays: 30 | 60;
  isLongLeave: boolean;
  overlapsSummerPeriod: boolean;
  isNoticeCompliant: boolean;
  isDerogationWindow: boolean;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function evaluateSubmissionNotice(
  startDateValue: string,
  endDateValue: string,
  calendarDuration: number,
  now: Date = new Date(),
): SubmissionNoticeInfo {
  const startDate = parseDate(startDateValue);
  const endDate = parseDate(endDateValue);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const daysBeforeStart = Math.floor(
    (startDate.getTime() - today.getTime()) /
      MILLISECONDS_PER_DAY,
  );

  const isLongLeave = calendarDuration >= 21;
  const overlapsSummerPeriod = overlapsSummer(
    startDate,
    endDate,
  );
  const requiredNoticeDays: 30 | 60 =
    isLongLeave || overlapsSummerPeriod ? 60 : 30;

  return {
    daysBeforeStart,
    requiredNoticeDays,
    isLongLeave,
    overlapsSummerPeriod,
    isNoticeCompliant:
      daysBeforeStart >= requiredNoticeDays,
    isDerogationWindow:
      daysBeforeStart >= 3 && daysBeforeStart <= 29,
  };
}

export function calculateDerogationExpiry(
  startDateValue: string,
): Date {
  const startDate = parseDate(startDateValue);

  /*
   * Une demande n'est plus soumissible à partir de J-2.
   * La dérogation expire donc au début de J-2 et reste
   * utilisable jusqu'à la fin de J-3.
   */
  startDate.setUTCDate(startDate.getUTCDate() - 2);

  return startDate;
}

function overlapsSummer(
  startDate: Date,
  endDate: Date,
): boolean {
  for (
    let year = startDate.getUTCFullYear();
    year <= endDate.getUTCFullYear();
    year += 1
  ) {
    const summerStart = new Date(Date.UTC(year, 4, 1));
    const summerEnd = new Date(Date.UTC(year, 9, 31));

    if (
      startDate.getTime() <= summerEnd.getTime() &&
      endDate.getTime() >= summerStart.getTime()
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
