import { apiClient } from '@/services/apiClient'

export async function getDirectorRequestFilterOptions() {
  const [{ data: servicesData }, { data: leaveTypesData }] = await Promise.all([
    apiClient.get('/services'),
    apiClient.get('/leave-types'),
  ])

  const services = (Array.isArray(servicesData) ? servicesData : [])
    .filter((service) => service?.id && service?.name)
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'fr'))

  const leaveTypes = (Array.isArray(leaveTypesData) ? leaveTypesData : [])
    .filter((type) => type?.id && type?.name && type?.category === 'DEMANDE_CONGE')
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'fr'))

  return { services, leaveTypes }
}

export async function getDirectorAllRequests() {
  const { data } = await apiClient.get('/leave-requests/management/all')
  return Array.isArray(data) ? data : []
}


export async function getDirectorRequest(id) {
  const { data: request } = await apiClient.get(`/leave-requests/management/${id}`)

  if (request?.status !== 'EN_ATTENTE_VALIDATION') return request

  try {
    const { data: pending } = await apiClient.get('/leave-requests/director/pending')
    const current = Array.isArray(pending)
      ? pending.find((item) => String(item.id) === String(id))
      : null

    return current?.decisionAccess
      ? { ...request, decisionAccess: current.decisionAccess }
      : request
  } catch {
    return request
  }
}

export async function getDirectorRequestAvailability(id) {
  const { data } = await apiClient.get(`/leave-requests/management/${id}/alerts`)
  return data
}

export async function validateDirectorRequest(id, payload) {
  const { data } = await apiClient.post(`/leave-requests/${id}/validate`, payload)
  return data
}

export async function refuseDirectorRequest(id, payload = {}) {
  const { data } = await apiClient.post(`/leave-requests/${id}/refuse`, payload)
  return data
}
