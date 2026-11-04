import { CarryoverDelayStatus } from './carryover-expiry.types';
import {
  addDays,
  addMonthsClamp,
  compareDates,
  daysBetween,
  isValidDateString,
} from './carryover-expiry.util';
import { computeCarryoverExpiry } from './carryover-expiry.service';

describe('carryover-expiry.util', () => {
  describe('addMonthsClamp (fins de mois et années bissextiles)', () => {
    it.each([
      ['2025-01-31', 15, '2026-04-30'],
      ['2025-05-31', 15, '2026-08-31'],
      ['2025-06-25', 15, '2026-09-25'],
      ['2024-02-29', 12, '2025-02-28'],
      ['2024-01-31', 1, '2024-02-29'],
      ['2023-02-28', 12, '2024-02-28'],
      ['2024-02-29', 48, '2028-02-29'],
      ['2024-11-30', 15, '2026-02-28'],
    ])('%s + %i mois = %s', (value, months, expected) => {
      expect(addMonthsClamp(value, months)).toBe(expected);
    });
  });

  it('daysBetween / addDays en jours calendaires', () => {
    expect(daysBetween('2026-03-01', '2026-06-01')).toBe(92);
    expect(daysBetween('2026-03-01', '2026-08-31')).toBe(183);
    expect(addDays('2026-08-31', 92)).toBe('2026-12-01');
    expect(addDays('2026-08-31', 31)).toBe('2026-10-01');
  });

  it('isValidDateString rejette les dates inexistantes', () => {
    expect(isValidDateString('2025-02-30')).toBe(false);
    expect(isValidDateString('2024-02-29')).toBe(true);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
  });

  it('compareDates respecte l’ordre chronologique ISO', () => {
    expect(compareDates('2026-08-31', '2026-08-31')).toBe(0);
    expect(compareDates('2026-08-30', '2026-08-31')).toBe(-1);
    expect(compareDates('2026-09-01', '2026-08-31')).toBe(1);
  });
});

