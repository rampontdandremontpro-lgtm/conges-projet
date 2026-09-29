import { apiClient } from '@/services/apiClient'

export async function getRhBalancesOverview(referencePeriod) {
  const { data } = await apiClient.get('/leave-balances/management', { params: referencePeriod ? { referencePeriod } : undefined })
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


export async function initializeRhBalance({ employeeId, referencePeriod, counterType, acquiredDays = 0, reason }) {
  const { data } = await apiClient.post('/leave-balances/initialize', {
    employeeId,
    referencePeriod,
    counterType,
    acquiredDays,
    reason,
  })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances-initialize' } }))
  return data
}

export async function correctRhBalance(balanceId, days, reason, notifyEmployee = false) {
  const { data } = await apiClient.post(`/leave-balances/${balanceId}/correction`, {
    days,
    reason,
    notifyEmployee,
  })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances' } }))
  return data
}

export async function getRhBalanceFilterOptions() {
  const [servicesResponse, usersResponse] = await Promise.all([
    apiClient.get('/services'),
    apiClient.get('/users'),
  ])

  return {
    services: Array.isArray(servicesResponse.data) ? servicesResponse.data : [],
    users: Array.isArray(usersResponse.data) ? usersResponse.data : [],
  }
}

export async function getRhEmployeePeriodSummaries(employeeId) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}/summary`)
  return data
}

export async function getRhBalanceProjection(employeeId, { startDate, days, excludeRequestId }) {
  const { data } = await apiClient.get(`/leave-balances/employee/${employeeId}/projection`, {
    params: { startDate, days, ...(excludeRequestId ? { excludeRequestId } : {}) },
  })
  return data
}

export async function previewRhBalanceImport(referencePeriod, rows) {
  const { data } = await apiClient.post('/leave-balances/import/preview', { referencePeriod, rows })
  return data
}

export async function confirmRhBalanceImport(referencePeriod, rows) {
  const { data } = await apiClient.post('/leave-balances/import/confirm', { referencePeriod, rows })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances-import' } }))
  return data
}

export async function previewRhPeriodClose(referencePeriod) {
  const { data } = await apiClient.get(`/leave-balances/period/${referencePeriod}/preview`)
  return data
}

export async function grantRhExceptionalCarryover({ employeeId, closingReferencePeriod, days, reason }) {
  const { data } = await apiClient.post('/leave-balances/period/carryover', {
    employeeId,
    closingReferencePeriod,
    days,
    reason,
  })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances-carryover' } }))
  return data
}

export async function closeRhPeriod(referencePeriod) {
  const { data } = await apiClient.post('/leave-balances/period/close', {
    referencePeriod,
    confirm: true,
  })
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-balances-close' } }))
  return data
}
