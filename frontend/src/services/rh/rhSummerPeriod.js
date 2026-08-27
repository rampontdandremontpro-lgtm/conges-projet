import { apiClient } from '@/services/apiClient'

function settingsToMap(settings) {
  if (!Array.isArray(settings)) return {}

  return settings.reduce((accumulator, setting) => {
    if (setting?.settingKey) {
      accumulator[setting.settingKey] = setting.settingValue
    }
    return accumulator
  }, {})
}

export async function getRhSummerPeriodConfiguration() {
  const [{ data: seasonal }, { data: settings }] = await Promise.all([
    apiClient.get('/settings/seasonal-period'),
    apiClient.get('/settings/public'),
  ])

  return {
    seasonal,
    settings: settingsToMap(settings),
  }
}

export async function updateRhSummerPeriodConfiguration({
  summerPeriodStart,
  summerPeriodEnd,
  specialDeadlineDays,
  normalDeadlineDays,
  longLeaveThreshold,
}) {
  await Promise.all([
    apiClient.patch('/settings/seasonal-period', {
      summerPeriodStart,
      summerPeriodEnd,
    }),
    apiClient.patch('/settings/SPECIAL_REQUEST_DEADLINE_DAYS', { settingValue: String(specialDeadlineDays) }),
    apiClient.patch('/settings/NORMAL_REQUEST_DEADLINE_DAYS', { settingValue: String(normalDeadlineDays) }),
    apiClient.patch('/settings/SPECIAL_DURATION_THRESHOLD_DAYS', { settingValue: String(longLeaveThreshold) }),
  ])

  return getRhSummerPeriodConfiguration()
}
