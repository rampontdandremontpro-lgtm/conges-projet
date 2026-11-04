import {
  addMonthsIso,
  applicablePaternityLeaveRule,
  paternityCalendarDays,
  validatePaternityPeriodShape,
} from './paternity-leave.util';

describe('paternity-leave.util', () => {
  it('naissance simple : 25 jours calendaires (4 + 21)', () => {
    const r = applicablePaternityLeaveRule(1);
    expect(r.totalDays).toBe(25);
    expect(r.firstPeriodDays).toBe(4);
    expect(r.secondPeriodDays).toBe(21);
    expect(r.unit).toBe('CALENDAIRES');
  });

  it('naissances multiples : 32 jours calendaires (4 + 28)', () => {
    const r = applicablePaternityLeaveRule(2);
    expect(r.totalDays).toBe(32);
    expect(r.firstPeriodDays).toBe(4);
    expect(r.secondPeriodDays).toBe(28);
  });

  it('nombre d’enfants manquant : anomalie RH (25 ou 32 à déterminer)', () => {
    const r = applicablePaternityLeaveRule();
    expect(r.anomalies.some((a) => /25 ou 32/i.test(a))).toBe(true);
  });

  it('fractionnement de la seconde période : deux périodes max, ≥ 5 jours', () => {
    const r = applicablePaternityLeaveRule(1);
    expect(r.fractionnement).toMatch(/deux périodes au maximum/i);
    expect(r.fractionnement).toMatch(/au moins 5 jours/i);
  });

  it('comptage calendaire : week-end inclus (du vendredi au lundi = 4 jours)', () => {
    expect(paternityCalendarDays('2026-11-06', '2026-11-09')).toBe(4);
  });

  it('comptage calendaire : jour férié inclus (une journée = 1 jour)', () => {
    expect(paternityCalendarDays('2026-11-11', '2026-11-11')).toBe(1);
  });

  it('comptage calendaire : jamais de conversion en jours ouvrés', () => {
    // Du lundi au dimanche : 7 jours calendaires (pas 5 ouvrés).
    expect(paternityCalendarDays('2026-11-02', '2026-11-08')).toBe(7);
  });

  it('forme de la première période : exactement 4 jours calendaires', () => {
    expect(
      validatePaternityPeriodShape({
        periode: 'PREMIERE',
        startDate: '2026-11-02',
        endDate: '2026-11-05',
      }),
    ).toEqual([]);
    expect(
      validatePaternityPeriodShape({
        periode: 'PREMIERE',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
      }).length,
    ).toBeGreaterThan(0);
  });

  it('forme de la seconde période : au moins 5 jours calendaires', () => {
    expect(
      validatePaternityPeriodShape({
        periode: 'SECONDE',
        startDate: '2026-11-02',
        endDate: '2026-11-05',
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePaternityPeriodShape({
        periode: 'SECONDE',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
      }),
    ).toEqual([]);
  });

  it('délai de 6 mois calculé sans débordement de fin de mois', () => {
    expect(addMonthsIso('2026-11-30', 6)).toBe('2027-05-30');
    expect(addMonthsIso('2026-01-31', 6)).toBe('2026-07-31');
  });
});
