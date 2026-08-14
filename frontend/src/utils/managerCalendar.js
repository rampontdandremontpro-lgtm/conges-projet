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

export function getCurrentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

export function buildMonthGrid(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const mondayIndex = (firstDay.getDay() + 6) % 7
  const cells = []

  for (let index = 0; index < mondayIndex; index += 1) {
    cells.push(null)
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    cells.push(`${monthKey}-${String(day).padStart(2, '0')}`)
  }

  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 35) cells.push(null)
  return cells
}

export function dateInRange(date, startDate, endDate) {
  return Boolean(date && startDate && endDate && date >= startDate && date <= endDate)
}

export function formatShortDateFR(dateValue) {
  if (!dateValue) return ''
  const [year, month, day] = String(dateValue).split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day))
}

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
