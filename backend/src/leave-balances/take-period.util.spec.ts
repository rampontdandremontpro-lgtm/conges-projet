import {
  takePeriodFor,
  takePeriodStatus,
  type TakePeriod,
  type TakePeriodStatusInfo,
} from './take-period.util';

describe('take-period.util', () => {
  it('calcule la fenêtre de prise (année de fin, 1er mai → 13 mois)', () => {
    const period = takePeriodFor('2025-2026');
    expect(period.start).toBe('2026-05-01');
    expect(period.end).toBe('2027-05-31');
  });

  it('calcule la fenêtre pour 2026-2027', () => {
    const period = takePeriodFor('2026-2027');
    expect(period.start).toBe('2027-05-01');
    expect(period.end).toBe('2028-05-31');
  });

  it('gère une durée configurable', () => {
    const period = takePeriodFor('2025-2026', '05-01', 12);
    expect(period.end).toBe('2027-04-30');
  });

  it('détecte les dates limites (avant / pendant / après)', () => {
    const period: TakePeriod = takePeriodFor('2025-2026');
    expect(takePeriodStatus(period, '2026-04-30', 30).status).toBe('NOT_OPENED');
    expect(takePeriodStatus(period, '2027-01-15', 30).status).toBe('WITHIN_PERIOD');
    expect(takePeriodStatus(period, '2027-05-20', 30).status).toBe('DEADLINE_APPROACHING');
    expect(takePeriodStatus(period, '2027-06-01', 30).status).toBe('DEADLINE_EXCEEDED');
  });

  it('frontière du dernier jour (31 mai) et du lendemain (1er juin)', () => {
    const period: TakePeriod = takePeriodFor('2025-2026');
    expect(takePeriodStatus(period, '2027-05-31', 30).status).toBe('DEADLINE_APPROACHING');
    expect(takePeriodStatus(period, '2027-06-01', 30).status).toBe('DEADLINE_EXCEEDED');
  });

  it('expose le nombre de jours restants', () => {
    const period: TakePeriod = takePeriodFor('2025-2026');
    const info: TakePeriodStatusInfo = takePeriodStatus(period, '2027-05-21', 30);
    expect(info.daysUntilEnd).toBe(10);
  });
});
