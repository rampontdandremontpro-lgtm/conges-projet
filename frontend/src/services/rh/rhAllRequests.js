import { apiClient } from '@/services/apiClient'

export async function getRhAllRequests() {
  const { data } = await apiClient.get('/leave-requests/management/all')
  return Array.isArray(data) ? data : []
}


export async function getRhAllRequestFilterOptions() {
  const [{ data: servicesData }, { data: leaveTypesData }] = await Promise.all([
    apiClient.get('/services'),
    apiClient.get('/leave-types/management'),
  ])

  const services = (Array.isArray(servicesData) ? servicesData : [])
    .filter((service) => service?.id && service?.name)
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'fr'))

  const leaveTypes = (Array.isArray(leaveTypesData) ? leaveTypesData : [])
    .filter((type) => {
      if (!type?.id || !type?.name || type?.category !== 'DEMANDE_CONGE') return false
      const name = String(type.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      return name.includes('paye') || name.includes('sans solde')
    })
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'fr'))

  return { services, leaveTypes }
}
