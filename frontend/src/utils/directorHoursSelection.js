const EMPTY_PERIOD = {
  startDate: null,
  endDate: null,
  startPeriod: 'MATIN',
  endPeriod: 'APRES_MIDI',
}

export function selectDirectorHoursDate(selection, iso) {
  if (!iso) return selection

  const current = selection ?? EMPTY_PERIOD
  const alreadySelected = current.startDate === iso && current.endDate === iso

  if (alreadySelected) {
    return {
      ...current,
      ...EMPTY_PERIOD,
    }
  }

  return {
    ...current,
    startDate: iso,
    endDate: iso,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  }
}
