function clearedSelection(selection) {
  return {
    ...selection,
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}

function startedSelection(selection, iso) {
  return {
    ...selection,
    startDate: iso,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}

export function selectLeaveDate(selection, iso) {
  if (!iso) return selection

  const startDate = selection?.startDate ?? null
  const endDate = selection?.endDate ?? null

  // 1er clic : on ne finalise pas encore la période. Le calendrier reste en
  // attente du jour de retour et peut déjà demander "Je pars quand ?".
  if (!startDate) {
    return startedSelection(selection, iso)
  }

  // Une plage déjà finalisée : recliquer sur n'importe quel jour bleu annule
  // toute la sélection. Un clic hors plage démarre une nouvelle sélection.
  if (endDate) {
    const rangeStart = endDate < startDate ? endDate : startDate
    const rangeEnd = endDate < startDate ? startDate : endDate
    const clickedSelectedDay = iso >= rangeStart && iso <= rangeEnd

    if (clickedSelectedDay) {
      return clearedSelection(selection)
    }

    return startedSelection(selection, iso)
  }

  // On a seulement le jour de départ.
  // 2e clic sur le même jour => journée unique, qui pourra ensuite être
  // précisée en journée entière / matin / après-midi.
  if (iso === startDate) {
    return {
      ...selection,
      endDate: startDate,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    }
  }

  // Un retour ne peut pas être placé avant le départ. Dans ce cas, on repart
  // proprement de la date cliquée comme nouveau jour de départ.
  if (iso < startDate) {
    return startedSelection(selection, iso)
  }

  // 2e clic sur un autre jour postérieur => plage finalisée. Le choix du
  // départ déjà effectué est conservé ; le retour démarre sur après-midi.
  return {
    ...selection,
    endDate: iso,
    startPeriod: selection.startPeriod ?? 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}

export function changeLeaveBoundaryPeriod(selection, { boundary, value }) {
  if (!selection?.startDate) return selection

  if (boundary === 'start') {
    return {
      ...selection,
      startPeriod: value === 'APRES_MIDI' ? 'APRES_MIDI' : 'MATIN',
    }
  }

  if (!selection.endDate) return selection

  if (boundary === 'single') {
    if (value === 'FULL_DAY') {
      return { ...selection, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
    }
    return value === 'MATIN'
      ? { ...selection, startPeriod: 'MATIN', endPeriod: 'MATIN' }
      : { ...selection, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' }
  }

  if (boundary === 'end') {
    return {
      ...selection,
      endPeriod: value === 'MATIN' ? 'MATIN' : 'APRES_MIDI',
    }
  }

  return selection
}
