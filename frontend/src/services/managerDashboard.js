import { apiClient } from '@/services/apiClient'

export async function getManagerPendingRequests() {
  const { data } = await apiClient.get('/leave-requests/pending')
  return data
}

export async function getManagerServicePresence() {
  const { data } = await apiClient.get('/users/me/service-presence')
  return data
}
