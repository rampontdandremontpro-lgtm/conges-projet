import { DayPeriod } from '../leave-requests/leave-request.entity';
import {
  buildFractionnementDayList,
  computeFractionnement,
  computeFractionnementBonus,
  defaultMainLeaveCapForRegime,
  defaultThresholdsForRegime,
  isOutsideEligiblePeriod,
} from './fractionnement.util';

describe('fractionnement.util', () => {
  describe('buildFractionnementDayList', () => {
    it('ouvrable (légal) : compte les samedis, exclut les dimanches', () => {
      // 2026-11-02 (lundi) → 2026-11-07 (samedi) : 6 jours ouvrables.
      const days = buildFractionnementDayList(
        '2026-11-02',
        '2026-11-07',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
        true,
      );
      expect(days).toHaveLength(6);
    });

    it('ouvré (Syntec) : exclut samedi ET dimanche', () => {
      // 2026-11-02 (lundi) → 2026-11-07 (samedi) : 5 jours ouvrés.
      const days = buildFractionnementDayList(
        '2026-11-02',
        '2026-11-07',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
        false,
      );
      expect(days).toHaveLength(5);
    });

    it('exclut les jours non déductibles (fériés)', () => {
      const days = buildFractionnementDayList(
        '2026-11-02',
        '2026-11-04',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(['2026-11-03']),
        true,
      );
      expect(days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-04']);
    });

    it('gère les demi-journées (début après-midi, fin matin)', () => {
      const days = buildFractionnementDayList(
        '2026-11-02',
        '2026-11-04',
        DayPeriod.APRES_MIDI,
        DayPeriod.MATIN,
        new Set(),
        true,
      );
      expect(days.map((d) => d.value)).toEqual([0.5, 1, 0.5]);
    });
  });

  describe('isOutsideEligiblePeriod', () => {
    it('dedans (05-01 → 10-31)', () => {
      expect(isOutsideEligiblePeriod('2026-05-01', '05-01', '10-31')).toBe(false);
      expect(isOutsideEligiblePeriod('2026-10-31', '05-01', '10-31')).toBe(false);
      expect(isOutsideEligiblePeriod('2026-07-15', '05-01', '10-31')).toBe(false);
    });

    it('dehors (avant le 1er mai / après le 31 octobre)', () => {
      expect(isOutsideEligiblePeriod('2026-04-30', '05-01', '10-31')).toBe(true);
      expect(isOutsideEligiblePeriod('2026-11-01', '05-01', '10-31')).toBe(true);
      expect(isOutsideEligiblePeriod('2026-01-01', '05-01', '10-31')).toBe(true);
    });
  });

  describe('computeFractionnementBonus', () => {
    const syntec = defaultThresholdsForRegime('SYNTEC');
    const legal = defaultThresholdsForRegime('LEGAL');

    it('Syntec : 0/1/2 → 0 ; 3/4 → +1 ; ≥5 → +2', () => {
      expect(computeFractionnementBonus('SYNTEC', 0, syntec)).toBe(0);
      expect(computeFractionnementBonus('SYNTEC', 2, syntec)).toBe(0);
      expect(computeFractionnementBonus('SYNTEC', 3, syntec)).toBe(1);
      expect(computeFractionnementBonus('SYNTEC', 4, syntec)).toBe(1);
      expect(computeFractionnementBonus('SYNTEC', 5, syntec)).toBe(2);
      expect(computeFractionnementBonus('SYNTEC', 6, syntec)).toBe(2);
    });

    it('Légal : 0/1/2 → 0 ; 3/4/5 → +1 ; ≥6 → +2', () => {
      expect(computeFractionnementBonus('LEGAL', 2, legal)).toBe(0);
      expect(computeFractionnementBonus('LEGAL', 3, legal)).toBe(1);
      expect(computeFractionnementBonus('LEGAL', 5, legal)).toBe(1);
      expect(computeFractionnementBonus('LEGAL', 6, legal)).toBe(2);
    });
  });

  describe('computeFractionnement (cinquième semaine exclue)', () => {
    const base = {
      eligiblePeriodStart: '05-01',
      eligiblePeriodEnd: '10-31',
    };

    it('Syntec : 3 jours ouvrés hors période dans le congé principal → +1', () => {
      // 20 jours ouvrés de congé principal, dont 3 hors période (novembre).
      const days = [
        { date: '2026-11-02', value: 1 },
        { date: '2026-11-03', value: 1 },
        { date: '2026-11-04', value: 1 },
      ];
      const result = computeFractionnement({
        regime: 'SYNTEC',
        days,
        ...base,
        mainLeaveCap: 20,
        thresholds: defaultThresholdsForRegime('SYNTEC'),
      });
      expect(result.outsidePeriodDays).toBe(3);
      expect(result.bonusDays).toBe(1);
    });

    it('Syntec : 5 jours ouvrés hors période → +2', () => {
      const days = Array.from({ length: 5 }, (_, i) => ({
        date: `2026-11-0${i + 2}`,
        value: 1,
      }));
      const result = computeFractionnement({
        regime: 'SYNTEC',
        days,
        ...base,
        mainLeaveCap: 20,
        thresholds: defaultThresholdsForRegime('SYNTEC'),
      });
      expect(result.bonusDays).toBe(2);
    });

    it('exclut la cinquième semaine (jours au-delà du plafond)', () => {
      // 22 jours ouvrés pris, dont 5 hors période mais les 2 derniers
      // appartiennent à la 5e semaine (au-delà de 20) → seulement 3 éligibles.
      const days = [
        { date: '2026-11-02', value: 1 },
        { date: '2026-11-03', value: 1 },
        { date: '2026-11-04', value: 1 },
        { date: '2026-11-05', value: 1 },
        { date: '2026-11-06', value: 1 },
      ];
      const result = computeFractionnement({
        regime: 'SYNTEC',
        days,
        ...base,
        mainLeaveCap: 3,
        thresholds: defaultThresholdsForRegime('SYNTEC'),
      });
      // Les 2 derniers jours passent dans la 5e semaine.
      expect(result.fifthWeekDays).toHaveLength(2);
      expect(result.outsidePeriodDays).toBe(3);
      expect(result.bonusDays).toBe(1);
    });

    it('cumule plusieurs périodes de congés', () => {
      const days = [
        { date: '2026-11-02', value: 1 },
        { date: '2026-11-03', value: 1 },
        { date: '2026-12-14', value: 1 },
        { date: '2026-12-15', value: 1 },
        { date: '2027-01-05', value: 1 },
      ];
      const result = computeFractionnement({
        regime: 'LEGAL',
        days,
        ...base,
        mainLeaveCap: defaultMainLeaveCapForRegime('LEGAL'),
        thresholds: defaultThresholdsForRegime('LEGAL'),
      });
      expect(result.outsidePeriodDays).toBe(5);
      expect(result.bonusDays).toBe(1);
    });

    it('demi-journée prise en compte dans le cumul', () => {
      const days = [
        { date: '2026-11-02', value: 1 },
        { date: '2026-11-03', value: 1 },
        { date: '2026-11-04', value: 0.5 },
        { date: '2026-11-05', value: 0.5 },
      ];
      const result = computeFractionnement({
        regime: 'SYNTEC',
        days,
        ...base,
        mainLeaveCap: 20,
        thresholds: defaultThresholdsForRegime('SYNTEC'),
      });
      expect(result.outsidePeriodDays).toBe(3);
      expect(result.bonusDays).toBe(1);
    });
  });
});