describe('computeCarryoverExpiry', () => {
  describe('1. Régime général — date d’information connue', () => {
    it('calcule l’échéance opposable à +15 mois de la date d’information', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        repriseDate: '2025-06-20',
        informationDate: '2025-06-25',
        informationDateCertain: true,
        today: '2025-06-25',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.startDate).toBe('2025-06-25');
      expect(r.deadline).toBe('2026-09-25');
      expect(r.effectiveExpiresAt).toBe('2026-09-25');
      expect(r.indicativeExpiresAt).toBeNull();
      expect(r.legalBasis).toBe('L3141-19-1');
      expect(r.monthsApplied).toBe(15);
      expect(r.suspension).toBeNull();
      expect(r.missingInformation).toHaveLength(0);
    });
  });

  describe('2. Régime général — sans preuve d’information', () => {
    it('date d’information absente → A_VERIFIER, aucune échéance', () => {
      const r = computeCarryoverExpiry({ regime: 'GENERAL', today: '2025-07-01' });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.deadline).toBeNull();
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('L3141-19-3');
    });

    it('date connue mais réception non confirmée à date certaine → indicatif, non opposable', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        informationDateCertain: false,
        today: '2025-06-25',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.indicativeExpiresAt).toBe('2026-09-25');
      expect(r.missingInformation.join(' ')).toContain('non opposable');
    });
  });

  describe('3. Arrêt long — salarié toujours absent', () => {
    const input = {
      regime: 'ARRET_LONG' as const,
      referencePeriodEnd: '2025-05-31',
      absenceStatus: 'ABSENT' as const,
      repriseDate: null,
      acquiredDuringL3141_5_5or7: true,
      suspensionAtLeastOneYearAtPeriodEnd: true,
    };

    it('le délai court depuis la fin de période ; dernier jour encore EN_COURS', () => {
      const r = computeCarryoverExpiry({ ...input, today: '2026-08-31' });
      expect(r.startDate).toBe('2025-05-31');
      expect(r.deadline).toBe('2026-08-31');
      expect(r.effectiveExpiresAt).toBe('2026-08-31');
      expect(r.indicativeExpiresAt).toBeNull();
      expect(r.absenceStatus).toBe('ABSENT');
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.legalBasis).toBe('L3141-19-2');
    });

    it('expire le lendemain de l’échéance', () => {
      const r = computeCarryoverExpiry({ ...input, today: '2026-09-01' });
      expect(r.status).toBe(CarryoverDelayStatus.EXPIRE);
    });

    it('avant la fin de période : EN_ATTENTE', () => {
      const r = computeCarryoverExpiry({ ...input, today: '2025-04-01' });
      expect(r.status).toBe(CarryoverDelayStatus.EN_ATTENTE);
    });
  });

  describe('4. Arrêt long — reprise avant expiration', () => {
    it('suspend le reliquat et décale l’échéance', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2026-03-01',
        informationDate: '2026-04-01',
        informationDateCertain: true,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-04-01',
      });
      expect(r.deadline).toBe('2026-08-31');
      expect(r.effectiveExpiresAt).toBe('2026-10-01');
      expect(r.absenceStatus).toBe('REPRIS');
      expect(r.suspension).toEqual({
        from: '2026-03-01',
        to: '2026-04-01',
        calendarDays: 31,
        remainingDaysAtReprise: 183,
      });
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.legalBasis).toBe('L3141-19-2');
    });
  });

  describe('5. Arrêt long — reprise après expiration', () => {
    it('aucune prolongation artificielle', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2026-10-01',
        informationDate: '2026-11-01',
        informationDateCertain: true,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-10-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EXPIRE);
      expect(r.effectiveExpiresAt).toBe('2026-08-31');
      expect(r.suspension).toBeNull();
    });
  });

  describe('6. Arrêt long — information reçue tardivement', () => {
    it('ajoute les jours de suspension au reliquat (+92 j)', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2026-03-01',
        informationDate: '2026-06-01',
        informationDateCertain: true,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-06-01',
      });
      expect(r.suspension?.calendarDays).toBe(92);
      expect(r.effectiveExpiresAt).toBe('2026-12-01');
    });
  });

  describe('7. Suspension du délai et calcul du reliquat', () => {
    it('information non datée → SUSPENDU, reliquat connu, échéance non calculée', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2026-03-01',
        informationDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-05-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.SUSPENDU);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.suspension).toEqual({
        from: '2026-03-01',
        to: null,
        calendarDays: null,
        remainingDaysAtReprise: 183,
      });
      expect(r.missingInformation.join(' ')).toContain('lever la suspension');
    });
  });

  describe('8. Fins de mois et années bissextiles (via le moteur)', () => {
    it('régime général : information un 29 février', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2024-02-29',
        informationDateCertain: true,
        today: '2024-02-29',
      });
      expect(r.deadline).toBe('2025-05-29');
      expect(r.effectiveExpiresAt).toBe('2025-05-29');
    });

    it('régime arrêt long : fin de période un 31 mai → 31 août (15 mois)', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        repriseDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      });
      expect(r.deadline).toBe('2026-08-31');
    });
  });

  describe('9. Échéance atteinte exactement', () => {
    it('régime général : le jour même de l’échéance est encore consommable', () => {
      const base = {
        regime: 'GENERAL' as const,
        informationDate: '2025-06-25',
        informationDateCertain: true,
      };
      expect(computeCarryoverExpiry({ ...base, today: '2026-09-25' }).status).toBe(
        CarryoverDelayStatus.EN_COURS,
      );
      expect(computeCarryoverExpiry({ ...base, today: '2026-09-26' }).status).toBe(
        CarryoverDelayStatus.EXPIRE,
      );
    });

    it('arrêt long : idem (jour d’échéance inclus)', () => {
      const base = {
        regime: 'ARRET_LONG' as const,
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT' as const,
        repriseDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
      };
      expect(computeCarryoverExpiry({ ...base, today: '2026-08-31' }).status).toBe(
        CarryoverDelayStatus.EN_COURS,
      );
      expect(computeCarryoverExpiry({ ...base, today: '2026-09-01' }).status).toBe(
        CarryoverDelayStatus.EXPIRE,
      );
    });
  });

  describe('10. Dates incohérentes ou manquantes', () => {
    it('général : information antérieure à la reprise → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        repriseDate: '2025-06-26',
        informationDate: '2025-06-25',
        today: '2025-06-26',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('antérieure');
    });

    it('arrêt long : fin de période absente → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        repriseDate: null,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('période de référence');
    });

    it('arrêt long : condition d’un an non satisfaite → A_VERIFIER, aucune échéance opposable', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        suspensionAtLeastOneYearAtPeriodEnd: false,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('un an');
      expect(r.missingInformation.join(' ')).toContain('5° ou 7°');
    });

    it('arrêt long : reprise antérieure à la fin de période → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2025-04-01',
        informationDate: '2025-04-15',
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2025-04-15',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('reprise antérieure');
    });

    it('date inexistante (2025-02-30) traitée comme invalide, pas comme absente', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-02-30',
        today: '2025-03-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('Date invalide');
    });
  });

  describe('11. Durée de report plus favorable (L3141-21-1)', () => {
    it('régime général : 18 mois appliqués', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        informationDateCertain: true,
        carryoverMonths: 18,
        today: '2025-06-25',
      });
      expect(r.monthsApplied).toBe(18);
      expect(r.deadline).toBe('2026-12-25');
      expect(r.legalBasis).toBe('L3141-19-1 + L3141-21-1');
      expect(r.warnings.join(' ')).toContain('L3141-21-1');
    });

    it('arrêt long : 18 mois appliqués depuis la fin de période', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        repriseDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        carryoverMonths: 18,
        today: '2026-01-01',
      });
      expect(r.deadline).toBe('2026-11-30');
      expect(r.legalBasis).toBe('L3141-19-2 + L3141-21-1');
    });

    it('durée inférieure au socle légal → socle de 15 mois appliqué', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        informationDateCertain: true,
        carryoverMonths: 12,
        today: '2025-06-25',
      });
      expect(r.monthsApplied).toBe(15);
      expect(r.deadline).toBe('2026-09-25');
      expect(r.warnings.join(' ')).toContain('socle légal');
    });
  });

  describe('12. Plusieurs périodes de référence distinctes', () => {
    it('calcule des échéances indépendantes par période', () => {
      const base = {
        regime: 'ARRET_LONG' as const,
        absenceStatus: 'ABSENT' as const,
        repriseDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      };
      const r1 = computeCarryoverExpiry({ ...base, referencePeriodEnd: '2025-05-31' });
      const r2 = computeCarryoverExpiry({ ...base, referencePeriodEnd: '2026-05-31' });
      expect(r1.deadline).toBe('2026-08-31');
      expect(r2.deadline).toBe('2027-08-31');
      expect(r1.deadline).not.toBe(r2.deadline);
    });
  });

  describe('Garde-fou A — preuve d’information (date certaine)', () => {
    it('réception certaine → échéance opposable', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        informationDateCertain: true,
        today: '2025-06-25',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.effectiveExpiresAt).toBe('2026-09-25');
      expect(r.indicativeExpiresAt).toBeNull();
    });

    it('réception non renseignée (null) → indicatif + A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        today: '2025-06-25',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.indicativeExpiresAt).toBe('2026-09-25');
      expect(r.missingInformation.join(' ')).toContain('non renseignée');
    });

    it('réception non confirmée (false) → indicatif + A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-06-25',
        informationDateCertain: false,
        today: '2025-06-25',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.indicativeExpiresAt).toBe('2026-09-25');
      expect(r.missingInformation.join(' ')).toContain('non confirmée');
    });

    it('arrêt long (reprise avant échéance) : réception non certaine → indicatif, non opposable', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        repriseDate: '2026-03-01',
        informationDate: '2026-04-01',
        informationDateCertain: false,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-04-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.indicativeExpiresAt).toBe('2026-10-01');
      expect(r.suspension?.calendarDays).toBe(31);
    });
  });

  describe('Garde-fou B — absence en cours vs date inconnue', () => {
    const cond = {
      regime: 'ARRET_LONG' as const,
      referencePeriodEnd: '2025-05-31',
      acquiredDuringL3141_5_5or7: true,
      suspensionAtLeastOneYearAtPeriodEnd: true,
    };

    it('situation non renseignée + pas de date de reprise → A_VERIFIER (plus « toujours absent »)', () => {
      const r = computeCarryoverExpiry({ ...cond, today: '2026-01-01' });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('reprise inconnue');
    });

    it('ABSENT confirmé → échéance opposable sans date de reprise', () => {
      const r = computeCarryoverExpiry({
        ...cond,
        absenceStatus: 'ABSENT',
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.effectiveExpiresAt).toBe('2026-08-31');
    });

    it('REPRIS sans date de reprise fiable → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        ...cond,
        absenceStatus: 'REPRIS',
        repriseDate: null,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('sans date de reprise');
    });

    it('date de reprise invalide → signalée (non interprétée)', () => {
      const r = computeCarryoverExpiry({
        ...cond,
        absenceStatus: 'REPRIS',
        repriseDate: '2026-03-32',
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('Date invalide (reprise)');
    });

    it('date d’information invalide → signalée', () => {
      const r = computeCarryoverExpiry({
        regime: 'GENERAL',
        informationDate: '2025-13-01',
        informationDateCertain: true,
        today: '2025-06-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('Date invalide (information)');
    });

    it('fin de période de référence invalide → signalée', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-32',
        absenceStatus: 'ABSENT',
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.missingInformation.join(' ')).toContain('Date invalide (fin de période de référence)');
    });
  });

  describe('Garde-fou C — conditions L3141-19-2', () => {
    it('condition « acquis pendant L3141-5 5°/7° » non renseignée → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('5° ou 7°');
    });

    it('condition « suspension ≥ 1 an » non renseignée → A_VERIFIER', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        acquiredDuringL3141_5_5or7: true,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('au moins un an');
    });

    it('deux conditions fausses → A_VERIFIER (pas d’expiration L3141-19-2)', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        acquiredDuringL3141_5_5or7: false,
        suspensionAtLeastOneYearAtPeriodEnd: false,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.missingInformation.join(' ')).toContain('non satisfaite');
    });

    it('deux conditions validées → calcul possible', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-01-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EN_COURS);
      expect(r.effectiveExpiresAt).toBe('2026-08-31');
    });
  });

  describe('Garde-fou D — combinaisons', () => {
    it('ARRET_LONG validé + ABSENT : aucune information requise pour expirer à la base', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'ABSENT',
        repriseDate: null,
        informationDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-09-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.EXPIRE);
      expect(r.effectiveExpiresAt).toBe('2026-08-31');
    });

    it('ARRET_LONG validé + REPRIS + information absente → SUSPENDU (reliquat)', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'REPRIS',
        repriseDate: '2026-03-01',
        informationDate: null,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-05-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.SUSPENDU);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.suspension?.remainingDaysAtReprise).toBe(183);
    });

    it('ARRET_LONG validé + REPRIS + information non certaine → A_VERIFIER (indicatif)', () => {
      const r = computeCarryoverExpiry({
        regime: 'ARRET_LONG',
        referencePeriodEnd: '2025-05-31',
        absenceStatus: 'REPRIS',
        repriseDate: '2026-03-01',
        informationDate: '2026-04-01',
        informationDateCertain: false,
        acquiredDuringL3141_5_5or7: true,
        suspensionAtLeastOneYearAtPeriodEnd: true,
        today: '2026-04-01',
      });
      expect(r.status).toBe(CarryoverDelayStatus.A_VERIFIER);
      expect(r.effectiveExpiresAt).toBeNull();
      expect(r.indicativeExpiresAt).toBe('2026-10-01');
    });
  });
});
