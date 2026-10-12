// Indicateurs de fonctionnalité centralisés.
// Pour désactiver le pop-up d'information de la première phase de test en
// production, passer COLLABORATOR_PRODUCTION_PHASE_INFO à false.
export const FEATURE_FLAGS = {
  COLLABORATOR_PRODUCTION_PHASE_INFO: true,
}

const COLLABORATOR_INFO_DISMISSED_KEY = 'gmes-collab-production-phase-info-dismissed'

export function isCollaboratorProductionInfoDismissed() {
  try {
    return sessionStorage.getItem(COLLABORATOR_INFO_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function markCollaboratorProductionInfoDismissed() {
  try {
    sessionStorage.setItem(COLLABORATOR_INFO_DISMISSED_KEY, '1')
  } catch {
    // Le stockage navigateur peut être indisponible selon le contexte.
  }
}

export function resetCollaboratorProductionInfoDismissal() {
  try {
    sessionStorage.removeItem(COLLABORATOR_INFO_DISMISSED_KEY)
  } catch {
    // Le stockage navigateur peut être indisponible selon le contexte.
  }
}
