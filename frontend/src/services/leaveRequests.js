import { apiClient } from '@/services/apiClient'

export async function getLeaveTypes() {
  const { data } = await apiClient.get('/leave-types')
  return data
}

export async function getHolidays(year) {
  const { data } = await apiClient.get(`/holidays?year=${year}`)
  return data
}

export async function getSeasonalPeriod() {
  const { data } = await apiClient.get('/settings/seasonal-period')
  return data
}

export async function getMyDerogations() {
  const { data } = await apiClient.get('/derogations/my')
  return data
}

export async function createLeaveRequest(payload) {
  const { data } = await apiClient.post('/leave-requests', payload)
  return data
}

export async function updateLeaveRequest(id, payload) {
  const { data } = await apiClient.patch(`/leave-requests/${id}`, payload)
  return data
}

export async function submitLeaveRequest(id, payload) {
  const { data } = await apiClient.post(`/leave-requests/${id}/submit`, payload)
  return data
}

export async function requestDerogation(payload) {
  const { data } = await apiClient.post('/derogations', payload)
  return data
}
