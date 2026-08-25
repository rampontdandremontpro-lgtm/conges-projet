import { apiClient } from '@/services/apiClient'

export async function getRhHistoryLogs() {
  const { data } = await apiClient.get('/audit-logs/rh-history', { params: { limit: 2000 } })
  return Array.isArray(data) ? data : []
}

export async function getRhHistoryUsers() {
  const { data } = await apiClient.get('/users')
  return Array.isArray(data) ? data : []
}
