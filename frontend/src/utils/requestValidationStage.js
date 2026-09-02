const MANAGER_QUEUE_TREATMENTS = new Set([
  'RESPONSABLE_SERVICE',
  'VALIDATEUR_TEMPORAIRE',
  'VALIDATEUR_SECOURS_DIRECTEUR',
])

export function requestValidationStageMeta(request) {
  if (request?.status !== 'EN_ATTENTE_VALIDATION') return null

  if (request?.canDecideNow === true) {
    return { key: 'READY', label: 'À valider', tone: 'ready' }
  }

  if (MANAGER_QUEUE_TREATMENTS.has(request?.treatment?.kind)) {
    return { key: 'WAITING_MANAGER', label: 'Attente responsable', tone: 'pending' }
  }

  if (request?.canDecideNow === false) {
    return { key: 'PENDING', label: 'En attente', tone: 'pending' }
  }

  // Compatibilité avec d'anciennes réponses API ne contenant pas encore canDecideNow.
  return { key: 'READY', label: 'À valider', tone: 'ready' }
}
