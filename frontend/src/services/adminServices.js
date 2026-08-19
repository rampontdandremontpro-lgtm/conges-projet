import { apiClient } from '@/services/apiClient'

export async function getAdminServicesData() {
  const [servicesResponse, usersResponse] = await Promise.all([
    apiClient.get('/services'),
    apiClient.get('/users'),
  ])

  return {
    services: Array.isArray(servicesResponse.data) ? servicesResponse.data : [],
    users: Array.isArray(usersResponse.data) ? usersResponse.data : [],
  }
}

export async function createAdminService(payload) {
  const response = await apiClient.post('/services', payload)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function updateAdminService(id, payload) {
  const response = await apiClient.patch(`/services/${id}`, payload)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function disableAdminService(id) {
  const response = await apiClient.patch(`/services/${id}/disable`)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function enableAdminService(id) {
  const response = await apiClient.patch(`/services/${id}/enable`)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}
