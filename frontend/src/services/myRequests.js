import { apiClient } from '@/services/apiClient'

export async function getMyLeaveRequests() {
  const { data } = await apiClient.get('/leave-requests/my')
  return data
}

export async function getMyAbsenceDeclarations() {
  const { data } = await apiClient.get('/absence-declarations/my')
  return data
}
