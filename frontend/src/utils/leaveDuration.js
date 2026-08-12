function toUtcDate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

export function calculateDeductedDaysPreview(selection, holidays) {
  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  if (!startDate || !endDate || endDate < startDate) {
    return null
  }

  const nonDeductibleDates = new Set(
    (holidays ?? [])
      .filter((holiday) => holiday.deductible === false)
      .map((holiday) => holiday.date),
  )

  const start = toUtcDate(startDate)
  const end = toUtcDate(endDate)
  const current = new Date(start)
  let total = 0

  while (current.getTime() <= end.getTime()) {
    const iso = current.toISOString().slice(0, 10)
    if (current.getUTCDay() !== 0 && !nonDeductibleDates.has(iso)) {
      let value = 1
      if (current.getTime() === start.getTime() && startPeriod === 'APRES_MIDI') {
        value -= 0.5
      }
      if (current.getTime() === end.getTime() && endPeriod === 'MATIN') {
        value -= 0.5
      }
      total += value
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return Math.max(total, 0)
}
