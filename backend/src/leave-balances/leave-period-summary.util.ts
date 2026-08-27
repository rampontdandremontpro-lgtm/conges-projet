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

  for (const request of input.requests) {
    if (!request.startDate) continue;
    const period = periodForDate(request.startDate, input.periodStartMonthDay);
    const summary = ensure(period);
    const days = Number(request.deductedDays || 0);
    if (
      request.status === 'VALIDEE' &&
      request.balanceProcessingStatus !== 'DEFINITIF'
    ) {
      summary.validatedDays = round(summary.validatedDays + days);
    } else if (request.status === 'EN_ATTENTE_VALIDATION') {
      summary.pendingDays = round(summary.pendingDays + days);
    }
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
