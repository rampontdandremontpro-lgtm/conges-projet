export function toISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO() {
  return toISODate(new Date())
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

export function formatPeriod(referencePeriod) {
  return referencePeriod.replace('-', ' – ')
}
