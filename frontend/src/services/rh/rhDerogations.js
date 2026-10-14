import { apiClient } from '@/services/apiClient'

export async function getRhDerogations(params = {}) {
  const { data } = await apiClient.get('/derogations/management', { params })
  return Array.isArray(data) ? data : []
}

export async function getRhDerogation(id) {
  const { data } = await apiClient.get(`/derogations/management/${id}`)
  return data
}
