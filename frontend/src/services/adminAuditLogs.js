import { apiClient } from '@/services/apiClient'

export async function getAdminAuditLogs() {
  const response = await apiClient.get('/audit-logs', {
    params: { limit: 500 },
  })

  return Array.isArray(response.data) ? response.data : []
}
