import { apiClient } from '@/services/apiClient'

export async function getMyBalanceHistory(params = {}) {
  const { data } = await apiClient.get('/leave-balances/my/history', { params })
  return data
}
