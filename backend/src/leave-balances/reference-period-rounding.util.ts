export function roundPeriodCloseDays(value: number): number {
  const roundedToHundredth = Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
  if (roundedToHundredth <= 0) return 0;
  return Math.round(roundedToHundredth);
}
