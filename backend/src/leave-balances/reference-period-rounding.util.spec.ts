import { roundPeriodCloseDays } from './reference-period-rounding.util';

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
