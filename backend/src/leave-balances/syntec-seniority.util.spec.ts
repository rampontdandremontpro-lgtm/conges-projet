import { fullYearsBetween, syntecSeniorityExtraDays } from './syntec-seniority.util';

describe('JUR-019 / JUR-020 — ancienneté Syntec 5.1 (paliers + date de référence)', () => {
  const REF = '2026-05-01'; // ouverture de la période de prise

  describe('paliers (totaux, non cumulatifs)', () => {
    it('< 5 ans révolus : 0 jour', () => {
      expect(syntecSeniorityExtraDays('2021-05-02', REF)).toBe(0); // 4 ans 364 j
      expect(syntecSeniorityExtraDays('2021-05-01', REF)).toBe(1); // 5 ans révolus exactement
    });

    it('4 ans et 364 jours vs 5 ans révolus (frontière)', () => {
      expect(fullYearsBetween('2021-05-02', REF)).toBe(4); // anniversaire le 2 mai : pas encore révolu au 1er mai
      expect(fullYearsBetween('2021-05-01', REF)).toBe(5); // anniversaire le 1er mai : révolu
    });

    it('5 ans → 1 jour ouvré', () => {
      expect(syntecSeniorityExtraDays('2021-05-01', REF)).toBe(1);
      expect(syntecSeniorityExtraDays('2021-04-30', REF)).toBe(1); // déjà 5 ans révolus
    });

    it('10 ans → 2 jours ouvrés', () => {
      expect(syntecSeniorityExtraDays('2016-05-01', REF)).toBe(2);
      expect(syntecSeniorityExtraDays('2016-05-02', REF)).toBe(1); // 9 ans 364 j
    });

    it('15 ans → 3 jours ouvrés', () => {
      expect(syntecSeniorityExtraDays('2011-05-01', REF)).toBe(3);
      expect(syntecSeniorityExtraDays('2011-05-02', REF)).toBe(2);
    });

    it('20 ans → 4 jours ouvrés', () => {
      expect(syntecSeniorityExtraDays('2006-05-01', REF)).toBe(4);
      expect(syntecSeniorityExtraDays('2006-05-02', REF)).toBe(3);
    });

    it('au-delà de 20 ans : plafonné à 4 jours (pas d’addition)', () => {
      expect(syntecSeniorityExtraDays('2000-01-01', REF)).toBe(4);
      expect(syntecSeniorityExtraDays('1996-05-01', REF)).toBe(4); // 30 ans → toujours 4
    });
  });

  describe('date d’appréciation (1er mai)', () => {
    it('anniversaire d’ancienneté AVANT le 1er mai → palier atteint', () => {
      // Embauche le 30/04/2021 : 5 ans révolus le 30/04/2026, donc atteints au 01/05/2026.
      expect(syntecSeniorityExtraDays('2021-04-30', '2026-05-01')).toBe(1);
    });

    it('anniversaire d’ancienneté APRÈS le 1er mai → palier non atteint pour cette période', () => {
      // Embauche le 02/05/2021 : 5 ans révolus seulement le 02/05/2026, donc pas au 01/05/2026.
      expect(syntecSeniorityExtraDays('2021-05-02', '2026-05-01')).toBe(0);
    });

    it('anniversaire le jour même du 1er mai → révolu', () => {
      expect(syntecSeniorityExtraDays('2021-05-01', '2026-05-01')).toBe(1);
    });

    it('référence différente du 1er mai (paramètre libre)', () => {
      // Une période de prise ouvrant au 1er juin.
      expect(syntecSeniorityExtraDays('2021-05-02', '2026-06-01')).toBe(1);
    });
  });
});
