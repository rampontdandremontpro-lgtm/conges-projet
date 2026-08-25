import { apiClient } from '@/services/apiClient'

function buildParams(filters = {}, format) {
  const params = {}

  if (filters.startDate) params.startDate = filters.startDate
  if (filters.endDate) params.endDate = filters.endDate
  if (filters.serviceId === 'external') params.serviceScope = 'EXTERNE'
  else if (filters.serviceId) params.serviceId = filters.serviceId
  if (filters.employeeId) params.employeeId = filters.employeeId
  if (filters.leaveTypeId) params.leaveTypeId = filters.leaveTypeId
  if (filters.referencePeriod) params.referencePeriod = filters.referencePeriod
  if (format) params.format = format

  return params
}

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ''))
    } catch {
      return utf8Match[1].replace(/["']/g, '')
    }
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1]?.trim() || fallback
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 700)
}

export async function getRhExportsOverview(filters) {
  const { data } = await apiClient.get('/exports/overview', {
    params: buildParams(filters),
  })
  return data
}

export async function downloadRhExport(kind, format, filters) {
  const endpointByKind = {
    leaves: '/exports/leave-requests',
    absences: '/exports/absence-declarations',
    balances: '/exports/leave-balances',
    movements: '/exports/balance-movements',
    derogations: '/exports/derogations',
  }

  const endpoint = endpointByKind[kind]
  if (!endpoint) {
    throw new Error('Type d’export inconnu.')
  }

  const response = await apiClient.get(endpoint, {
    params: buildParams(filters, format),
    responseType: 'blob',
  })

  const extension = format === 'xlsx' ? 'xlsx' : 'csv'
  const fallback = `export_${kind}.${extension}`
  const filename = filenameFromDisposition(response.headers['content-disposition'], fallback)
  triggerDownload(response.data, filename)
  return filename
}
