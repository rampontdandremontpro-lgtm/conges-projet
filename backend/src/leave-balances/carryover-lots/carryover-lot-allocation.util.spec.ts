import { DayPeriod } from '../../leave-requests/leave-request.entity';
import { calculateDeductedLeaveDays } from '../../leave-requests/leave-request-period.util';
import {
  allocateCarryoverLots,
  calculateDeductedLeaveDayList,
  isLotConsumable,
  ConsumableLotInput,
  DatedLeaveDay,
} from './carryover-lot-allocation.util';

const validLot = (overrides: Partial<ConsumableLotInput> = {}): ConsumableLotInput => ({
  id: 1,
  remainingDays: 5,
  expiresAt: '2026-12-31',
  status: 'ACTIF',
  confirmationStatus: 'CONFIRMEE',
  reconciled: true,
  ...overrides,
});

const day = (date: string, value = 1): DatedLeaveDay => ({ date, value });
const sum = (days: DatedLeaveDay[]) =>
  Math.round(days.reduce((s, d) => s + d.value, 0) * 100) / 100;

describe('calculateDeductedLeaveDayList (cohérence GMES)', () => {
  const cases: Array<[string, string, DayPeriod, DayPeriod]> = [
    ['2026-08-03', '2026-08-07', DayPeriod.MATIN, DayPeriod.APRES_MIDI],
    ['2026-08-03', '2026-08-07', DayPeriod.APRES_MIDI, DayPeriod.APRES_MIDI],
    ['2026-08-03', '2026-08-05', DayPeriod.MATIN, DayPeriod.MATIN],
    ['2026-08-28', '2026-08-28', DayPeriod.APRES_MIDI, DayPeriod.APRES_MIDI],
  ];

  it.each(cases)(
    'somme identique à calculateDeductedLeaveDays (%s → %s)',
    (startDate, endDate, startPeriod, endPeriod) => {
      const nonDeductible = new Set(['2026-08-04']);
      const list = calculateDeductedLeaveDayList(
        startDate,
        endDate,
        startPeriod,
        endPeriod,
        nonDeductible,
      );
      const total = calculateDeductedLeaveDays(
        new Date(`${startDate}T00:00:00.000Z`),
        new Date(`${endDate}T00:00:00.000Z`),
        startPeriod,
        endPeriod,
        nonDeductible,
      );
      expect(sum(list)).toBe(total);
    },
  );

  it('exclut dimanche et jour non décompté', () => {
    const list = calculateDeductedLeaveDayList(
      '2026-08-03', // lundi
      '2026-08-09', // dimanche
      DayPeriod.MATIN,
      DayPeriod.APRES_MIDI,
      new Set(['2026-08-05']), // mercredi férié
    );
    const dates = list.map((d) => d.date);
    expect(dates).not.toContain('2026-08-09'); // dimanche
    expect(dates).not.toContain('2026-08-05'); // non décompté
    expect(dates).toContain('2026-08-03');
  });

  it('demi-journées (matin/après-midi)', () => {
    const list = calculateDeductedLeaveDayList(
      '2026-08-03',
      '2026-08-03',
      DayPeriod.APRES_MIDI,
      DayPeriod.APRES_MIDI,
      new Set(),
    );
    expect(sum(list)).toBe(0.5);
  });
});

describe('isLotConsumable', () => {
  it('lot valide', () => {
    expect(isLotConsumable(validLot()).consumable).toBe(true);
  });
  it('reliquat inconnu → non consommable', () => {
    expect(isLotConsumable(validLot({ remainingDays: null })).reason).toBe('RELIQUAT_INCONNU');
  });
  it('reliquat épuisé → non consommable', () => {
    expect(isLotConsumable(validLot({ remainingDays: 0 })).reason).toBe('RELIQUAT_EPUISE');
  });
  it('origine non rapprochée → non consommable', () => {
    expect(isLotConsumable(validLot({ reconciled: false })).reason).toBe('ORIGINE_NON_RAPPROCHEE');
  });
  it('statut A_VERIFIER → non consommable', () => {
    expect(isLotConsumable(validLot({ status: 'A_VERIFIER' })).reason).toBe('STATUT_A_VERIFIER');
  });
  it('statut EXPIRE → non consommable', () => {
    expect(isLotConsumable(validLot({ status: 'EXPIRE' })).reason).toBe('STATUT_EXPIRE');
  });
  it('confirmation EN_ATTENTE → non consommable', () => {
    expect(isLotConsumable(validLot({ confirmationStatus: 'EN_ATTENTE' })).reason).toBe(
      'CONFIRMATION_EN_ATTENTE',
    );
  });
  it('échéance indéfinie → non consommable', () => {
    expect(isLotConsumable(validLot({ expiresAt: null })).reason).toBe('ECHEANCE_INDEFINIE');
  });
});

