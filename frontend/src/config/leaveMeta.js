export const LEAVE_REQUEST_STATUS_META = {
  BROUILLON: { label: 'Brouillon', tone: 'neutral' },
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'warning' },
  EN_COURS_TRAITEMENT: { label: 'En cours de traitement', tone: 'warning' },
  VALIDEE: { label: 'Validée · circuit terminé', tone: 'success' },
  REFUSEE: { label: 'Refusée', tone: 'danger' },
  ANNULEE: { label: 'Annulée', tone: 'neutral' },
  ANNULATION_EN_ATTENTE_ACCORD: {
    label: 'Annulation en attente',
    tone: 'warning',
  },
  ANNULEE_APRES_VALIDATION: {
    label: 'Annulée après validation',
    tone: 'neutral',
  },
  EXPIREE_NON_VALIDEE: { label: 'Expirée non validée', tone: 'neutral' },
}

export function getLeaveRequestStatusMeta(status) {
  return LEAVE_REQUEST_STATUS_META[status] ?? { label: status, tone: 'neutral' }
}

export function getEffectiveLeaveRequestStatus(request) {
  if (request?.status === 'EN_ATTENTE_VALIDATION' && request?.finalDeciderId) {
    return 'EN_COURS_TRAITEMENT'
  }
  return request?.status
}
