import { apiClient } from '@/services/apiClient'

export async function getMyLeaveBalances() {
  const { data } = await apiClient.get('/leave-balances/my')
  return data
}

export async function getEmployeeLeaveBalances(employeeId) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}`)
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
