import { DayPeriod } from './leave-request.entity';


export interface PeriodCoverageItem {
  startDate: string;
  endDate: string;
  startPeriod: DayPeriod | null;
  endPeriod: DayPeriod | null;
}

export function occupiesSlot(
  item: PeriodCoverageItem,
  date: string,
  period: DayPeriod,
): boolean {
  if (date < item.startDate || date > item.endDate) {
    return false;
  }

  const startPeriod = item.startPeriod ?? DayPeriod.MATIN;
  const endPeriod = item.endPeriod ?? DayPeriod.APRES_MIDI;

  if (item.startDate === item.endDate) {
    if (
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.MATIN
    ) {
      return false;
    }

    if (
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.APRES_MIDI
    ) {
      return period === DayPeriod.APRES_MIDI;
    }

    if (
      startPeriod === DayPeriod.MATIN &&
      endPeriod === DayPeriod.MATIN
    ) {
      return period === DayPeriod.MATIN;
    }

    return true;
  }

  if (date === item.startDate) {
    return (
      startPeriod === DayPeriod.MATIN ||
      period === DayPeriod.APRES_MIDI
    );
  }

  if (date === item.endDate) {
    return (
      endPeriod === DayPeriod.APRES_MIDI ||
      period === DayPeriod.MATIN
    );
  }

  return true;
}

export function getCurrentDayPeriod(
  now: Date,
  afternoonStartHour: string,
): DayPeriod {
  const currentTime = getMartiniqueTimeString(now);
  return currentTime < afternoonStartHour
    ? DayPeriod.MATIN
    : DayPeriod.APRES_MIDI;
}

export function getMartiniqueDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getNextPeriodSwitch(
  now: Date,
  afternoonStartHour: string,
  timeZone = 'America/Martinique',
): Date {
  if (timeZone !== 'America/Martinique') {
    throw new Error(
      'Seul le fuseau America/Martinique (UTC−4 fixe) est pris en charge.',
    );
  }

  const currentDate = getMartiniqueDateString(now);
  const period = getCurrentDayPeriod(now, afternoonStartHour);

  if (period === DayPeriod.APRES_MIDI) {
    const nextDay = new Date(`${currentDate}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return new Date(
      `${nextDay.toISOString().slice(0, 10)}T00:00:00.000-04:00`,
    );
  }

  return new Date(`${currentDate}T${afternoonStartHour}:00.000-04:00`);
}

export function getMartiniqueTimeString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Martinique',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute =
    parts.find((part) => part.type === 'minute')?.value ?? '00';

  return `${hour}:${minute}`;
}

export function getMartiniqueTimeWithSeconds(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Martinique',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute =
    parts.find((part) => part.type === 'minute')?.value ?? '00';
  const second =
    parts.find((part) => part.type === 'second')?.value ?? '00';

  return `${hour}:${minute}:${second}`;
}


export function calculateDeductedLeaveDays(
  startDate: Date,
  endDate: Date,
  startPeriod: DayPeriod,
  endPeriod: DayPeriod,
  nonDeductibleDates: Set<string>,
): number {
  let total = 0;
  const currentDate = new Date(startDate);

  while (currentDate.getTime() <= endDate.getTime()) {
    const currentDateValue = currentDate.toISOString().slice(0, 10);
    const isSunday = currentDate.getUTCDay() === 0;
    const isNonDeductible = nonDeductibleDates.has(currentDateValue);

    if (!isSunday && !isNonDeductible) {
      let value = 1;

      if (
        currentDate.getTime() === startDate.getTime() &&
        startPeriod === DayPeriod.APRES_MIDI
      ) {
        value -= 0.5;
      }

      if (
        currentDate.getTime() === endDate.getTime() &&
        endPeriod === DayPeriod.MATIN
      ) {
        value -= 0.5;
      }

      total += value;
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // Règle GMES : lorsqu'un congé se termine le vendredi après-midi,
  // le samedi qui suit est également décompté, sauf s'il est non décomptable.
  if (endDate.getUTCDay() === 5 && endPeriod === DayPeriod.APRES_MIDI) {
    const saturday = new Date(endDate);
    saturday.setUTCDate(saturday.getUTCDate() + 1);
    const saturdayValue = saturday.toISOString().slice(0, 10);
    if (!nonDeductibleDates.has(saturdayValue)) {
      total += 1;
    }
  }

  // Règle complémentaire : si l'absence se termine le jeudi sans reprise
  // l'après-midi et que le vendredi est férié/non décomptable, le samedi
  // suivant reste un jour ouvrable à décompter. Une fin le jeudi matin
  // signifie au contraire une reprise le jeudi après-midi : aucun samedi
  // supplémentaire n'est alors ajouté.
  if (endDate.getUTCDay() === 4 && endPeriod === DayPeriod.APRES_MIDI) {
    const friday = new Date(endDate);
    friday.setUTCDate(friday.getUTCDate() + 1);
    const fridayValue = friday.toISOString().slice(0, 10);
    if (nonDeductibleDates.has(fridayValue)) {
      const saturday = new Date(friday);
      saturday.setUTCDate(saturday.getUTCDate() + 1);
      const saturdayValue = saturday.toISOString().slice(0, 10);
      if (!nonDeductibleDates.has(saturdayValue)) {
        total += 1;
      }
    }
  }

  return Math.max(total, 0);
}
