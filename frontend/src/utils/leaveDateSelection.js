function clearedSelection(selection) {
  return {
    ...selection,
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}

export function selectLeaveDate(selection, iso) {
  if (!iso) return selection

  const startDate = selection?.startDate ?? null
  const endDate = selection?.endDate ?? null

  if (!startDate) {
    return {
      ...selection,
      startDate: iso,
      endDate: iso,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    }
  }

  const rangeStart = endDate && endDate < startDate ? endDate : startDate
  const rangeEnd = endDate && endDate < startDate ? startDate : endDate ?? startDate
  const clickedSelectedDay = iso >= rangeStart && iso <= rangeEnd

  // Un second clic sur n'importe quel jour de la sélection annule la plage
  // complète. Cela évite les plages trouées et rend l'interaction prévisible.
  if (clickedSelectedDay) {
    return clearedSelection(selection)
  }

  if (!endDate || startDate === endDate) {
    if (iso < startDate) {
      return {
        ...selection,
        startDate: iso,
        endDate: startDate,
        startPeriod: 'MATIN',
        // L'ancienne journée devient la borne de retour : on conserve son choix.
        endPeriod: selection.endPeriod ?? 'APRES_MIDI',
      }
    }
    return {
      ...selection,
      endDate: iso,
      // La première journée reste la borne de départ : son choix matin/après-midi est conservé.
      startPeriod: selection.startPeriod ?? 'MATIN',
      endPeriod: 'APRES_MIDI',
    }
  }

  // Une plage terminée suivie d'un clic hors plage démarre une nouvelle
  // sélection sur une seule journée.
  return {
    ...selection,
    startDate: iso,
    endDate: iso,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}

export function changeLeaveBoundaryPeriod(selection, { boundary, value }) {
  if (!selection?.startDate || !selection?.endDate) return selection
  if (boundary === 'single') {
    if (value === 'FULL_DAY') {
      return { ...selection, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
    }
    return value === 'MATIN'
      ? { ...selection, startPeriod: 'MATIN', endPeriod: 'MATIN' }
      : { ...selection, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' }
  }
  if (boundary === 'start') return { ...selection, startPeriod: value === 'APRES_MIDI' ? 'APRES_MIDI' : 'MATIN' }
  if (boundary === 'end') return { ...selection, endPeriod: value === 'MATIN' ? 'MATIN' : 'APRES_MIDI' }
  return selection
}
