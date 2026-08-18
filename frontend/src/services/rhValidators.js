import { apiClient } from '@/services/apiClient'

export async function getRhValidatorServices() {
  const response = await apiClient.get('/services')
  return response.data
}

export async function getRhServiceValidators(serviceId) {
  const response = await apiClient.get(`/services/${serviceId}/validators`)
  return response.data
}

export async function addRhBackupValidator(serviceId, validatorId) {
  const response = await apiClient.post(`/services/${serviceId}/validators`, { validatorId })
  return response.data
}

export async function disableRhBackupValidator(serviceId, validatorId) {
  const response = await apiClient.patch(`/services/${serviceId}/validators/${validatorId}/disable`)
  return response.data
}

export async function enableRhBackupValidator(serviceId, validatorId) {
  const response = await apiClient.patch(`/services/${serviceId}/validators/${validatorId}/enable`)
  return response.data
}

export async function getRhValidatorUsers() {
  const response = await apiClient.get('/users')
  return response.data
}

export async function getRhValidatorReplacements(params = {}) {
  const response = await apiClient.get('/validator-replacements', { params })
  return response.data
}

export async function createRhValidatorReplacement(payload) {
  const response = await apiClient.post('/validator-replacements', payload)
  return response.data
}

export async function disableRhValidatorReplacement(id) {
  const response = await apiClient.patch(`/validator-replacements/${id}/disable`)
  return response.data
}
