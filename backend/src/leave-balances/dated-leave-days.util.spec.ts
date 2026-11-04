import { DayPeriod } from '../leave-requests/leave-request.entity';
import { sumDatedDays } from './carryover-allocation.core';
import { buildDatedLeaveDays } from './dated-leave-days.util';

describe('dated-leave-days.util — production fiable des journées datées', () => {
  it('jours complets cohérents avec deductedDays', () => {
    // 2027-05-03 = lundi, 04 = mardi, 05 = mercredi.
    const days = buildDatedLeaveDays({
      startDate: '2027-05-03',
      endDate: '2027-05-05',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      nonDeductibleDates: new Set(),
      expectedDays: 3,
    });
    expect(days).toEqual([
      { date: '2027-05-03', value: 1 },
      { date: '2027-05-04', value: 1 },
      { date: '2027-05-05', value: 1 },
    ]);
  });

  it('demi-journée (après-midi unique) cohérente', () => {
    const days = buildDatedLeaveDays({
      startDate: '2027-05-03',
      endDate: '2027-05-03',
      startPeriod: DayPeriod.APRES_MIDI,
      endPeriod: DayPeriod.APRES_MIDI,
      nonDeductibleDates: new Set(),
      expectedDays: 0.5,
    });
    expect(days).toEqual([{ date: '2027-05-03', value: 0.5 }]);
  });

  it('exclut dimanches et dates non déductibles, cohérence conservée', () => {
    // 2027-05-03 (lun) → 2027-05-09 (dim) : lun→sam inclus, dim exclu, mercredi non déductible.
    const days = buildDatedLeaveDays({
      startDate: '2027-05-03',
      endDate: '2027-05-09',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      nonDeductibleDates: new Set(['2027-05-05']), // mercredi férié
      expectedDays: 5,
    });
    expect(days.map((d) => d.date)).toEqual([
      '2027-05-03',
      '2027-05-04',
      '2027-05-06',
      '2027-05-07',
      '2027-05-08',
    ]);
    expect(sumDatedDays(days)).toBe(5);
  });

  it('traverse plusieurs mois sans perte', () => {
    // 2027-04-30 (ven) → 2027-05-03 (lun) : ven + sam + lun, dimanche exclu.
    const days = buildDatedLeaveDays({
      startDate: '2027-04-30',
      endDate: '2027-05-03',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
      nonDeductibleDates: new Set(),
      expectedDays: 3,
    });
    expect(days.map((d) => d.date)).toEqual(['2027-04-30', '2027-05-01', '2027-05-03']);
  });

  it('lève une erreur explicite si la somme ne correspond pas au nombre attendu', () => {
    let message = '';
    try {
      buildDatedLeaveDays({
        startDate: '2027-05-03',
        endDate: '2027-05-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.APRES_MIDI,
        nonDeductibleDates: new Set(),
        expectedDays: 5, // 3 jours calculés
      });
    } catch (error: any) {
      message = error?.message ?? String(error);
    }
    expect(message).toContain('Quantité incohérente');
  });

  it('sumDatedDays arrondit les demi-journées', () => {
    expect(
      sumDatedDays([
        { date: '2027-05-03', value: 0.5 },
        { date: '2027-05-04', value: 1 },
        { date: '2027-05-05', value: 0.5 },
      ]),
    ).toBe(2);
  });
});
