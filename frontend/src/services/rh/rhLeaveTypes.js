import { apiClient } from '@/services/apiClient'

function notifyChanged() {
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'leave-types' } }))
}

export async function getRhLeaveTypes() {
  const { data } = await apiClient.get('/leave-types/management')
  return Array.isArray(data) ? data : []
}

export async function createRhLeaveType(payload) {
  const { data } = await apiClient.post('/leave-types', payload)
  notifyChanged()
  return data
}

export async function updateRhLeaveType(id, payload) {
  const { data } = await apiClient.patch(`/leave-types/${id}`, payload)
  notifyChanged()
  return data
}

export async function disableRhLeaveType(id) {
  const { data } = await apiClient.patch(`/leave-types/${id}/disable`, {})
  notifyChanged()
  return data
}
