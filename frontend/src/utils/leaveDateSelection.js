export function selectLeaveDate(selection, iso) {
  if (!iso) return selection
  if (!selection?.startDate) {
    return { ...selection, startDate: iso, endDate: iso, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
  }

  if (selection.startDate === selection.endDate) {
    if (iso === selection.startDate) return selection
    if (iso < selection.startDate) {
      return { ...selection, startDate: iso, endDate: selection.startDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
    }
    return { ...selection, endDate: iso, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
  }

  return { ...selection, startDate: iso, endDate: iso, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
}

export function changeLeaveBoundaryPeriod(selection, { boundary, value }) {
  if (!selection?.startDate || !selection?.endDate) return selection
  if (boundary === 'single') {
    return value === 'MATIN'
      ? { ...selection, startPeriod: 'MATIN', endPeriod: 'MATIN' }
      : { ...selection, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' }
  }
  if (boundary === 'start') return { ...selection, startPeriod: value === 'APRES_MIDI' ? 'APRES_MIDI' : 'MATIN' }
  if (boundary === 'end') return { ...selection, endPeriod: value === 'MATIN' ? 'MATIN' : 'APRES_MIDI' }
  return selection
}
