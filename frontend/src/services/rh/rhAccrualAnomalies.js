import { apiClient } from '@/services/apiClient'

export async function listAccrualAnomalies(status) {
  const { data } = await apiClient.get('/leave-balances/accrual-anomalies', {
    params: status ? { status } : {},
  })
  return Array.isArray(data) ? data : []
}

export async function resolveAccrualAnomaly(id, decisionReason, retainedKind) {
  const { data } = await apiClient.post(`/leave-balances/accrual-anomalies/${id}/resolve`, {
    decisionReason: decisionReason?.trim() || undefined,
    retainedKind: retainedKind?.trim() || undefined,
  })
  return data
}

export async function regularizeAccrualRange(employeeId, startDate, endDate) {
  const { data } = await apiClient.post('/leave-balances/accrual/regularize', {
    employeeId,
    startDate,
    endDate,
  })
  return data
}
