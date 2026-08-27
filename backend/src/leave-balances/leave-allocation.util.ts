export interface AllocationBalanceInput {
  id: number;
  referencePeriod: string;
  availableDays: number;
}

export interface PaidLeaveAllocation {
  leaveBalanceId: number;
  referencePeriod: string;
  days: number;
}

export interface PaidLeaveAllocationResult {
  allocations: PaidLeaveAllocation[];
  nBalanceAfter: number;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function allocatePaidLeave(
  requestedDays: number,
  nMinus1Balances: AllocationBalanceInput[],
  nBalance: AllocationBalanceInput,
): PaidLeaveAllocationResult {
  const days = round(requestedDays);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('Le nombre de jours à imputer doit être strictement positif.');
  }

  let remaining = days;
  const allocations: PaidLeaveAllocation[] = [];
  const sortedPrevious = [...nMinus1Balances].sort((a, b) =>
    a.referencePeriod.localeCompare(b.referencePeriod),
  );

  for (const balance of sortedPrevious) {
    if (remaining <= 0) break;
    const usable = Math.max(0, round(balance.availableDays));
    if (usable <= 0) continue;
    const used = round(Math.min(usable, remaining));
    allocations.push({
      leaveBalanceId: balance.id,
      referencePeriod: balance.referencePeriod,
      days: used,
    });
    remaining = round(remaining - used);
  }

  if (remaining > 0) {
    allocations.push({
      leaveBalanceId: nBalance.id,
      referencePeriod: nBalance.referencePeriod,
      days: remaining,
    });
  }

  return {
    allocations,
    nBalanceAfter: round(nBalance.availableDays - remaining),
  };
}
