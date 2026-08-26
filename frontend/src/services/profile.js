import { apiClient } from '@/services/apiClient'

export async function getMyProfile() {
  const { data } = await apiClient.get('/users/me')
  return data
}

export async function getMySignature() {
  const { data } = await apiClient.get('/users/me/signature')
  return data
}

export async function saveMySignature(payload) {
  const { data } = await apiClient.put('/users/me/signature', payload)
  return data
}

export async function deleteMySignature() {
  const { data } = await apiClient.delete('/users/me/signature')
  return data
}

export async function changeMyPassword(payload) {
  const { data } = await apiClient.patch('/auth/change-password', payload)
  return data
}

export async function getMyPreferences() {
  const { data } = await apiClient.get('/users/me/preferences')
  return data
}

export async function getProfileImages() {
  const { data } = await apiClient.get('/users/profile-images')
  return data
}

export async function saveMyPreferences(payload) {
  const { data } = await apiClient.put('/users/me/preferences', payload)
  return data
}
