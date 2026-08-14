const PERSON_PALETTE = [
  { solid: '#2563eb', soft: '#e8f0ff' },
  { solid: '#7c3aed', soft: '#f1eafe' },
  { solid: '#0f9f8f', soft: '#e5f8f4' },
  { solid: '#ea7a18', soft: '#fff1e4' },
  { solid: '#d9467b', soft: '#fdebf2' },
  { solid: '#0891b2', soft: '#e4f7fb' },
  { solid: '#5b6fda', soft: '#eceffd' },
  { solid: '#4f8a10', soft: '#edf7df' },
]

export function getPersonColor(person) {
  const source = String(person?.id ?? `${person?.prenom ?? ''}${person?.nom ?? ''}`)
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index)
    hash |= 0
  }
  return PERSON_PALETTE[Math.abs(hash) % PERSON_PALETTE.length]
}

function dateFromKey(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getCurrentDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function getCurrentMonthKey() {
  return getCurrentDateKey().slice(0, 7)
}

export function monthKeyFromDate(value) {
  if (!value) return getCurrentMonthKey()
  return String(value).slice(0, 7)
}

export function shiftMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const label = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function buildMonthDays(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return Array.from({ length: lastDay }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`)
}

export function getMonthDayMeta(dateValue) {
  const date = dateFromKey(dateValue)
  const weekdayIndex = (date.getDay() + 6) % 7
  const weekday = ['L', 'M', 'M', 'J', 'V', 'S', 'D'][weekdayIndex]
  return {
    weekday,
    day: date.getDate(),
    isWeekend: weekdayIndex >= 5,
  }
}

export function dateInRange(date, startDate, endDate) {
  return Boolean(date && startDate && endDate && date >= startDate && date <= endDate)
}

export function formatShortDateFR(dateValue) {
  if (!dateValue) return ''
  const date = dateFromKey(dateValue)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
}
