import { apiClient } from '@/services/apiClient'

export async function getMyLeaveBalances() {
  const { data } = await apiClient.get('/leave-balances/my')
  return data
}

export async function getMyLeaveRequests() {
  const { data } = await apiClient.get('/leave-requests/my')
  return data
}

export async function getPublicSettings() {
  const { data } = await apiClient.get('/settings/public')
  return data
}
