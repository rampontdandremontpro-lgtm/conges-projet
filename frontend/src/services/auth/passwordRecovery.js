import { apiClient } from '@/services/apiClient'

export async function requestPasswordReset(email) {
  const response = await apiClient.post('/auth/request-password', { email })
  return response.data
}

export async function validatePasswordResetToken(token) {
  const response = await apiClient.post('/auth/validate-password-token', { token })
  return response.data
}

export async function resetPassword(token, password) {
  const response = await apiClient.post('/auth/define-password', { token, password })
  return response.data
}
