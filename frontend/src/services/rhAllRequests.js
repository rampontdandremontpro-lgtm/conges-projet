import { apiClient } from '@/services/apiClient'

export async function getRhAllRequests() {
  const { data } = await apiClient.get('/leave-requests/management/all')
  return Array.isArray(data) ? data : []
}
