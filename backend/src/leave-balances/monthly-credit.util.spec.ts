/**
 * JUR-025/037 — tests unitaires de la classification juridique des absences et
 * du calcul du crédit mensuel (composant pur, aucune écriture).
 */
import { describe, expect, it } from '@jest/globals';

import { LeaveTypeAbsenceKind } from '../leave-types/leave-type.entity';
import {
  classifyAbsenceKind,
  computeMonthCredit,
  roundCredit,
} from './monthly-credit.util';

describe('JUR-025/037 — classification juridique des absences', () => {
  it('AT/MP et événements assimilés comptent comme travail effectif', () => {
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.AT_MP)).toBe(
      'ASSIMILATED',
    );
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.NAISSANCE)).toBe(
      'ASSIMILATED',
    );
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.PATERNITE_ACCUEIL)).toBe(
      'ASSIMILATED',
    );
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.DEUIL_ENFANT)).toBe(
      'ASSIMILATED',
    );
  });

  it('maladie non professionnelle est traitée à part (2 j/mois)', () => {
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.ARRET_MALADIE)).toBe(
      'ILLNESS',
    );
  });

  it('absences non assimilées réduisent la base de travail', () => {
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.ENFANT_MALADE)).toBe(
      'NON_ASSIMILATED',
    );
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.NON_MEDICAL)).toBe(
      'NON_ASSIMILATED',
    );
  });

  it('NON_CLASSIFIE est signalé (jamais présumé assimilé)', () => {
    expect(classifyAbsenceKind(LeaveTypeAbsenceKind.NON_CLASSIFIE)).toBe(
      'UNCLASSIFIED',
    );
  });
});

describe('JUR-025/037 — calcul du crédit mensuel', () => {
  const base = {
    daysPresent: 31,
    daysInMonth: 31,
    daysPerEmployee: 2.5,
    illnessMonthlyRate: 2,
    illnessDays: 0,
    nonAssimilatedDays: 0,
    unclassifiedDays: 0,
  };

  it('mois entièrement travaillé → 2,5 j', () => {
    const result = computeMonthCredit(base);
    expect(result.totalCredit).toBe(2.5);
    expect(result.illnessCredit).toBe(0);
  });

  it('mois entièrement en maladie non professionnelle → 2 j', () => {
    const result = computeMonthCredit({ ...base, illnessDays: 31 });
    expect(result.totalCredit).toBe(2);
    expect(result.illnessCredit).toBe(2);
    expect(result.workedDays).toBe(0);
  });

  it('mois entièrement AT/MP → 2,5 j (assimilé)', () => {
    const result = computeMonthCredit(base); // AT/MP ne réduit pas la base
    expect(result.totalCredit).toBe(2.5);
  });

  it('mois mixte travail + maladie + AT/MP : une seule fraction, un seul arrondi', () => {
    // 11 j travail + 10 j AT/MP (assimilé) + 10 j maladie, sur 31 jours.
    const result = computeMonthCredit({ ...base, illnessDays: 10 });
    // travaillé = 31 - 10 = 21 ; crédit = (2,5*21 + 2*10)/31 = (52,5+20)/31.
    const expected = roundCredit((2.5 * 21 + 2 * 10) / 31);
    expect(result.totalCredit).toBe(expected);
    expect(result.workedDays).toBe(21);
    expect(result.illnessDays).toBe(10);
  });

  it('maladie SANS maintien → 2 j/mois (socle légal)', () => {
    const result = computeMonthCredit({ ...base, illnessDays: 31 });
    expect(result.totalCredit).toBe(2);
    expect(result.illnessCredit).toBe(2);
  });

  it('maladie AVEC maintien (Syntec) : non soustraite → assimilée 2,5 j', () => {
    // La maladie avec maintien n'est PAS passée dans illnessDays : elle reste
    // dans daysPresent, donc assimilée au taux plein.
    const result = computeMonthCredit(base);
    expect(result.totalCredit).toBe(2.5);
    expect(result.illnessCredit).toBe(0);
  });

  it('P2 — février 28 j, 25 travaillés + 3 maladie : un seul arrondi final 2,45', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 28,
      daysInMonth: 28,
      illnessDays: 3,
    });
    // (25 × 2,5 + 3 × 2) / 28 = 2,4464… → arrondi unique 2,45 (pas 2,44).
    expect(result.totalCredit).toBe(2.45);
  });

  it('P2 — février 29 j (bissextile) : arrondi unique', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 29,
      daysInMonth: 29,
      illnessDays: 3,
    });
    expect(result.totalCredit).toBe(roundCredit((2.5 * 26 + 2 * 3) / 29));
  });

  it('P2 — avril 30 j : arrondi unique', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 30,
      daysInMonth: 30,
      illnessDays: 5,
    });
    expect(result.totalCredit).toBe(roundCredit((2.5 * 25 + 2 * 5) / 30));
  });

  it('P2 — les composantes restent en précision interne (non arrondies individuellement)', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 28,
      daysInMonth: 28,
      illnessDays: 3,
    });
    expect(result.workedCredit).toBeCloseTo((2.5 * 25) / 28, 10);
    expect(result.illnessCredit).toBeCloseTo((2 * 3) / 28, 10);
  });

  it('absence non assimilée (enfant malade) réduit le crédit', () => {
    const result = computeMonthCredit({ ...base, nonAssimilatedDays: 31 });
    expect(result.totalCredit).toBe(0);
  });

  it('absence NON_CLASSIFIE réduit prudemment le crédit', () => {
    const result = computeMonthCredit({ ...base, unclassifiedDays: 31 });
    expect(result.totalCredit).toBe(0);
  });

  it('mois de 28 jours (février) : prorata exact', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 28,
      daysInMonth: 28,
      illnessDays: 14,
    });
    // travaillé = 14 ; crédit = (2,5*14 + 2*14)/28.
    expect(result.totalCredit).toBe(roundCredit((2.5 * 14 + 2 * 14) / 28));
  });

  it('aucun double comptage : illness + non-assimilé + non-classifié ne dépassent pas la présence', () => {
    const result = computeMonthCredit({
      ...base,
      daysPresent: 31,
      illnessDays: 20,
      nonAssimilatedDays: 20,
      unclassifiedDays: 20,
    });
    expect(result.workedDays).toBe(0);
    expect(result.totalCredit).toBe(roundCredit((2 * 20) / 31));
  });
});
