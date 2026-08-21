export function getValidatorTakeoverAt(
  submittedAt: Date,
  takeoverDelayDays: number,
): Date {
  return new Date(
    submittedAt.getTime() + takeoverDelayDays * 24 * 60 * 60 * 1000,
  );
}

export function isValidatorTakeoverDelayExpired(
  submittedAt: Date,
  takeoverDelayDays: number,
  now: Date,
): boolean {
  return now.getTime() >= getValidatorTakeoverAt(submittedAt, takeoverDelayDays).getTime();
}
