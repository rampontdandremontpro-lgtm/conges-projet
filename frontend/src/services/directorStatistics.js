import { apiClient } from '@/services/apiClient'

export async function getDirectorStatistics(params) {
  const response = await apiClient.get('/reports/director/statistics', { params })
  return response.data
}

export async function getDirectorStatisticsServices() {
  const response = await apiClient.get('/services')
  return Array.isArray(response.data) ? response.data : []
}
