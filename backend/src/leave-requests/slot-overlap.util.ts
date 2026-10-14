import { DayPeriod } from './leave-request.entity';
import {
  occupiesSlot,
  type PeriodCoverageItem,
} from './leave-request-period.util';

export type PeriodSlot = PeriodCoverageItem;

export interface SlotConflict {
  date: string;
  period: DayPeriod;
}

function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Premier conflit de créneau (MATIN / APRES_MIDI) entre deux périodes, ou
 * `null` si aucune superposition. La complexité est bornée par la longueur de
 * l'intersection des deux fenêtres de dates.
 */
export function findPeriodConflict(
  candidate: PeriodSlot,
  occupied: PeriodSlot,
): SlotConflict | null {
  if (
    candidate.endDate < occupied.startDate ||
    occupied.endDate < candidate.startDate
  ) {
    return null;
  }

  let date =
    candidate.startDate > occupied.startDate
      ? candidate.startDate
      : occupied.startDate;
  const end =
    candidate.endDate < occupied.endDate
      ? candidate.endDate
      : occupied.endDate;

  while (date <= end) {
    if (
      occupiesSlot(candidate, date, DayPeriod.MATIN) &&
      occupiesSlot(occupied, date, DayPeriod.MATIN)
    ) {
      return { date, period: DayPeriod.MATIN };
    }

    if (
      occupiesSlot(candidate, date, DayPeriod.APRES_MIDI) &&
      occupiesSlot(occupied, date, DayPeriod.APRES_MIDI)
    ) {
      return { date, period: DayPeriod.APRES_MIDI };
    }

    date = addIsoDays(date, 1);
  }

  return null;
}

export function formatSlotConflictDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

export function formatSlotConflictPeriod(period: DayPeriod): string {
  return period === DayPeriod.MATIN ? 'Le matin' : 'L’après-midi';
}
