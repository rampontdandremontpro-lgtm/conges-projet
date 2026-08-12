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
  const current = balances.find((balance) => balance.counterType === 'N')
  if (current) return current
  return [...balances].sort((a, b) =>
    b.referencePeriod.localeCompare(a.referencePeriod),
  )[0]
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
