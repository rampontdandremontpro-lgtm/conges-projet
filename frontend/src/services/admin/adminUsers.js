import { apiClient } from '@/services/apiClient'

export async function getAdminUsersData() {
  const [usersResponse, servicesResponse] = await Promise.all([
    apiClient.get('/users'),
    apiClient.get('/services'),
  ])

  return {
    users: Array.isArray(usersResponse.data) ? usersResponse.data : [],
    services: Array.isArray(servicesResponse.data) ? servicesResponse.data : [],
  }
}

export async function createAdminUser(payload) {
  const response = await apiClient.post('/users', payload)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function updateAdminUser(id, payload) {
  const response = await apiClient.patch(`/users/${id}`, payload)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function disableAdminUser(id) {
  const response = await apiClient.patch(`/users/${id}/disable`)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}

export async function enableAdminUser(id) {
  const response = await apiClient.patch(`/users/${id}/enable`)
  window.dispatchEvent(new Event('gmes:data-changed'))
  return response.data
}
