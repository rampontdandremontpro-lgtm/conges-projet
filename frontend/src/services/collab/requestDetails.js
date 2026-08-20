import { apiClient } from '@/services/apiClient'
import { filenameFromDisposition } from '@/services/documents'

function triggerPdfDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}

export async function getLeaveRequest(id) {
  const { data } = await apiClient.get(`/leave-requests/${id}`)
  return data
}

export async function getAbsenceDeclaration(id) {
  const { data } = await apiClient.get(`/absence-declarations/${id}`)
  return data
}

export async function getAbsenceDocuments(id) {
  const { data } = await apiClient.get(`/documents/absence/${id}`)
  return data
}

export async function getLeaveDocuments(id) {
  const { data } = await apiClient.get(`/documents/request/${id}`)
  return data
}

export async function deleteLeaveDraft(id) {
  const { data: documents } = await apiClient.get(`/documents/request/${id}`)
  for (const document of documents ?? []) {
    await apiClient.delete(`/documents/${document.id}`)
  }
  await apiClient.delete(`/leave-requests/${id}`)
}

export async function deleteAbsenceDraft(id) {
  const { data: documents } = await apiClient.get(`/documents/absence/${id}`)
  for (const document of documents ?? []) {
    await apiClient.delete(`/documents/${document.id}`)
  }
  await apiClient.delete(`/absence-declarations/${id}`)
}

export async function cancelLeaveRequest(id, reason = '') {
  const { data } = await apiClient.post(`/leave-requests/${id}/cancel`, {
    reason: reason.trim() || undefined,
  })
  return data
}

export async function requestLeaveCancellation(id, reason) {
  const { data } = await apiClient.post(`/leave-requests/${id}/cancellation-request`, {
    reason,
  })
  return data
}

export async function respondLeaveCancellation(id, consent) {
  const { data } = await apiClient.post(`/leave-requests/${id}/cancellation-consent`, {
    consent,
  })
  return data
}

export async function cancelAbsenceDeclaration(id) {
  const { data } = await apiClient.post(`/absence-declarations/${id}/cancel`)
  return data
}

export async function uploadAbsenceJustificatif(id, file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post(`/documents/absence/${id}`, formData)
  return data
}

export async function downloadPendingSummaryPdf(id, filename = null) {
  const response = await apiClient.get(`/leave-requests/${id}/pending-summary-pdf`, { responseType: 'blob' })
  const serverFilename = filenameFromDisposition(
    response.headers['content-disposition'],
    `recapitulatif-demande-${id}.pdf`,
  )
  triggerPdfDownload(response.data, filename || serverFilename)
}

export async function downloadValidationPdf(id, filename = null) {
  const response = await apiClient.get(`/leave-requests/${id}/pdf`, { responseType: 'blob' })
  const serverFilename = filenameFromDisposition(
    response.headers['content-disposition'],
    `demande-conge-${id}.pdf`,
  )
  triggerPdfDownload(response.data, filename || serverFilename)
}

export async function downloadCancellationPdf(id, filename = `annulation-conge-${id}.pdf`) {
  const response = await apiClient.get(`/leave-requests/${id}/cancellation-pdf`, { responseType: 'blob' })
  triggerPdfDownload(response.data, filename)
}
