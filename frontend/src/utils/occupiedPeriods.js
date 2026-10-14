// Occupation du calendrier collaborateur : construction et requête de
// chevauchement à granularité MATIN / APRES_MIDI.

export const LEAVE_RELEASED_STATUSES = [
  'REFUSEE',
  'ANNULEE',
  'ANNULEE_APRES_VALIDATION',
  'EXPIREE_NON_VALIDEE',
]

export const ABSENCE_RELEASED_STATUSES = ['ANNULEE']

export function leaveStatusTone(status) {
  if (status === 'BROUILLON') return 'draft'
  if (status === 'VALIDEE') return 'validated'
  return 'pending'
}

export function absenceStatusTone(status) {
  if (status === 'ENREGISTREE') return 'absence-validated'
  return 'absence-pending'
}

function periodFromLeave(request) {
  return {
    key: `leave-${request.id}`,
    kind: 'LEAVE',
    status: request.status,
    tone: leaveStatusTone(request.status),
    startDate: request.startDate,
    endDate: request.endDate,
    startPeriod: request.startPeriod ?? 'MATIN',
    endPeriod: request.endPeriod ?? 'APRES_MIDI',
    label: `Demande n°${request.id}`,
  }
}

function periodFromAbsence(declaration) {
  return {
    key: `absence-${declaration.id}`,
    kind: 'ABSENCE',
    status: declaration.status,
    tone: absenceStatusTone(declaration.status),
    startDate: declaration.startDate,
    endDate: declaration.endDate,
    startPeriod: declaration.startPeriod,
    endPeriod: declaration.endPeriod,
    label: `Absence n°${declaration.id}`,
  }
}

export function buildOccupiedPeriods({
  leaveRequests = [],
  absenceDeclarations = [],
  excludeLeaveRequestId = null,
} = {}) {
  const periods = []

  for (const request of leaveRequests) {
    if (LEAVE_RELEASED_STATUSES.includes(request.status)) continue
    if (Number(request.id) === Number(excludeLeaveRequestId)) continue
    periods.push(periodFromLeave(request))
  }

  for (const declaration of absenceDeclarations) {
    if (ABSENCE_RELEASED_STATUSES.includes(declaration.status)) continue
    periods.push(periodFromAbsence(declaration))
  }

  return periods
}

/**
 * True si `period` occupe `date` sur le créneau `slot` ('MATIN' | 'APRES_MIDI').
 * Miroir exact de `occupiesSlot` backend.
 */
export function periodOccupiesSlot(period, date, slot) {
  if (date < period.startDate || date > period.endDate) return false

  const startPeriod = period.startPeriod ?? 'MATIN'
  const endPeriod = period.endPeriod ?? 'APRES_MIDI'

  if (period.startDate === period.endDate) {
    if (
      startPeriod === 'APRES_MIDI' &&
      endPeriod === 'MATIN'
    ) {
      return false
    }
    if (
      startPeriod === 'APRES_MIDI' &&
      endPeriod === 'APRES_MIDI'
    ) {
      return slot === 'APRES_MIDI'
    }
    if (
      startPeriod === 'MATIN' &&
      endPeriod === 'MATIN'
    ) {
      return slot === 'MATIN'
    }
    return true
  }

  if (date === period.startDate) {
    return startPeriod === 'MATIN' || slot === 'APRES_MIDI'
  }

  if (date === period.endDate) {
    return endPeriod === 'APRES_MIDI' || slot === 'MATIN'
  }

  return true
}

/**
 * État d'occupation d'une date : créneaux MATIN / APRES_MIDI.
 * `am` / `pm` contiennent la première période occupante (ou null).
 */
export function occupancyForDate(periods, date) {
  const result = { am: null, pm: null }
  for (const period of periods) {
    if (!result.am && periodOccupiesSlot(period, date, 'MATIN')) {
      result.am = period
    }
    if (!result.pm && periodOccupiesSlot(period, date, 'APRES_MIDI')) {
      result.pm = period
    }
    if (result.am && result.pm) break
  }
  return result
}

/**
 * Premier conflit entre une sélection candidate et les périodes occupées.
 * Retourne { date, slot, period } ou null.
 */
export function findSelectionConflict({
  startDate,
  endDate,
  startPeriod,
  endPeriod,
  periods,
}) {
  if (!startDate || !endDate || !periods?.length) return null

  const candidate = {
    startDate,
    endDate,
    startPeriod: startPeriod ?? 'MATIN',
    endPeriod: endPeriod ?? 'APRES_MIDI',
  }

  const start = startDate < endDate ? startDate : endDate
  const stop = startDate > endDate ? startDate : endDate

  for (let date = start; date <= stop; date = addIsoDays(date, 1)) {
    for (const slot of ['MATIN', 'APRES_MIDI']) {
      if (!periodOccupiesSlot(candidate, date, slot)) continue
      const occupying = periods.find((period) =>
        periodOccupiesSlot(period, date, slot),
      )
      if (occupying) {
        return { date, slot, period: occupying }
      }
    }
  }

  return null
}

export function addIsoDays(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function occupancyLabel(period) {
  if (!period) return ''

  if (period.kind === 'ABSENCE') {
    return period.tone === 'absence-validated'
      ? 'Absence : validée'
      : 'Absence : en attente'
  }

  if (period.status === 'BROUILLON') return 'Demande de congé : brouillon'
  if (period.status === 'VALIDEE') return 'Demande de congé : validée'
  return 'Demande de congé : en attente'
}

export function formatConflictMessage(conflict) {
  if (!conflict) return ''
  const slot = conflict.slot === 'MATIN' ? 'Le matin' : 'L’après-midi'
  const date = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${conflict.date}T00:00:00.000Z`))

  const kind =
    conflict.period.kind === 'ABSENCE'
      ? conflict.period.tone === 'absence-validated'
        ? 'une absence validée'
        : 'une absence en attente'
      : conflict.period.tone === 'validated'
        ? 'une demande validée'
        : conflict.period.tone === 'draft'
          ? 'un brouillon de demande'
          : 'une demande en attente'

  return `${slot} du ${date} est déjà couvert par ${kind}.`
}