describe('allocateCarryoverLots', () => {
  it('1. lot valide couvrant intégralement une demande', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-03'), day('2026-08-04'), day('2026-08-05')],
      [validLot({ remainingDays: 3 })],
    );
    expect(r.totalLotDays).toBe(3);
    expect(r.uncovered).toHaveLength(0);
    expect(r.allocations).toHaveLength(1);
  });

  it('2. deux lots de dates d’expiration différentes → FIFO', () => {
    const lotEarly = validLot({ id: 1, remainingDays: 2, expiresAt: '2026-09-01' });
    const lotLate = validLot({ id: 2, remainingDays: 4, expiresAt: '2026-12-01' });
    const r = allocateCarryoverLots(
      [day('2026-08-28'), day('2026-08-31'), day('2026-09-01'), day('2026-09-02')],
      [lotLate, lotEarly], // ordre d'entrée inversé volontairement
    );
    expect(r.allocations.map((a) => a.lotId)).toEqual([1, 2]);
    expect(r.allocations[0].days).toBe(2);
    expect(r.allocations[1].days).toBe(2);
  });

  it('3. demande utilisant plusieurs lots', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28'), day('2026-08-31'), day('2026-09-01')],
      [validLot({ id: 1, remainingDays: 1, expiresAt: '2026-09-01' }), validLot({ id: 2, remainingDays: 2, expiresAt: '2026-10-01' })],
    );
    expect(r.allocations.map((a) => a.lotId)).toEqual([1, 2]);
    expect(r.allocations[0].days).toBe(1);
    expect(r.allocations[1].days).toBe(2);
  });

  it('4. demande partiellement couverte par des jours ordinaires', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28'), day('2026-08-31'), day('2026-09-01')],
      [validLot({ remainingDays: 2, expiresAt: '2026-12-31' })],
    );
    expect(r.totalLotDays).toBe(2);
    expect(sum(r.uncovered)).toBe(1);
  });

  it('5. demande franchissant l’échéance d’un lot', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28'), day('2026-08-31'), day('2026-09-01')],
      [validLot({ remainingDays: 10, expiresAt: '2026-08-31' })],
    );
    expect(r.totalLotDays).toBe(2); // 28/08 + 31/08
    expect(r.uncovered.map((d) => d.date)).toEqual(['2026-09-01']);
  });

  it('6. lot expiré → écarté', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28')],
      [validLot({ status: 'EXPIRE', expiresAt: '2026-08-01' })],
    );
    expect(r.allocations).toHaveLength(0);
    expect(r.skipped[0].reason).toBe('STATUT_EXPIRE');
    expect(sum(r.uncovered)).toBe(1);
  });

  it('7. lot reliquat inconnu → écarté', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28')],
      [validLot({ remainingDays: null })],
    );
    expect(r.skipped[0].reason).toBe('RELIQUAT_INCONNU');
  });

  it('8. lot A_VERIFIER → écarté', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28')],
      [validLot({ status: 'A_VERIFIER' })],
    );
    expect(r.skipped[0].reason).toBe('STATUT_A_VERIFIER');
  });

  it('9. confirmation EN_ATTENTE → écarté', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28')],
      [validLot({ confirmationStatus: 'EN_ATTENTE' })],
    );
    expect(r.skipped[0].reason).toBe('CONFIRMATION_EN_ATTENTE');
  });

  it('10. quantité insuffisante → partiel + ordinaire', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28'), day('2026-08-31')],
      [validLot({ remainingDays: 1 })],
    );
    expect(r.totalLotDays).toBe(1);
    expect(sum(r.uncovered)).toBe(1);
  });

  it('11. journée complète', () => {
    const r = allocateCarryoverLots([day('2026-08-28', 1)], [validLot({ remainingDays: 1 })]);
    expect(r.totalLotDays).toBe(1);
    expect(r.allocations[0].dates[0].value).toBe(1);
  });

  it('12. demi-journée', () => {
    const r = allocateCarryoverLots([day('2026-08-28', 0.5)], [validLot({ remainingDays: 0.5 })]);
    expect(r.totalLotDays).toBe(0.5);
    expect(r.allocations[0].dates[0].value).toBe(0.5);
  });

  it('demi-journée répartie sur deux lots', () => {
    const r = allocateCarryoverLots(
      [day('2026-08-28', 0.5)],
      [validLot({ id: 1, remainingDays: 0.25, expiresAt: '2026-09-01' }), validLot({ id: 2, remainingDays: 1, expiresAt: '2026-10-01' })],
    );
    // le premier lot n'a que 0.25 → 0.25 lot1 + 0.25 lot2
    const total = sum(r.allocations.flatMap((a) => a.dates));
    expect(total).toBe(0.5);
  });
});
