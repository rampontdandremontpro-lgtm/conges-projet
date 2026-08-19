import { apiClient } from '@/services/apiClient'
import { triggerBlobDownload } from '@/services/documents'

export async function getRhDocumentLibrary(filters = {}) {
  const params = {}

  if (filters.status) params.status = filters.status
  if (filters.serviceId) params.serviceId = filters.serviceId
  if (filters.employeeId) params.employeeId = filters.employeeId
  if (filters.startDate) params.startDate = filters.startDate
  if (filters.endDate) params.endDate = filters.endDate

  const { data } = await apiClient.get('/documents/management/library', { params })
  return data
}

export async function getRhDocumentUsers() {
  const { data } = await apiClient.get('/users')
  return data
}

export async function fetchRhDocument(document) {
  if (document.documentKind === 'JUSTIFICATIF') {
    const response = await apiClient.get(`/documents/${document.id}/download`, {
      responseType: 'blob',
    })

    return {
      blob: response.data,
      mimeType: response.headers['content-type'] || response.data?.type || 'application/octet-stream',
    }
  }

  if (!document.leaveRequestId) {
    throw new Error('Ce document PDF n’est pas rattaché à une demande de congé.')
  }

  const endpoint = document.documentKind === 'PDF_RECAPITULATIF'
    ? `/leave-requests/${document.leaveRequestId}/pending-summary-pdf`
    : document.documentKind === 'PDF_ANNULATION'
      ? `/leave-requests/${document.leaveRequestId}/cancellation-pdf`
      : `/leave-requests/${document.leaveRequestId}/pdf`

  const response = await apiClient.get(endpoint, { responseType: 'blob' })

  return {
    blob: response.data,
    mimeType: response.headers['content-type'] || 'application/pdf',
  }
}

export async function downloadRhDocument(document) {
  const { blob } = await fetchRhDocument(document)
  triggerBlobDownload(blob, document.originalName || 'document')
}

export async function getRhDocumentServices() {
  const { data } = await apiClient.get('/services')
  return Array.isArray(data) ? data : []
}
