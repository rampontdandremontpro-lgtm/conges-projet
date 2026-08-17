import { apiClient } from '@/services/apiClient'

export async function getRhPendingRequests() {
  const { data } = await apiClient.get('/leave-requests/pending')
  return data
}

export async function getRhRequest(id) {
  const { data } = await apiClient.get(`/leave-requests/management/${id}`)
  return data
}

export async function getRhRequestAvailability(id) {
  const { data } = await apiClient.get(`/leave-requests/management/${id}/alerts`)
  return data
}

export async function validateRhRequest(id, payload) {
  const { data } = await apiClient.post(`/leave-requests/${id}/validate`, payload)
  return data
}

export async function refuseRhRequest(id, payload = {}) {
  const { data } = await apiClient.post(`/leave-requests/${id}/refuse`, payload)
  return data
}
