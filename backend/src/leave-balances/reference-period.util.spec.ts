import {
  addDays,
  balanceRecapType,
  balanceReminderType,
  counterReferencePeriod,
  currentReferencePeriod,
  formatFrenchDate,
  nextReferencePeriod,
  referencePeriodEndDate,
  referencePeriodStartDate,
  reminderDeadlines,
  subtractMonthsClamped,
} from './reference-period.util';

describe('reference-period.util — période de référence et échéances E4', () => {
  describe('A — période 06-01 : 2026-2027', () => {
    it('début 01/06/2026, fin 31/05/2027, période suivante 2027-2028', () => {
      expect(referencePeriodStartDate('2026-2027', '06-01')).toBe(
        '2026-06-01',
      );
      expect(referencePeriodEndDate('2026-2027', '06-01')).toBe(
        '2027-05-31',
      );
      expect(nextReferencePeriod('2026-2027')).toBe('2027-2028');
    });

    it('currentReferencePeriod autour de la bascule du 1er juin', () => {
      expect(currentReferencePeriod('2026-05-31', '06-01')).toBe(
        '2025-2026',
      );
      expect(currentReferencePeriod('2026-06-01', '06-01')).toBe(
        '2026-2027',
      );
      expect(currentReferencePeriod('2027-05-31', '06-01')).toBe(
        '2026-2027',
      );
      expect(currentReferencePeriod('2027-06-01', '06-01')).toBe(
        '2027-2028',
      );
    });
  });

  describe('B — REFERENCE_PERIOD_START = 01-01', () => {
    it('fin 31/12, période alignée sur l’année civile', () => {
      expect(referencePeriodEndDate('2026-2027', '01-01')).toBe(
        '2026-12-31',
      );
      expect(currentReferencePeriod('2026-12-31', '01-01')).toBe(
        '2026-2027',
      );
      expect(currentReferencePeriod('2027-01-01', '01-01')).toBe(
        '2027-2028',
      );
    });
  });

  describe('C — REFERENCE_PERIOD_START = 04-15', () => {
    it('fin 14/04, période 16/04 → 14/04', () => {
      expect(referencePeriodStartDate('2026-2027', '04-15')).toBe(
        '2026-04-15',
      );
      expect(referencePeriodEndDate('2026-2027', '04-15')).toBe(
        '2027-04-14',
      );
      expect(currentReferencePeriod('2027-04-14', '04-15')).toBe(
        '2026-2027',
      );
      expect(currentReferencePeriod('2027-04-15', '04-15')).toBe(
        '2027-2028',
      );
    });
  });

  describe('D — cinq échéances pour une fin au 31/05/2027', () => {
    it('28/02, 31/03, 30/04, 16/05, 24/05 (ordre chronologique)', () => {
      const deadlines = reminderDeadlines('2026-2027', '06-01');
      expect(deadlines.map((deadline) => [deadline.key, deadline.date])).toEqual([
        ['3M', '2027-02-28'],
        ['2M', '2027-03-31'],
        ['1M', '2027-04-30'],
        ['15D', '2027-05-16'],
        ['7D', '2027-05-24'],
      ]);
    });

    it('soustraction calendaire et non 90/60/30 jours fixes', () => {
      expect(subtractMonthsClamped('2027-05-31', 3)).toBe('2027-02-28');
      expect(subtractMonthsClamped('2027-05-31', 2)).toBe('2027-03-31');
      expect(subtractMonthsClamped('2027-05-31', 1)).toBe('2027-04-30');
      expect(addDays('2027-05-31', -15)).toBe('2027-05-16');
      expect(addDays('2027-05-31', -7)).toBe('2027-05-24');
    });
  });

  describe('E — année bissextile', () => {
    it('31/05/2028 − 3 mois → 29/02/2028', () => {
      expect(referencePeriodEndDate('2027-2028', '06-01')).toBe(
        '2028-05-31',
      );
      expect(subtractMonthsClamped('2028-05-31', 3)).toBe('2028-02-29');
      const deadlines = reminderDeadlines('2027-2028', '06-01');
      expect(deadlines.find((deadline) => deadline.key === '3M')?.date).toBe(
        '2028-02-29',
      );
    });
  });

  describe('libellés métier N-1 / N / N+1', () => {
    it('associe 2026-2027 à 2025-2026 pour N-1, 2026-2027 pour N et 2027-2028 pour N+1', () => {
      expect(counterReferencePeriod('2026-2027', 'N-1')).toBe('2025-2026');
      expect(counterReferencePeriod('2026-2027', 'N')).toBe('2026-2027');
      expect(counterReferencePeriod('2026-2027', 'N+1')).toBe('2027-2028');
    });
  });

  describe('formats et garde-fous', () => {
    it('formatFrenchDate → « 31 mai 2027 »', () => {
      expect(formatFrenchDate('2027-05-31')).toBe('31 mai 2027');
    });

    it('types anti-doublon portant période et échéance', () => {
      expect(balanceReminderType('15D', '2026-2027')).toBe(
        'BALANCE_REMINDER_15D_2026-2027',
      );
      expect(balanceRecapType('3M', '2026-2027')).toBe(
        'BALANCE_RECAP_3M_2026-2027',
      );
    });

    it('addDays franchit les fins de mois et années', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('valeurs invalides levées', () => {
      expect(() => currentReferencePeriod('2026-01-01', '13-01')).toThrow(
        'MM-JJ',
      );
      expect(() => referencePeriodEndDate('2026-2028', '06-01')).toThrow(
        'consécutives',
      );
      expect(() => nextReferencePeriod('2026-2028')).toThrow();
    });
  });
});
