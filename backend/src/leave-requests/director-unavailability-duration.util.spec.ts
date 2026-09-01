import { BadRequestException } from '@nestjs/common';
import { DayPeriod } from './leave-request.entity';
import { normalizeDirectorUnavailabilityDuration } from './director-unavailability-duration.util';

describe('normalizeDirectorUnavailabilityDuration', () => {
  it('accepte une durée horaire positive uniquement sur une journée', async () => {
    await expect(normalizeDirectorUnavailabilityDuration({
      startDate: '2026-09-10',
      endDate: '2026-09-10',
      durationHours: 2.5,
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      calculateDays: jest.fn(),
    })).resolves.toEqual({
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      calendarDuration: 1,
      deductedDays: 0,
      durationHours: 2.5,
    });
  });

  it('refuse les heures sur plusieurs jours', async () => {
    await expect(normalizeDirectorUnavailabilityDuration({
      startDate: '2026-09-10',
      endDate: '2026-09-11',
      durationHours: 2,
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      calculateDays: jest.fn(),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une durée horaire nulle ou négative', async () => {
    await expect(normalizeDirectorUnavailabilityDuration({
      startDate: '2026-09-10',
      endDate: '2026-09-10',
      durationHours: 0,
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      calculateDays: jest.fn(),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('conserve le calcul existant quand aucune durée horaire n’est fournie', async () => {
    const calculateDays = jest.fn().mockResolvedValue({ calendarDuration: 3, deductedDays: 2.5 });
    await expect(normalizeDirectorUnavailabilityDuration({
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      durationHours: null,
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.MATIN,
      calculateDays,
    })).resolves.toEqual({
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.MATIN,
      calendarDuration: 3,
      deductedDays: 2.5,
      durationHours: null,
    });
    expect(calculateDays).toHaveBeenCalledTimes(1);
  });
});
