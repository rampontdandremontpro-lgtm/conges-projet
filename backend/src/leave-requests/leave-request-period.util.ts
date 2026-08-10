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
