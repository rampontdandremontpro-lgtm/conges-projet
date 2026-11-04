import { apiClient } from '@/services/apiClient'

/** Téléverse un justificatif de fondement salarié (EN ATTENTE). */
export async function uploadBasisDocument(employeeId, file) {
  const formData = new FormData()
  formData.append('employeeId', String(employeeId))
  formData.append('file', file)
  const { data } = await apiClient.post('/documents/basis', formData)
  return data
}

/** Valide un justificatif de fondement avec une justification RH. */
export async function validateBasisDocument(documentId, justification) {
  const { data } = await apiClient.post(`/documents/basis/${documentId}/validate`, { justification })
  return data
}

export async function listIllnessMaintenance() {
  const { data } = await apiClient.get('/illness-maintenance')
  return Array.isArray(data) ? data : []
}

export async function createIllnessMaintenance(payload) {
  const { data } = await apiClient.post('/illness-maintenance', payload)
  return data
}

export async function cancelIllnessMaintenance(id) {
  const { data } = await apiClient.post(`/illness-maintenance/${id}/cancel`)
  return data
}

export async function listEmployees() {
  const { data } = await apiClient.get('/users')
  return Array.isArray(data) ? data : []
}
