import { apiClient } from '@/services/apiClient'
import { isReservedDirectorLeaveType } from '@/utils/filterOptions'

export async function getDirectorStatistics(params) {
  const response = await apiClient.get('/reports/director/statistics', { params })
  return response.data
}

export async function getDirectorStatisticsServices() {
  const response = await apiClient.get('/services')
  return Array.isArray(response.data) ? response.data : []
}

export async function getDirectorStatisticsLeaveTypes() {
  const response = await apiClient.get('/leave-types')
  return (Array.isArray(response.data) ? response.data : []).filter((type) =>
    type?.isActive !== false &&
    ['DEMANDE_CONGE', 'DECLARATION_ABSENCE'].includes(type?.category) &&
    !isReservedDirectorLeaveType(type),
  )
}
