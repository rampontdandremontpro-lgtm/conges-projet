import { apiClient } from '@/services/apiClient'

export async function getPracticalLinks() {
  const { data } = await apiClient.get('/settings/practical-links')
  return data
}

export async function createPracticalLink(payload) {
  const { data } = await apiClient.post('/settings/practical-links', payload)
  return data
}

export async function updatePracticalLink(id, payload) {
  const { data } = await apiClient.patch(`/settings/practical-links/${encodeURIComponent(id)}`, payload)
  return data
}

export async function deletePracticalLink(id) {
  const { data } = await apiClient.delete(`/settings/practical-links/${encodeURIComponent(id)}`)
  return data
}
