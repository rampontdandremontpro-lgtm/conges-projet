import { requestValidationStageMeta } from './requestValidationStage.js'

const LEAVE_STATUS = {
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'pending' },
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

const LEAVE_STATUS_OPTIONS = [
  ['WAITING_MANAGER', 'Attente responsable'],
  ['READY', 'À valider'],
  ['PENDING', 'En attente'],
  ['VALIDEE', 'Validée · traitement terminé'],
  ['REFUSEE', 'Refusée'],
  ['ANNULATION_EN_ATTENTE_ACCORD', 'Annulation en attente'],
  ['ANNULEE', 'Annulée'],
  ['ANNULEE_APRES_VALIDATION', 'Annulée après validation'],
  ['EXPIREE_NON_VALIDEE', 'Expirée'],
]

const ABSENCE_STATUS_OPTIONS = [
  ['BROUILLON', 'Brouillon RH'],
  ['DECLAREE', 'Déclarée'],
  ['JUSTIFICATIF_EN_ATTENTE', 'Justificatif attendu'],
  ['JUSTIFICATIF_REJETE', 'Justificatif attendu'],
  ['A_VERIFIER_PAR_RH', 'À vérifier'],
  ['ENREGISTREE', 'Autorisée'],
  ['ANNULEE', 'Annulée'],
]

export function getRhEventStatusOptions(nature = 'ALL') {
  if (nature === 'CONGE') return LEAVE_STATUS_OPTIONS.map((option) => [...option])
  if (nature === 'ABSENCE') return ABSENCE_STATUS_OPTIONS.map((option) => [...option])

  const values = new Map()
  for (const option of [...LEAVE_STATUS_OPTIONS, ...ABSENCE_STATUS_OPTIONS]) {
    if (!values.has(option[0])) values.set(option[0], option[1])
  }
  return [...values.entries()]
}

function leaveEffectiveStatus(item) {
  const stage = requestValidationStageMeta(item)
  return stage?.key ?? item?.status
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
    const stage = requestValidationStageMeta(item)
    const meta = stage ?? LEAVE_STATUS[status] ?? { label: status || '—', tone: 'neutral' }
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
