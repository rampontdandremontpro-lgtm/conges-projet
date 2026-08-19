import { apiClient } from '@/services/apiClient'

export async function getDirectorLeaveRequests() {
  const { data } = await apiClient.get('/leave-requests/director/my')
  return Array.isArray(data) ? data : []
}

export async function getDirectorLeaveRequest(id) {
  const { data } = await apiClient.get(`/leave-requests/director/${id}`)
  return data
}

export async function updateDirectorLeaveRequest(id, payload) {
  const { data } = await apiClient.patch(`/leave-requests/director/${id}`, payload)
  return data
}

export async function cancelDirectorLeaveRequest(id) {
  const { data } = await apiClient.post(`/leave-requests/director/${id}/cancel`)
  return data
}

export async function getDirectorAbsences() {
  const { data } = await apiClient.get('/absence-declarations/my')
  return Array.isArray(data) ? data : []
}

export async function getDirectorAbsence(id) {
  const { data } = await apiClient.get(`/absence-declarations/${id}`)
  return data
}

export async function updateDirectorAbsence(id, payload) {
  const { data } = await apiClient.patch(`/absence-declarations/director/${id}`, payload)
  return data
}

export async function cancelDirectorAbsence(id) {
  const { data } = await apiClient.post(`/absence-declarations/director/${id}/cancel`)
  return data
}
