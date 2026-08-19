import { apiClient } from '@/services/apiClient'

export async function getManagerAllRequests() {
  const { data } = await apiClient.get('/leave-requests/management/all')
  return Array.isArray(data) ? data : []
}

export async function getManagerPendingRequests() {
  const { data } = await apiClient.get('/leave-requests/pending')
  return data
}

export async function getManagerRequest(id) {
  const { data } = await apiClient.get(`/leave-requests/management/${id}`)
  return data
}

export async function getManagerRequestAvailability(id) {
  const { data } = await apiClient.get(`/leave-requests/management/${id}/alerts`)
  return data
}

export async function validateManagerRequest(id, payload) {
  const { data } = await apiClient.post(`/leave-requests/${id}/validate`, payload)
  return data
}

export async function refuseManagerRequest(id, payload = {}) {
  const { data } = await apiClient.post(`/leave-requests/${id}/refuse`, payload)
  return data
}
