import { apiClient } from '@/services/apiClient'

export async function getRhStatistics(params) {
  const response = await apiClient.get('/reports/rh/statistics', { params })
  return response.data
}

export async function getRhStatisticsServices() {
  const response = await apiClient.get('/services')
  return Array.isArray(response.data) ? response.data : []
}
