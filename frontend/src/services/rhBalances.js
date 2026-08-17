import { apiClient } from '@/services/apiClient'

export async function getRhBalancesOverview() {
  const { data } = await apiClient.get('/leave-balances/management')
  return data
}

export async function getRhEmployeeBalances(employeeId) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}`)
  return data
}

export async function getRhEmployeeBalanceHistory(employeeId) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}/history`)
  return data
}

export async function correctRhBalance(balanceId, days, reason) {
  const { data } = await apiClient.post(`/leave-balances/${balanceId}/correction`, {
    days,
    reason,
  })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances' } }))
  return data
}
