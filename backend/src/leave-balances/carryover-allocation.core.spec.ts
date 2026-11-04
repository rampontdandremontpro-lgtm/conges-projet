import { DayPeriod } from '../leave-requests/leave-request.entity';
import {
  allocateCarryoverLots,
  calculateDeductedLeaveDayList,
  ConsumableLotInput,
  isLotConsumable,
} from './carryover-allocation.core';

const lot = (partial: Partial<ConsumableLotInput>): ConsumableLotInput => ({
  id: 1,
  remainingDays: 4,
  expiresAt: '2027-09-25',
  status: 'ACTIF',
  confirmationStatus: 'CONFIRMEE',
  reconciled: true,
  ...partial,
});

describe('carryover-allocation.core (moteur pur partagé)', () => {
  describe('calculateDeductedLeaveDayList', () => {
    it('journée complète', () => {
      const days = calculateDeductedLeaveDayList(
        '2026-10-28',
        '2026-10-28',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toEqual([{ date: '2026-10-28', value: 1 }]);
    });

    it('demi-journée (après-midi unique)', () => {
      const days = calculateDeductedLeaveDayList(
        '2026-10-28',
        '2026-10-28',
        DayPeriod.APRES_MIDI,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toEqual([{ date: '2026-10-28', value: 0.5 }]);
    });

    it('exclut les dimanches et dates non décomptées', () => {
      // 2026-11-01 est un dimanche ; 2026-11-02 non décompté.
      const days = calculateDeductedLeaveDayList(
        '2026-10-31',
        '2026-11-03',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(['2026-11-02']),
      );
      const dates = days.map((d) => d.date);
      expect(dates).not.toContain('2026-11-01');
      expect(dates).not.toContain('2026-11-02');
      expect(dates).toContain('2026-10-31');
      expect(dates).toContain('2026-11-03');
    });

    it('règle GMES : vendredi après-midi ajoute le samedi', () => {
      // 2026-10-30 est un vendredi.
      const days = calculateDeductedLeaveDayList(
        '2026-10-30',
        '2026-10-30',
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31']);
    });
  });

  describe('isLotConsumable', () => {
    it('lot consommable', () => {
      expect(isLotConsumable(lot({})).consumable).toBe(true);
    });
    it('reliquat inconnu → non consommable', () => {
      expect(isLotConsumable(lot({ remainingDays: null }))).toEqual({
        consumable: false,
        reason: 'RELIQUAT_INCONNU',
      });
    });
    it('reliquat épuisé → non consommable', () => {
      expect(isLotConsumable(lot({ remainingDays: 0 })).reason).toBe('RELIQUAT_EPUISE');
    });
    it('statut non ACTIF (EXPIRE/SUSPENDU) → non consommable', () => {
      expect(isLotConsumable(lot({ status: 'EXPIRE' })).reason).toBe('STATUT_EXPIRE');
      expect(isLotConsumable(lot({ status: 'SUSPENDU' })).reason).toBe('STATUT_SUSPENDU');
    });
    it('confirmation EN_ATTENTE → non consommable', () => {
      expect(isLotConsumable(lot({ confirmationStatus: 'EN_ATTENTE' })).reason).toBe(
        'CONFIRMATION_EN_ATTENTE',
      );
    });
    it('échéance indéfinie → non consommable', () => {
      expect(isLotConsumable(lot({ expiresAt: null })).reason).toBe('ECHEANCE_INDEFINIE');
    });
    it('origine non rapprochée → non consommable', () => {
      expect(isLotConsumable(lot({ reconciled: false })).reason).toBe('ORIGINE_NON_RAPPROCHEE');
    });
  });

  describe('allocateCarryoverLots', () => {
    const day = (date: string, value = 1) => ({ date, value });

    it('FIFO par échéance la plus proche', () => {
      const result = allocateCarryoverLots(
        [day('2027-08-01'), day('2027-08-02')],
        [
          lot({ id: 1, remainingDays: 1, expiresAt: '2027-08-01' }),
          lot({ id: 2, remainingDays: 1, expiresAt: '2027-08-31' }),
        ],
      );
      // Le lot 1 (échéance 2027-08-01) finance le 01/08 ; le lot 2 finance le 02/08.
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].lotId).toBe(1);
      expect(result.allocations[1].lotId).toBe(2);
      expect(result.uncovered).toHaveLength(0);
      expect(result.totalLotDays).toBe(2);
    });

    it('échéances identiques → ordre par id', () => {
      const result = allocateCarryoverLots(
        [day('2027-08-01')],
        [
          lot({ id: 10, remainingDays: 1, expiresAt: '2027-08-31' }),
          lot({ id: 2, remainingDays: 1, expiresAt: '2027-08-31' }),
        ],
      );
      expect(result.allocations[0].lotId).toBe(2);
    });

    it('une journée au-delà de l\'échéance reste non couverte', () => {
      const result = allocateCarryoverLots(
        [day('2027-09-01'), day('2027-09-02')],
        [lot({ id: 1, remainingDays: 5, expiresAt: '2027-09-01' })],
      );
      expect(result.allocations[0].days).toBe(1);
      expect(result.uncovered).toEqual([{ date: '2027-09-02', value: 1 }]);
    });

    it('demi-journées couvertes par un lot', () => {
      const result = allocateCarryoverLots(
        [day('2027-08-01', 0.5), day('2027-08-02', 0.5)],
        [lot({ id: 1, remainingDays: 1, expiresAt: '2027-08-31' })],
      );
      expect(result.totalLotDays).toBe(1);
      expect(result.allocations[0].days).toBe(1);
      expect(result.uncovered).toHaveLength(0);
    });

    it('lots inéligibles (expiré/gelé/inconnu) → skippés', () => {
      const result = allocateCarryoverLots(
        [day('2027-08-01')],
        [
          lot({ id: 1, remainingDays: 3, status: 'EXPIRE' }),
          lot({ id: 2, remainingDays: null }),
          lot({ id: 3, remainingDays: 3, expiresAt: null }),
        ],
      );
      expect(result.allocations).toHaveLength(0);
      expect(result.skipped.map((s) => s.reason)).toEqual([
        'STATUT_EXPIRE',
        'RELIQUAT_INCONNU',
        'ECHEANCE_INDEFINIE',
      ]);
      expect(result.uncovered).toEqual([{ date: '2027-08-01', value: 1 }]);
    });

    it('plusieurs périodes d\'origine : allocation sans mélange des échéances', () => {
      const result = allocateCarryoverLots(
        [day('2027-03-15'), day('2027-09-15')],
        [
          lot({ id: 1, remainingDays: 1, expiresAt: '2027-03-31' }),
          lot({ id: 2, remainingDays: 2, expiresAt: '2027-09-30' }),
        ],
      );
      // Lot 1 finance le 15/03 (≤ 31/03) ; lot 2 finance le 15/09 (≤ 30/09).
      expect(result.allocations.map((a) => a.lotId)).toEqual([1, 2]);
      expect(result.allocations[0].dates).toEqual([{ date: '2027-03-15', value: 1 }]);
      expect(result.allocations[1].dates).toEqual([{ date: '2027-09-15', value: 1 }]);
      expect(result.uncovered).toHaveLength(0);
    });
  });
});
