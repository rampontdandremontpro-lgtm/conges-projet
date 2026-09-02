export function buildSelectionPeriodBadge({ startDate, endDate, startPeriod, endPeriod } = {}) {
  if (!startDate || !endDate) return ''

  const startLabel = startPeriod === 'APRES_MIDI' ? 'après-midi' : 'matin'
  const endLabel = endPeriod === 'MATIN' ? 'matin' : 'après-midi'

  if (startDate === endDate) {
    if (startPeriod === 'MATIN' && endPeriod === 'APRES_MIDI') return 'journée entière'
    if (startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI') return 'après-midi'
    return 'matin'
  }

  return `${startLabel} → ${endLabel}`
}

export function buildReferencePeriodBadge(isAnticipatedLeave) {
  return isAnticipatedLeave ? 'Période N+1' : 'Période N'
}
