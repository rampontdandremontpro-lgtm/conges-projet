import { apiClient } from '@/services/apiClient'

export async function getRhAbsenceDeclarations() {
  const { data } = await apiClient.get('/absence-declarations/management')
  return Array.isArray(data) ? data : []
}

export async function getRhAbsenceTypes() {
  const { data } = await apiClient.get('/leave-types')
  return (Array.isArray(data) ? data : [])
    .filter((type) => type?.isActive && type?.category === 'DECLARATION_ABSENCE')
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'fr'))
}

export async function getRhAbsenceEmployees() {
  const { data } = await apiClient.get('/users')
  return (Array.isArray(data) ? data : [])
    .filter((user) => user?.isActive && user?.role !== 'ADMIN' && Boolean(user?.serviceId))
    .sort((left, right) => {
      const leftName = `${left?.nom ?? ''} ${left?.prenom ?? ''}`.trim()
      const rightName = `${right?.nom ?? ''} ${right?.prenom ?? ''}`.trim()
      return leftName.localeCompare(rightName, 'fr', { sensitivity: 'base' })
    })
}

export async function createRhAbsenceDraft(payload) {
  const { data } = await apiClient.post('/absence-declarations', payload)
  return data
}

export async function submitRhAbsence(id) {
  const { data } = await apiClient.post(`/absence-declarations/${id}/submit`, {})
  return data
}

export async function registerRhAbsence(id) {
  const { data } = await apiClient.post(`/absence-declarations/${id}/register`, {})
  return data
}

export async function cancelRhAbsence(id) {
  const { data } = await apiClient.post(`/absence-declarations/${id}/cancel`, {})
  return data
}

export async function deleteRhAbsenceDraft(id) {
  await apiClient.delete(`/absence-declarations/${id}`)
}

export async function uploadRhAbsenceDocument(absenceDeclarationId, file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post(
    `/documents/absence/${absenceDeclarationId}`,
    formData,
  )
  return data
}


export async function getRhAbsenceDeclaration(id) {
  const { data } = await apiClient.get(`/absence-declarations/management/${id}`)
  return data
}

export async function getRhAbsenceDocuments(id) {
  const { data } = await apiClient.get(`/documents/absence/${id}`)
  return Array.isArray(data) ? data : []
}

export async function fetchRhAbsenceDocument(documentId) {
  const response = await apiClient.get(`/documents/${documentId}/download`, {
    responseType: 'blob',
  })

  return {
    blob: response.data,
    mimeType: response.headers['content-type'] || response.data?.type || 'application/octet-stream',
  }
}

export async function acceptRhAbsenceDocument(documentId) {
  const { data } = await apiClient.post(`/documents/${documentId}/accept`, {})
  return data
}

export async function rejectRhAbsenceDocument(documentId, reason) {
  const { data } = await apiClient.post(`/documents/${documentId}/reject`, {
    reason: String(reason ?? '').trim(),
  })
  return data
}
