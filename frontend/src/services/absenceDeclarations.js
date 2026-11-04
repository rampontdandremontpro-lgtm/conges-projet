import { apiClient } from '@/services/apiClient'
import { getLeaveTypes } from '@/services/leaveRequests'

export async function getCollaboratorAbsenceTypes() {
  const leaveTypes = await getLeaveTypes()
  return (leaveTypes ?? []).filter(
    (type) =>
      type.category === 'DECLARATION_ABSENCE' &&
      type.isActive &&
      type.employeeCanCreate &&
      !type.rhOnly,
  )
}

export async function createAbsenceDeclaration(payload) {
  const { data } = await apiClient.post('/absence-declarations', payload)
  return data
}

export async function previewFamilyEvent(payload) {
  const { data } = await apiClient.post(
    '/absence-declarations/family-event/preview',
    payload,
  )
  return data
}

export async function previewPaternity(payload) {
  const { data } = await apiClient.post(
    '/absence-declarations/paternity/preview',
    payload,
  )
  return data
}

export async function getMyBirthEvents() {
  const { data } = await apiClient.get('/birth-events/my')
  return data
}

export async function getBirthEvents(employeeId) {
  const { data } = await apiClient.get('/birth-events', {
    params: { employeeId },
  })
  return data
}

export async function createBirthEvent(payload, employeeId) {
  const { data } = await apiClient.post('/birth-events', payload, {
    params: employeeId ? { employeeId } : undefined,
  })
  return data
}

export async function updateAbsenceDeclaration(id, payload) {
  const { data } = await apiClient.patch(`/absence-declarations/${id}`, payload)
  return data
}

export async function submitAbsenceDeclaration(id, payload) {
  const { data } = await apiClient.post(`/absence-declarations/${id}/submit`, payload)
  return data
}

export async function uploadAbsenceDocument(absenceDeclarationId, file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post(
    `/documents/absence/${absenceDeclarationId}`,
    formData,
  )
  return data
}

export async function deleteAbsenceDocument(documentId) {
  await apiClient.delete(`/documents/${documentId}`)
}
