import { apiClient } from '@/services/apiClient'

function notifyChanged() {
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'holidays' } }))
}

export async function getRhHolidays(year) {
  const { data } = await apiClient.get('/holidays', { params: { year } })
  return Array.isArray(data) ? data : []
}

export async function createRhClosure({ date, name }) {
  const { data } = await apiClient.post('/holidays', {
    date,
    name,
    holidayType: 'FERMETURE_GMES',
    deductible: false,
    source: 'GMES',
  })
  notifyChanged()
  return data
}

export async function updateRhClosure(id, { date, name }) {
  const { data } = await apiClient.patch(`/holidays/${id}`, {
    date,
    name,
    holidayType: 'FERMETURE_GMES',
    deductible: false,
    source: 'GMES',
  })
  notifyChanged()
  return data
}

export async function disableRhClosure(id) {
  const { data } = await apiClient.patch(`/holidays/${id}/disable`, {})
  notifyChanged()
  return data
}
