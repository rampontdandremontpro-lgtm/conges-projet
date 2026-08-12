import { apiClient } from '@/services/apiClient'

export async function getMyBalances() {
  const { data } = await apiClient.get('/leave-balances/my')
  return data
}

export async function getBalanceSettings() {
  const { data } = await apiClient.get('/settings/public')
  return data
}
