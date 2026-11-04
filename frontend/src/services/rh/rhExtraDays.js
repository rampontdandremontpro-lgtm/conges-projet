import { apiClient } from '@/services/apiClient'

export async function getSeniorityExtraConfig() {
  const { data } = await apiClient.get('/leave-balances/seniority-extra/config')
  return data
}

export async function updateSeniorityExtraConfig(config) {
  const { data } = await apiClient.put('/leave-balances/seniority-extra/config', config)
  return data
}

export async function previewSeniorityExtra(referencePeriod) {
  const { data } = await apiClient.get(`/leave-balances/seniority-extra/preview/${referencePeriod}`)
  return data
}

export async function applySeniorityExtra(referencePeriod) {
  const { data } = await apiClient.post('/leave-balances/seniority-extra/apply', { referencePeriod })
  return data
}

export async function getFractionnementConfig() {
  const { data } = await apiClient.get('/leave-balances/fractionnement/config')
  return data
}

export async function updateFractionnementConfig(config) {
  const { data } = await apiClient.put('/leave-balances/fractionnement/config', config)
  return data
}

export async function previewFractionnement(referencePeriod) {
  const { data } = await apiClient.get(`/leave-balances/fractionnement/preview/${referencePeriod}`)
  return data
}

export async function applyFractionnement(referencePeriod) {
  const { data } = await apiClient.post('/leave-balances/fractionnement/apply', { referencePeriod })
  return data
}

export async function recomputeFractionnement(referencePeriod) {
  const { data } = await apiClient.post('/leave-balances/fractionnement/recompute', { referencePeriod })
  return data
}

export async function getTakePeriodOverview(referencePeriod) {
  const { data } = await apiClient.get(`/leave-balances/take-period/${referencePeriod}`)
  return data
}

export async function listTakePeriodReports(referencePeriod) {
  const { data } = await apiClient.get(`/leave-balances/take-period/${referencePeriod}/reports`)
  return data
}

export async function createTakePeriodReport(payload) {
  const { data } = await apiClient.post('/leave-balances/take-period/report', payload)
  return data
}

export async function listReportDocuments() {
  const { data } = await apiClient.get('/documents/report')
  return data
}

export async function uploadReportDocument(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post('/documents/report', form)
  return data
}

export async function getSettingValue(key) {
  try {
    const { data } = await apiClient.get(`/settings/${encodeURIComponent(key)}`)
    return data?.settingValue ?? ''
  } catch (error) {
    if (error?.response?.status === 404) return ''
    throw error
  }
}

export async function patchSetting(key, value) {
  const { data } = await apiClient.patch(`/settings/${encodeURIComponent(key)}`, { settingValue: value })
  return data
}

export async function listLeaveTypes() {
  const { data } = await apiClient.get('/leave-types')
  return data
}

export async function previewArreteChevauchement(id) {
  const { data } = await apiClient.get(`/leave-balances/arret-chevauchement/${id}`)
  return data
}

export async function restoreArreteChevauchement(id) {
  const { data } = await apiClient.post(`/leave-balances/arret-chevauchement/${id}/restore`)
  return data
}

export async function reverseArreteChevauchement(id) {
  const { data } = await apiClient.post(`/leave-balances/arret-chevauchement/${id}/reverse`)
  return data
}

export async function updateLegalEntityConvention(id, payload) {
  const { data } = await apiClient.patch(`/legal-entities/${id}/convention`, payload)
  return data
}

export async function updateLeaveTypeAbsenceKind(id, absenceKind) {
  const { data } = await apiClient.patch(`/leave-types/${id}/absence-kind`, { absenceKind })
  return data
}
