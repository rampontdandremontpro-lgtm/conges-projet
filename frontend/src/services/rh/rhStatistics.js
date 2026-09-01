import { apiClient } from '@/services/apiClient'
import { isReservedDirectorLeaveType } from '@/utils/filterOptions'

export async function getRhStatistics(params) {
  const response = await apiClient.get('/reports/rh/statistics', { params })
  return response.data
}

export async function getRhStatisticsServices() {
  const response = await apiClient.get('/services')
  return Array.isArray(response.data) ? response.data : []
}

export async function getRhStatisticsLeaveTypes() {
  const response = await apiClient.get('/leave-types/management')
  return (Array.isArray(response.data) ? response.data : []).filter((type) =>
    type?.isActive !== false &&
    ['DEMANDE_CONGE', 'DECLARATION_ABSENCE'].includes(type?.category) &&
    !isReservedDirectorLeaveType(type),
  )
}
