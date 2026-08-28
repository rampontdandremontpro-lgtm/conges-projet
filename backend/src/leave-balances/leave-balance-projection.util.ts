export interface ProjectionCommitment {
  startDate: string;
  days: number;
}

export interface LeaveBalanceProjectionInput {
  today: string;
  targetDate: string;
  periodStartMonthDay: string;
  monthlyRate: number;
  currentFrame: string;
  nMinus1Days: number;
  nDays: number;
  commitments: ProjectionCommitment[];
  requestedDays: number;
  futureNByPeriod?: Record<string, number>;
}

export interface LeaveBalanceProjectionResult {
  targetFrame: string;
  nMinus1Period: string;
  nPeriod: string;
  nMinus1Before: number;
  nBefore: number;
  nMinus1Used: number;
  nUsed: number;
  nMinus1BalanceAfter: number;
  nBalanceAfter: number;
  projectedBalanceAfter: number;
  negativeBalanceDays: number;
  /** @deprecated Compatibilité API : utiliser negativeBalanceDays. */
  anticipatedDays: number;
}

function round(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isMonthEnd(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCMonth() !== d.getUTCMonth();
}

function frameForDate(date: string, startMonthDay: string): string {
  const year = Number(date.slice(0, 4));
  return date >= `${year}-${startMonthDay}` ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function previousFrame(frame: string): string {
  const year = Number(frame.slice(0, 4));
  return `${year - 1}-${year}`;
}

function nextFrame(frame: string): string {
  const year = Number(frame.slice(0, 4)) + 1;
  return `${year}-${year + 1}`;
}

function allocate(days: number, nMinus1: number, n: number) {
  const oldUsed = round(Math.min(Math.max(0, nMinus1), Math.max(0, days)));
  const nUsed = round(Math.max(0, days - oldUsed));
  return {
    nMinus1Used: oldUsed,
    nUsed,
    nMinus1After: round(nMinus1 - oldUsed),
    nAfter: round(n - nUsed),
  };
}

export function projectLeaveAtDate(input: LeaveBalanceProjectionInput): LeaveBalanceProjectionResult {
  if (input.targetDate < input.today) {
    throw new Error('La projection ne peut pas cibler une date passée.');
  }
  let frame = input.currentFrame;
  let oldDays = round(input.nMinus1Days);
  let nDays = round(input.nDays);
  const commitmentsByDate = new Map<string, number>();
  for (const commitment of input.commitments) {
    if (commitment.startDate < input.today || commitment.startDate >= input.targetDate) continue;
    commitmentsByDate.set(
      commitment.startDate,
      round((commitmentsByDate.get(commitment.startDate) ?? 0) + Number(commitment.days || 0)),
    );
  }

  let cursor = input.today;
  while (cursor < input.targetDate) {
    if (cursor !== input.today && cursor.endsWith(`-${input.periodStartMonthDay}`)) {
      const next = nextFrame(frame);
      oldDays = round(nDays);
      nDays = round(input.futureNByPeriod?.[next] ?? 0);
      frame = next;
    }

    const committed = commitmentsByDate.get(cursor) ?? 0;
    if (committed > 0) {
      const applied = allocate(committed, oldDays, nDays);
      oldDays = applied.nMinus1After;
      nDays = applied.nAfter;
    }

    if (isMonthEnd(cursor)) {
      nDays = round(nDays + input.monthlyRate);
    }
    cursor = addDay(cursor);
  }

  const targetFrame = frameForDate(input.targetDate, input.periodStartMonthDay);
  if (frame !== targetFrame) {
    // Cas limite : le curseur cible exactement le premier jour d'une nouvelle période.
    oldDays = round(nDays);
    nDays = round(input.futureNByPeriod?.[targetFrame] ?? 0);
    frame = targetFrame;
  }

  const beforeOld = oldDays;
  const beforeN = nDays;
  const applied = allocate(input.requestedDays, oldDays, nDays);
  return {
    targetFrame,
    nMinus1Period: previousFrame(targetFrame),
    nPeriod: targetFrame,
    nMinus1Before: round(beforeOld),
    nBefore: round(beforeN),
    nMinus1Used: applied.nMinus1Used,
    nUsed: applied.nUsed,
    nMinus1BalanceAfter: applied.nMinus1After,
    nBalanceAfter: applied.nAfter,
    projectedBalanceAfter: round(applied.nMinus1After + applied.nAfter),
    negativeBalanceDays: round(Math.max(0, -applied.nAfter)),
    anticipatedDays: round(Math.max(0, -applied.nAfter)),
  };
}
