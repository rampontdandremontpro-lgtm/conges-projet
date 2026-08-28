const LEAVE_STATUS = {
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'pending' },
  EN_COURS_TRAITEMENT: { label: 'En cours de traitement', tone: 'pending' },
  VALIDEE: { label: 'Validée · traitement terminé', tone: 'approved' },
  REFUSEE: { label: 'Refusée', tone: 'refused' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled' },
  ANNULATION_EN_ATTENTE_ACCORD: { label: 'Annulation en attente', tone: 'pending' },
  ANNULEE_APRES_VALIDATION: { label: 'Annulée après validation', tone: 'cancelled' },
  EXPIREE_NON_VALIDEE: { label: 'Expirée', tone: 'cancelled' },
}

const ABSENCE_STATUS = {
  BROUILLON: { label: 'Brouillon RH', tone: 'draft' },
  DECLAREE: { label: 'Déclarée', tone: 'pending' },
  JUSTIFICATIF_EN_ATTENTE: { label: 'Justificatif attendu', tone: 'waiting' },
  JUSTIFICATIF_REJETE: { label: 'Justificatif attendu', tone: 'waiting' },
  A_VERIFIER_PAR_RH: { label: 'À vérifier', tone: 'pending' },
  ENREGISTREE: { label: 'Autorisée', tone: 'approved' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled' },
}

function leaveEffectiveStatus(item) {
  return item?.status === 'EN_ATTENTE_VALIDATION' && item?.finalDeciderId
    ? 'EN_COURS_TRAITEMENT'
    : item?.status
}

function durationOfAbsence(item) {
  if (item?.durationHours !== null && item?.durationHours !== undefined) {
    return { duration: Number(item.durationHours), durationUnit: 'h' }
  }
  if (item?.durationDays !== null && item?.durationDays !== undefined) {
    return { duration: Number(item.durationDays), durationUnit: 'j' }
  }
  return { duration: null, durationUnit: '' }
}

export function normalizeRhLeaveAndAbsenceRows({ leaves = [], absences = [] } = {}) {
  const leaveRows = leaves.map((item) => {
    const status = leaveEffectiveStatus(item)
    const meta = LEAVE_STATUS[status] ?? { label: status || '—', tone: 'neutral' }
    return {
      id: item.id,
      key: `CONGE-${item.id}`,
      nature: 'CONGE',
      natureLabel: 'Congé',
      employee: item.employee ?? null,
      service: item.service ?? item.employee?.service ?? null,
      type: item.leaveType ?? null,
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      duration: item.deductedDays === null || item.deductedDays === undefined ? null : Number(item.deductedDays),
      durationUnit: 'j',
      status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      eventDate: item.submittedAt ?? item.createdAt ?? null,
      source: item,
    }
  })

  const absenceRows = absences.map((item) => {
    const meta = ABSENCE_STATUS[item.status] ?? { label: item.status || '—', tone: 'neutral' }
    const duration = durationOfAbsence(item)
    return {
      id: item.id,
      key: `ABSENCE-${item.id}`,
      nature: 'ABSENCE',
      natureLabel: 'Absence',
      employee: item.employee ?? null,
      service: item.service ?? item.employee?.service ?? null,
      type: item.leaveType ?? null,
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      ...duration,
      status: item.status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      eventDate: item.submittedAt ?? item.createdAt ?? null,
      source: item,
    }
  })

  return [...leaveRows, ...absenceRows]
}

export function normalizeRhEventSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}
