// Règle d'affichage TEMPORAIRE pour le lancement initial : le profil
// Collaborateur ne voit pas les valeurs numériques des indicateurs
// « Pris », « En attente » et « Validées ». Chaque valeur est remplacée par
// « - j ». Les profils RH, Directeur et Responsable conservent les vrais
// chiffres. Pour réafficher les valeurs réelles plus tard, basculer simplement
// COLLABORATOR_COUNTER_MASK_ENABLED à false (aucune refonte de page requise).
export const COLLABORATOR_COUNTER_MASK_ENABLED = true

export const COLLABORATOR_MASKED_VALUE = '- j'

const MASKED_COUNTER_KEYS = new Set(['takenDays', 'pendingDays', 'validatedDays'])

export function isCollaboratorCounterMasked(key, effectiveRole) {
  return (
    COLLABORATOR_COUNTER_MASK_ENABLED &&
    effectiveRole === 'COLLABORATEUR' &&
    MASKED_COUNTER_KEYS.has(key)
  )
}
