function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function resolveExportPeriodRange(preset, now = new Date()) {
  const endDate = dateKey(monthEnd(now))

  if (preset === 'month') {
    return {
      startDate: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate,
    }
  }

  if (preset === '3months' || preset === '6months') {
    const monthCount = preset === '3months' ? 3 : 6
    return {
      startDate: dateKey(new Date(now.getFullYear(), now.getMonth() - (monthCount - 1), 1)),
      endDate,
    }
  }

  return null
}
