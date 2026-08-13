import { todayISO } from '@/utils/format'

export function currentMonth() {
  const [year, month] = todayISO().split('-').map(Number)
  return { year, month: month - 1 }
}

export function nextMonthOf({ year, month }) {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}

export function prevMonthOf({ year, month }) {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
}

export function selectPrimaryBalance(balances) {
  if (!balances || balances.length === 0) return null

  const latestPeriod = [...new Set(balances.map((balance) => balance.referencePeriod).filter(Boolean))]
    .sort((left, right) => right.localeCompare(left))[0]
  const scoped = latestPeriod
    ? balances.filter((balance) => balance.referencePeriod === latestPeriod)
    : balances

  return (
    scoped.find((balance) => balance.counterType === 'N-1') ??
    scoped.find((balance) => balance.counterType === 'N') ??
    scoped[0] ??
    null
  )
}

export function settingsMap(settings) {
  return Object.fromEntries(
    (settings ?? []).map((setting) => [setting.settingKey, setting.settingValue]),
  )
}

export function errorMessage(error) {
  const data = error?.response?.data
  if (Array.isArray(data?.message)) {
    return data.message.join(' — ')
  }
  if (typeof data?.message === 'string') {
    return data.message
  }
  return error?.message ?? 'Une erreur est survenue.'
}
