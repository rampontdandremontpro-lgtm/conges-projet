import { apiClient } from '@/services/apiClient'

export async function getMyLeavePeriodSummaries() {
  const { data } = await apiClient.get('/leave-balances/my/summary')
  return data
}

export async function getEmployeeLeavePeriodSummaries(employeeId) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}/summary`)
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
