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
  ['READY', 'À valider'],
  ['WAITING_MANAGER', 'Attente responsable'],
  ['PENDING', 'En attente'],
  ['ANNULATION_EN_ATTENTE_ACCORD', 'Annulation en attente'],
  ['VALIDEE', 'Validée · traitement terminé'],
  ['REFUSEE', 'Refusée'],
  ['ANNULEE', 'Annulée'],
  ['ANNULEE_APRES_VALIDATION', 'Annulée après validation'],
  ['EXPIREE_NON_VALIDEE', 'Expirée'],
]

const ABSENCE_STATUS_OPTIONS = [
  ['A_VERIFIER_PAR_RH', 'À vérifier'],
  ['JUSTIFICATIF_ATTENDU', 'Justificatif attendu'],
  ['DECLAREE', 'Déclarée'],
  ['ENREGISTREE', 'Autorisée'],
  ['ANNULEE', 'Annulée'],
]

const ALL_STATUS_OPTIONS = [
  ['READY', 'À valider'],
  ['WAITING_MANAGER', 'Attente responsable'],
  ['PENDING', 'En attente'],
  ['ANNULATION_EN_ATTENTE_ACCORD', 'Annulation en attente'],
  ['A_VERIFIER_PAR_RH', 'À vérifier'],
  ['JUSTIFICATIF_ATTENDU', 'Justificatif attendu'],
  ['DECLAREE', 'Déclarée'],
  ['VALIDEE', 'Validée · traitement terminé'],
  ['ENREGISTREE', 'Autorisée'],
  ['REFUSEE', 'Refusée'],
  ['ANNULEE', 'Annulée'],
  ['ANNULEE_APRES_VALIDATION', 'Annulée après validation'],
  ['EXPIREE_NON_VALIDEE', 'Expirée'],
]

const STATUS_PRIORITY = {
  READY: 0,
  WAITING_MANAGER: 1,
  PENDING: 2,
  ANNULATION_EN_ATTENTE_ACCORD: 3,
  A_VERIFIER_PAR_RH: 4,
  JUSTIFICATIF_EN_ATTENTE: 5,
  JUSTIFICATIF_REJETE: 5,
  DECLAREE: 6,
  VALIDEE: 20,
  ENREGISTREE: 21,
  REFUSEE: 22,
  ANNULEE: 23,
  ANNULEE_APRES_VALIDATION: 24,
  EXPIREE_NON_VALIDEE: 25,
  BROUILLON: 30,
}

export function getRhEventStatusOptions(nature = 'ALL') {
  if (nature === 'CONGE') return LEAVE_STATUS_OPTIONS.map((option) => [...option])
  if (nature === 'ABSENCE') return ABSENCE_STATUS_OPTIONS.map((option) => [...option])
  return ALL_STATUS_OPTIONS.map((option) => [...option])
}

export function rhEventStatusMatchesFilter(status, filter = 'ALL') {
  if (filter === 'ALL') return true
  if (filter === 'JUSTIFICATIF_ATTENDU') {
    return status === 'JUSTIFICATIF_EN_ATTENTE' || status === 'JUSTIFICATIF_REJETE'
  }
  return status === filter
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

export function compareRhEventPriority(left, right) {
  const leftPriority = STATUS_PRIORITY[left.status] ?? 15
  const rightPriority = STATUS_PRIORITY[right.status] ?? 15
  if (leftPriority !== rightPriority) return leftPriority - rightPriority

  const byStartDate = String(left.startDate ?? '').localeCompare(String(right.startDate ?? ''))
  if (byStartDate !== 0) return byStartDate

  return String(right.eventDate ?? '').localeCompare(String(left.eventDate ?? ''))
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
