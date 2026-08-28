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

export function formatReferencePeriodRange(referencePeriod) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return String(referencePeriod ?? '').trim() || '—'
  return `01/06/${parsed.startYear} - 31/05/${parsed.endYear}`
}

export function formatCounterReferencePeriod(referencePeriod, counterType) {
  return formatReferencePeriodRange(counterReferencePeriod(referencePeriod, counterType))
}

export function formatNamedReferencePeriod(referencePeriod, counterType) {
  return `${counterType} ${formatCounterReferencePeriod(referencePeriod, counterType)}`
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

export function nextReferencePeriod(referencePeriod) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return ''
  return `${parsed.endYear}-${parsed.endYear + 1}`
}

export function isNPlusOneReferencePeriod(referencePeriod, activeReferencePeriod = currentReferencePeriod()) {
  return referencePeriod === nextReferencePeriod(activeReferencePeriod)
}


export function relativeReferencePeriodLabel(referencePeriod, activeReferencePeriod = currentReferencePeriod()) {
  const target = parsedPeriod(referencePeriod)
  const active = parsedPeriod(activeReferencePeriod)
  if (!target || !active) return ''
  const offset = target.startYear - active.startYear
  if (offset === -1) return 'N-1'
  if (offset === 0) return 'N'
  if (offset === 1) return 'N+1'
  return offset > 1 ? `N+${offset}` : `N${offset}`
}

export function formatRelativeReferencePeriod(referencePeriod, activeReferencePeriod = currentReferencePeriod()) {
  const label = relativeReferencePeriodLabel(referencePeriod, activeReferencePeriod)
  const range = formatReferencePeriodRange(referencePeriod)
  return label ? `${label} ${range}` : range
}

export function adjacentReferencePeriodOptions(referencePeriod = currentReferencePeriod()) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return []

  const nMinus1 = `${parsed.startYear - 1}-${parsed.startYear}`
  const n = parsed.value
  const nPlus1 = `${parsed.endYear}-${parsed.endYear + 1}`

  return [
    { value: nMinus1, label: `N-1 ${formatReferencePeriodRange(nMinus1)}` },
    { value: n, label: `N ${formatReferencePeriodRange(n)}` },
    { value: nPlus1, label: `N+1 ${formatReferencePeriodRange(nPlus1)}` },
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
