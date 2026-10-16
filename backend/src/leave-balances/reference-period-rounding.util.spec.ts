import { roundAcquiredDaysUp, roundPeriodCloseDays } from './reference-period-rounding.util';

describe('roundPeriodCloseDays', () => {
  it.each([
    [14.33, 14],
    [14.49, 14],
    [14.5, 15],
    [14.99, 15],
    [0.49, 0],
    [0.5, 1],
    [0, 0],
  ])('arrondit %s à %s avec bascule à 0,50', (value, expected) => {
    expect(roundPeriodCloseDays(value)).toBe(expected);
  });
});

describe('roundAcquiredDaysUp — L3141-7 (droit acquis à l’entier supérieur)', () => {
  it.each([
    [26.29, 27],
    [14.33, 15],
    [14.5, 15],
    [14.99, 15],
    [27, 27],
    [30, 30],
    [0.49, 1],
    [0.01, 1],
    [0, 0],
    [-3, 0],
    [29.01, 30],
    [30.99, 30],
    [31, 30],
  ])('porte %s à %s jours ouvrables (plafond 30)', (value, expected) => {
    expect(roundAcquiredDaysUp(value)).toBe(expected);
  });

  it('n’arrondit jamais un entier déjà atteint (idempotence)', () => {
    expect(roundAcquiredDaysUp(roundAcquiredDaysUp(26.29))).toBe(27);
    expect(roundAcquiredDaysUp(27)).toBe(27);
  });
});
