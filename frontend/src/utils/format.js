export function toISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function parseISO(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDateFR(iso) {
  return parseISO(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateShortFR(iso) {
  return parseISO(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })
}

export function formatDateRangeFR(startIso, endIso) {
  const startYear = startIso.slice(0, 4)
  const endYear = endIso.slice(0, 4)
  if (startYear === endYear) {
    return `${formatDateShortFR(startIso)} – ${formatDateFR(endIso)}`
  }
  return `${formatDateFR(startIso)} – ${formatDateFR(endIso)}`
}

export function daysBetween(startIso, endIso) {
  const start = parseISO(startIso).getTime()
  const end = parseISO(endIso).getTime()
  return Math.round((end - start) / 86400000)
}

export function addDaysISO(iso, days) {
  const date = parseISO(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

export function formatDays(value) {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDateNumericFR(iso) {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function formatRangeNumericFR(startIso, endIso) {
  return `${formatDateNumericFR(startIso)} → ${formatDateNumericFR(endIso)}`
}

export function formatRangeCompactFR(startIso, endIso) {
  const start = parseISO(startIso)
  const end = parseISO(endIso)
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    const monthLabel = end.toLocaleDateString('fr-FR', { month: 'long' })
    return `${start.getDate()} – ${end.getDate()} ${monthLabel} ${end.getFullYear()}`
  }
  if (start.getFullYear() === end.getFullYear()) {
    const startMonth = start.toLocaleDateString('fr-FR', { month: 'short' })
    const endMonth = end.toLocaleDateString('fr-FR', { month: 'short' })
    return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`
  }
  return `${formatDateShortFR(startIso)} – ${formatDateFR(endIso)}`
}

export function formatPeriod(referencePeriod) {
  return referencePeriod.replace('-', ' – ')
}
