import { BadRequestException } from '@nestjs/common';

import type { DayPeriod } from './leave-request.entity';

const FULL_DAY_START = 'MATIN' as DayPeriod;
const FULL_DAY_END = 'APRES_MIDI' as DayPeriod;

type DayCalculation = {
  calendarDuration: number;
  deductedDays: number;
};

type DirectorUnavailabilityDurationInput = {
  startDate: string;
  endDate: string;
  durationHours: number | null | undefined;
  startPeriod: DayPeriod;
  endPeriod: DayPeriod;
  calculateDays: () => Promise<DayCalculation>;
};

type DirectorUnavailabilityDuration = DayCalculation & {
  startPeriod: DayPeriod;
  endPeriod: DayPeriod;
  durationHours: number | null;
};

export async function normalizeDirectorUnavailabilityDuration(
  input: DirectorUnavailabilityDurationInput,
): Promise<DirectorUnavailabilityDuration> {
  if (input.durationHours !== null && input.durationHours !== undefined) {
    const hours = Number(input.durationHours);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      throw new BadRequestException(
        'La durée horaire doit être comprise entre 0,25 et 24 heures.',
      );
    }

    if (input.startDate !== input.endDate) {
      throw new BadRequestException(
        'Une indisponibilité en heures doit concerner une seule journée.',
      );
    }

    // Réutilise la validation existante des bornes (jour ouvré, fermeture, etc.)
    // même si une indisponibilité horaire ne décompte pas de journée de congé.
    await input.calculateDays();

    return {
      startPeriod: FULL_DAY_START,
      endPeriod: FULL_DAY_END,
      calendarDuration: 1,
      deductedDays: 0,
      durationHours: Math.round(hours * 100) / 100,
    };
  }

  const dates = await input.calculateDays();
  return {
    startPeriod: input.startPeriod,
    endPeriod: input.endPeriod,
    calendarDuration: dates.calendarDuration,
    deductedDays: dates.deductedDays,
    durationHours: null,
  };
}
