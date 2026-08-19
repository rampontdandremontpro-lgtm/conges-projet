import { apiClient } from '@/services/apiClient'

export async function getRhEligibleCollaborators() {
  const { data } = await apiClient.get('/users')
  return (Array.isArray(data) ? data : [])
    .filter((user) =>
      user?.isActive &&
      user?.role === 'COLLABORATEUR' &&
      Boolean(user?.serviceId) &&
      user?.service?.isActive !== false
    )
    .sort((left, right) => {
      const leftName = `${left?.nom ?? ''} ${left?.prenom ?? ''}`.trim()
      const rightName = `${right?.nom ?? ''} ${right?.prenom ?? ''}`.trim()
      return leftName.localeCompare(rightName, 'fr', { sensitivity: 'base' })
    })
}
