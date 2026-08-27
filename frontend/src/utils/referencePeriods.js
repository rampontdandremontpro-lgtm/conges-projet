const REFERENCE_PERIOD_PATTERN = /^(\d{4})-(\d{4})$/

function parsedPeriod(referencePeriod) {
  const value = String(referencePeriod ?? '').trim()
  const match = REFERENCE_PERIOD_PATTERN.exec(value)
  if (!match) return null

  const startYear = Number(match[1])
  const endYear = Number(match[2])
  if (!Number.isInteger(startYear) || endYear !== startYear + 1) return null

  return { value, startYear, endYear }
}

export function counterReferencePeriod(referencePeriod, counterType) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return String(referencePeriod ?? '').trim()

  const offset = counterType === 'N-1' ? -1 : counterType === 'N+1' ? 1 : 0
  return `${parsed.startYear + offset}-${parsed.endYear + offset}`
}

export function formatCounterReferencePeriod(referencePeriod, counterType) {
  const period = counterReferencePeriod(referencePeriod, counterType)
  return period ? period.replace('-', '/') : '—'
}

export function currentReferencePeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const start = Number(values.month) >= 6 ? year : year - 1
  return `${start}-${start + 1}`
}

export function adjacentReferencePeriodOptions(referencePeriod = currentReferencePeriod()) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return []

  return [
    {
      value: `${parsed.startYear - 1}-${parsed.startYear}`,
      label: `N-1 · ${parsed.startYear - 1}/${parsed.startYear}`,
    },
    {
      value: parsed.value,
      label: `N · ${parsed.startYear}/${parsed.endYear}`,
    },
    {
      value: `${parsed.endYear}-${parsed.endYear + 1}`,
      label: `N+1 · ${parsed.endYear}/${parsed.endYear + 1}`,
    },
  ]
}

export function referencePeriodForIsoDate(isoDate) {
  const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const monthDay = `${match[2]}-${match[3]}`
  const start = monthDay >= '06-01' ? year : year - 1
  return `${start}-${start + 1}`
}
