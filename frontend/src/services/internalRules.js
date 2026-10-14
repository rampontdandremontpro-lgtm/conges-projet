import { apiClient } from '@/services/apiClient'

export async function getInternalRules() {
  const { data } = await apiClient.get('/settings/internal-rules')
  return data
}

export async function createInternalRule(payload) {
  const { data } = await apiClient.post('/settings/internal-rules', payload)
  return data
}

export async function updateInternalRule(id, payload) {
  const { data } = await apiClient.patch(`/settings/internal-rules/${encodeURIComponent(id)}`, payload)
  return data
}

export async function deleteInternalRule(id) {
  const { data } = await apiClient.delete(`/settings/internal-rules/${encodeURIComponent(id)}`)
  return data
}
