const REFERENCE_PERIOD_PATTERN = /^(\d{4})-(\d{4})$/

function toIsoDate(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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

export function currentReferencePeriod(date = new Date(), periodStart = '06-01') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const monthDay = `${values.month}-${values.day}`
  const start = monthDay >= periodStart ? year : year - 1
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

export function adjacentReferencePeriodOptions(
  referencePeriod = currentReferencePeriod(),
  { parenthesizedCounter = false } = {},
) {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return []

  const nMinus1 = `${parsed.startYear - 1}-${parsed.startYear}`
  const n = parsed.value
  const nPlus1 = `${parsed.endYear}-${parsed.endYear + 1}`

  const labelFor = (counter, value) =>
    parenthesizedCounter
      ? `(${counter}) ${formatReferencePeriodRange(value)}`
      : `${counter} (${formatReferencePeriodRange(value)})`

  return [
    { value: nMinus1, label: labelFor('N-1', nMinus1) },
    { value: n, label: labelFor('N', n) },
    { value: nPlus1, label: labelFor('N+1', nPlus1) },
  ]
}

export function referencePeriodForIsoDate(isoDate, periodStart = '06-01') {
  const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const monthDay = `${match[2]}-${match[3]}`
  const start = monthDay >= periodStart ? year : year - 1
  return `${start}-${start + 1}`
}

export function referencePeriodStartDate(referencePeriod, periodStart = '06-01') {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return null
  return `${parsed.startYear}-${periodStart}`
}

export function referencePeriodEndDate(referencePeriod, periodStart = '06-01') {
  const parsed = parsedPeriod(referencePeriod)
  if (!parsed) return null
  const [month, day] = periodStart.split('-').map(Number)
  const nextStart = new Date(Date.UTC(parsed.endYear, month - 1, day))
  nextStart.setUTCDate(nextStart.getUTCDate() - 1)
  return toIsoDate(nextStart)
}

/**
 * Dernière date sélectionnable : fin de la période N+1.
 */
export function endOfNPlusOneReferencePeriod(
  activeReferencePeriod = currentReferencePeriod(),
  periodStart = '06-01',
) {
  return referencePeriodEndDate(
    nextReferencePeriod(activeReferencePeriod),
    periodStart,
  )
}

/**
 * Début de la période qui suit la période active. Utilisé comme date de
 * renouvellement de la fenêtre de sélection.
 */
export function startOfNextReferencePeriod(
  activeReferencePeriod = currentReferencePeriod(),
  periodStart = '06-01',
) {
  return referencePeriodStartDate(
    nextReferencePeriod(activeReferencePeriod),
    periodStart,
  )
}

/**
 * Date à laquelle une date bloquée devient sélectionnable.
 *
 * Une date D (période P) devient sélectionnable dès que la période active
 * atteint P−1 : D appartient alors à N+1. Le déblocage correspond donc au
 * début de la période P−1.
 *
 * Ex. au 14/10/2026 : 01/06/2028 (période 2028-2029) → 01/06/2027.
 */
export function unlockDateForIsoDate(isoDate, periodStart = '06-01') {
  const period = referencePeriodForIsoDate(isoDate, periodStart)
  if (!period) return null
  const unlockPeriod = counterReferencePeriod(period, 'N-1')
  return referencePeriodStartDate(unlockPeriod, periodStart)
}
