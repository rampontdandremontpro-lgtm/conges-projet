import { projectLeaveAtDate } from './leave-balance-projection.util';

describe('projectLeaveAtDate', () => {
  it('projette un congé futur sans écrire de solde et répartit N-1 puis N', () => {
    const result = projectLeaveAtDate({
      today: '2026-08-27',
      targetDate: '2027-07-05',
      periodStartMonthDay: '06-01',
      monthlyRate: 2.5,
      currentFrame: '2026-2027',
      nMinus1Days: 0,
      nDays: 0,
      commitments: [
        { startDate: '2027-04-10', days: 20 },
      ],
      requestedDays: 12,
    });

    expect(result.targetFrame).toBe('2027-2028');
    expect(result.nMinus1Used).toBeGreaterThanOrEqual(0);
    expect(result.nUsed).toBeGreaterThanOrEqual(0);
    expect(result.nMinus1Used + result.nUsed).toBe(12);
  });

  it('ne fait pas disparaître silencieusement un N négatif au changement de période', () => {
    const result = projectLeaveAtDate({
      today: '2026-08-27',
      targetDate: '2027-07-05',
      periodStartMonthDay: '06-01',
      monthlyRate: 2.5,
      currentFrame: '2026-2027',
      nMinus1Days: 0,
      nDays: -30,
      commitments: [],
      requestedDays: 12,
    });

    // Dix acquisitions de 2,5 j ramènent N de -30 à -5 avant la clôture.
    // Cette dette reste visible comme N-1 ; elle n'est pas considérée utilisable.
    expect(result.nMinus1Before).toBe(-5);
    expect(result.nMinus1Used).toBe(0);
    expect(result.nBefore).toBe(2.5);
    expect(result.nBalanceAfter).toBe(-9.5);
    expect(result.anticipatedDays).toBe(9.5);
  });
});
