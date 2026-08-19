import { apiClient } from '@/services/apiClient'

export async function getAdminDashboardData() {
  const [usersResponse, servicesResponse, logsResponse] = await Promise.all([
    apiClient.get('/users'),
    apiClient.get('/services'),
    apiClient.get('/audit-logs', { params: { limit: 120 } }),
  ])

  return {
    users: Array.isArray(usersResponse.data) ? usersResponse.data : [],
    services: Array.isArray(servicesResponse.data) ? servicesResponse.data : [],
    logs: Array.isArray(logsResponse.data) ? logsResponse.data : [],
  }
}
