import { allocatePaidLeave } from './leave-allocation.util';

describe('allocatePaidLeave', () => {
  it('consomme N-1 jusqu’à zéro puis N', () => {
    expect(
      allocatePaidLeave(
        5,
        [{ id: 1, referencePeriod: '2025-2026', availableDays: 2 }],
        { id: 2, referencePeriod: '2026-2027', availableDays: 7.5 },
      ),
    ).toEqual({
      allocations: [
        { leaveBalanceId: 1, referencePeriod: '2025-2026', days: 2 },
        { leaveBalanceId: 2, referencePeriod: '2026-2027', days: 3 },
      ],
      nBalanceAfter: 4.5,
    });
  });

  it('autorise N à devenir négatif', () => {
    expect(
      allocatePaidLeave(
        5,
        [{ id: 1, referencePeriod: '2025-2026', availableDays: 2 }],
        { id: 2, referencePeriod: '2026-2027', availableDays: 1 },
      ),
    ).toEqual({
      allocations: [
        { leaveBalanceId: 1, referencePeriod: '2025-2026', days: 2 },
        { leaveBalanceId: 2, referencePeriod: '2026-2027', days: 3 },
      ],
      nBalanceAfter: -2,
    });
  });

  it('ignore les anciens compteurs déjà négatifs', () => {
    expect(
      allocatePaidLeave(
        3,
        [
          { id: 1, referencePeriod: '2024-2025', availableDays: -1 },
          { id: 2, referencePeriod: '2025-2026', availableDays: 1.5 },
        ],
        { id: 3, referencePeriod: '2026-2027', availableDays: 0 },
      ),
    ).toEqual({
      allocations: [
        { leaveBalanceId: 2, referencePeriod: '2025-2026', days: 1.5 },
        { leaveBalanceId: 3, referencePeriod: '2026-2027', days: 1.5 },
      ],
      nBalanceAfter: -1.5,
    });
  });
});
