function toUtcDate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

function normalizeHolidayDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

export function calculateDeductedDaysPreview(selection, holidays) {
  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  if (!startDate || !endDate || endDate < startDate) {
    return null
  }

  const nonDeductibleDates = new Set(
    (holidays ?? [])
      .filter((holiday) => holiday.deductible === false)
      .map((holiday) => normalizeHolidayDate(holiday.date))
      .filter(Boolean),
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

  if (end.getUTCDay() === 5 && endPeriod === 'APRES_MIDI') {
    const saturday = new Date(end)
    saturday.setUTCDate(saturday.getUTCDate() + 1)
    const saturdayIso = saturday.toISOString().slice(0, 10)
    if (!nonDeductibleDates.has(saturdayIso)) total += 1
  }

  return Math.max(total, 0)
}
