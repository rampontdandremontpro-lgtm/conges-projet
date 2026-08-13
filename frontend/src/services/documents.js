import { apiClient } from '@/services/apiClient'

export async function getMyDocuments() {
  const { data } = await apiClient.get('/documents/my')
  return data
}

export async function replaceMyDocument(documentId, file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.patch(`/documents/${documentId}/replace`, formData)
  return data
}

export async function deleteMyDocument(documentId) {
  const { data } = await apiClient.delete(`/documents/${documentId}`)
  return data
}

export async function fetchMyJustificatif(documentId) {
  const response = await apiClient.get(`/documents/${documentId}/download`, {
    responseType: 'blob',
  })

  return {
    blob: response.data,
    mimeType: response.headers['content-type'] || response.data?.type || 'application/octet-stream',
  }
}

export async function fetchOfficialPdf(document) {
  const requestId = document?.leaveRequestId
  if (!requestId) {
    throw new Error('Ce document PDF n’est pas rattaché à une demande de congé.')
  }

  const endpoint = document.documentKind === 'PDF_ANNULATION'
    ? `/leave-requests/${requestId}/cancellation-pdf`
    : `/leave-requests/${requestId}/pdf`

  const response = await apiClient.get(endpoint, { responseType: 'blob' })

  return {
    blob: response.data,
    mimeType: response.headers['content-type'] || 'application/pdf',
  }
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'document'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}

export async function downloadOfficialPdf(document) {
  const { blob } = await fetchOfficialPdf(document)
  triggerBlobDownload(blob, document.originalName || 'document.pdf')
}

export async function downloadMyJustificatif(document) {
  const { blob } = await fetchMyJustificatif(document.id)
  triggerBlobDownload(blob, document.originalName || 'justificatif')
}
