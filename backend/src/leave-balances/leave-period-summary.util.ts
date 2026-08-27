export interface LeavePeriodBalanceInput {
  referencePeriod: string;
  counterType: 'N-1' | 'N' | 'N+1';
  acquiredDays: number;
  consumedDays: number;
}

export interface LeavePeriodRequestInput {
  startDate: string;
  deductedDays: number;
  status: string;
  balanceProcessingStatus?: string | null;
}

export interface LeavePeriodSummary {
  referencePeriod: string;
  acquiredDays: number;
  takenDays: number;
  balanceDays: number;
  validatedDays: number;
  pendingDays: number;
}

const PERIOD_PATTERN = /^(\d{4})-(\d{4})$/;

function actualRightsPeriod(frame: string, counterType: LeavePeriodBalanceInput['counterType']): string {
  const match = PERIOD_PATTERN.exec(frame);
  if (!match) return frame;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const offset = counterType === 'N-1' ? -1 : counterType === 'N+1' ? 1 : 0;
  return `${start + offset}-${end + offset}`;
}

function periodForDate(date: string, startMonthDay: string): string {
  const year = Number(String(date).slice(0, 4));
  const boundary = `${year}-${startMonthDay}`;
  return date >= boundary ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function round(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function buildLeavePeriodSummaries(input: {
  balances: LeavePeriodBalanceInput[];
  requests: LeavePeriodRequestInput[];
  periodStartMonthDay: string;
}): LeavePeriodSummary[] {
  const map = new Map<string, LeavePeriodSummary & { canonicalAcquired: number | null; fallbackAcquired: number }>();

  const ensure = (referencePeriod: string) => {
    let current = map.get(referencePeriod);
    if (!current) {
      current = {
        referencePeriod,
        acquiredDays: 0,
        takenDays: 0,
        balanceDays: 0,
        validatedDays: 0,
        pendingDays: 0,
        canonicalAcquired: null,
        fallbackAcquired: 0,
      };
      map.set(referencePeriod, current);
    }
    return current;
  };

  for (const balance of input.balances) {
    const rightsPeriod = actualRightsPeriod(balance.referencePeriod, balance.counterType);
    const summary = ensure(rightsPeriod);
    summary.takenDays = round(summary.takenDays + Number(balance.consumedDays || 0));
    summary.fallbackAcquired = Math.max(summary.fallbackAcquired, Number(balance.acquiredDays || 0));
    if (balance.counterType === 'N' && balance.referencePeriod === rightsPeriod) {
      summary.canonicalAcquired = Number(balance.acquiredDays || 0);
    }
  }

  const officialBalanceByPeriod = new Map<string, number>();
  for (const [referencePeriod, summary] of map.entries()) {
    const acquiredDays = round(summary.canonicalAcquired ?? summary.fallbackAcquired);
    officialBalanceByPeriod.set(
      referencePeriod,
      round(acquiredDays - Number(summary.takenDays || 0)),
    );
  }

  const committedByPeriod = new Map<string, number>();
  const previousPeriod = (referencePeriod: string): string => {
    const match = PERIOD_PATTERN.exec(referencePeriod);
    if (!match) return referencePeriod;
    const start = Number(match[1]);
    return `${start - 1}-${start}`;
  };

  const requests = [...input.requests]
    .filter((request) => Boolean(request.startDate))
    .sort((first, second) => {
      const byDate = first.startDate.localeCompare(second.startDate);
      if (byDate !== 0) return byDate;
      const firstPriority = first.status === 'VALIDEE' ? 0 : 1;
      const secondPriority = second.status === 'VALIDEE' ? 0 : 1;
      return firstPriority - secondPriority;
    });

  for (const request of requests) {
    if (
      request.status !== 'EN_ATTENTE_VALIDATION' &&
      !(request.status === 'VALIDEE' && request.balanceProcessingStatus !== 'DEFINITIF')
    ) {
      continue;
    }

    const targetPeriod = periodForDate(request.startDate, input.periodStartMonthDay);
    const oldPeriod = previousPeriod(targetPeriod);
    const oldSummary = ensure(oldPeriod);
    const targetSummary = ensure(targetPeriod);
    const days = round(Math.max(0, Number(request.deductedDays || 0)));
    if (days <= 0) continue;

    const oldOfficialBalance = officialBalanceByPeriod.get(oldPeriod) ?? 0;
    const oldAlreadyCommitted = committedByPeriod.get(oldPeriod) ?? 0;
    const oldCapacity = round(Math.max(0, oldOfficialBalance - oldAlreadyCommitted));
    const oldUsed = round(Math.min(days, oldCapacity));
    const targetUsed = round(days - oldUsed);

    if (oldUsed > 0) {
      committedByPeriod.set(oldPeriod, round(oldAlreadyCommitted + oldUsed));
    }
    if (targetUsed > 0) {
      committedByPeriod.set(
        targetPeriod,
        round((committedByPeriod.get(targetPeriod) ?? 0) + targetUsed),
      );
    }

    const field = request.status === 'VALIDEE' ? 'validatedDays' : 'pendingDays';
    oldSummary[field] = round(oldSummary[field] + oldUsed);
    targetSummary[field] = round(targetSummary[field] + targetUsed);
  }

  return [...map.values()]
    .map(({ canonicalAcquired, fallbackAcquired, ...summary }) => {
      const acquiredDays = round(canonicalAcquired ?? fallbackAcquired);
      const takenDays = round(summary.takenDays);
      return {
        ...summary,
        acquiredDays,
        takenDays,
        balanceDays: round(acquiredDays - takenDays),
        validatedDays: round(summary.validatedDays),
        pendingDays: round(summary.pendingDays),
      };
    })
    .sort((a, b) => b.referencePeriod.localeCompare(a.referencePeriod));
}
