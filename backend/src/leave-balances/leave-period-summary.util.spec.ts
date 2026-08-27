import { BalanceProcessingStatus, LeaveRequestStatus } from '../leave-requests/leave-request.entity';
import { LeaveBalanceCounterType } from './leave-balance.entity';
import { buildLeavePeriodSummaries } from './leave-period-summary.util';

describe('buildLeavePeriodSummaries', () => {
  it('calcule Acquis / Pris / Solde par période de droits, y compris un solde négatif', () => {
    const result = buildLeavePeriodSummaries({
      balances: [
        {
          referencePeriod: '2026-2027',
          counterType: LeaveBalanceCounterType.N,
          acquiredDays: 2.5,
          consumedDays: 4,
        },
      ],
      requests: [],
      periodStartMonthDay: '06-01',
    });

    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2026-2027',
      acquiredDays: 2.5,
      takenDays: 4,
      balanceDays: -1.5,
    }));
  });

  it('additionne les jours pris avant et après la bascule N vers N-1 sans doubler les acquis', () => {
    const result = buildLeavePeriodSummaries({
      balances: [
        {
          referencePeriod: '2025-2026',
          counterType: LeaveBalanceCounterType.N,
          acquiredDays: 30,
          consumedDays: 10,
        },
        {
          referencePeriod: '2026-2027',
          counterType: LeaveBalanceCounterType.N_MINUS_1,
          acquiredDays: 20,
          consumedDays: 4,
        },
      ],
      requests: [],
      periodStartMonthDay: '06-01',
    });

    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2025-2026',
      acquiredDays: 30,
      takenDays: 14,
      balanceDays: 16,
    }));
  });

  it('sépare les demandes validées et en attente selon la période du congé', () => {
    const result = buildLeavePeriodSummaries({
      balances: [],
      requests: [
        {
          startDate: '2027-07-05',
          deductedDays: 12,
          status: LeaveRequestStatus.VALIDEE,
          balanceProcessingStatus: BalanceProcessingStatus.CONGE_PREVISIONNEL,
        },
        {
          startDate: '2027-08-10',
          deductedDays: 3,
          status: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
          balanceProcessingStatus: BalanceProcessingStatus.DEMANDE_ACTUELLE,
        },
      ],
      periodStartMonthDay: '06-01',
    });

    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2027-2028',
      validatedDays: 12,
      pendingDays: 3,
    }));
  });
  it('ne compte pas un congé consolidé à la fois dans Pris et Validées', () => {
    const result = buildLeavePeriodSummaries({
      periodStartMonthDay: '06-01',
      balances: [
        {
          referencePeriod: '2026-2027',
          counterType: 'N',
          acquiredDays: 10,
          consumedDays: 4,
        },
      ],
      requests: [
        {
          startDate: '2026-09-10',
          deductedDays: 4,
          status: 'VALIDEE',
          balanceProcessingStatus: 'DEFINITIF',
        },
      ],
    });

    expect(result).toContainEqual({
      referencePeriod: '2026-2027',
      acquiredDays: 10,
      takenDays: 4,
      balanceDays: 6,
      validatedDays: 0,
      pendingDays: 0,
    });
  });

  it('ventile une demande en attente sur N-1 puis N selon le solde officiel restant', () => {
    const result = buildLeavePeriodSummaries({
      periodStartMonthDay: '06-01',
      balances: [
        { referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 5, consumedDays: 0 },
        { referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 10, consumedDays: 0 },
      ],
      requests: [
        {
          startDate: '2026-11-02',
          deductedDays: 8,
          status: 'EN_ATTENTE_VALIDATION',
          balanceProcessingStatus: 'DEMANDE_ACTUELLE',
        },
      ],
    });

    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2025-2026',
      pendingDays: 5,
    }));
    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2026-2027',
      pendingDays: 3,
    }));
  });

  it('partage le reliquat ancien entre plusieurs engagements dans l’ordre chronologique', () => {
    const result = buildLeavePeriodSummaries({
      periodStartMonthDay: '06-01',
      balances: [
        { referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 5, consumedDays: 0 },
        { referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 2, consumedDays: 0 },
      ],
      requests: [
        { startDate: '2026-09-01', deductedDays: 4, status: 'VALIDEE', balanceProcessingStatus: 'DEMANDE_ACTUELLE' },
        { startDate: '2026-10-01', deductedDays: 4, status: 'EN_ATTENTE_VALIDATION', balanceProcessingStatus: 'DEMANDE_ACTUELLE' },
      ],
    });

    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2025-2026',
      validatedDays: 4,
      pendingDays: 1,
    }));
    expect(result).toContainEqual(expect.objectContaining({
      referencePeriod: '2026-2027',
      validatedDays: 0,
      pendingDays: 3,
      balanceDays: 2,
    }));
  });

});
