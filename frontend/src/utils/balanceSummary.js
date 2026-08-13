function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function latestReferencePeriod(balances) {
  const periods = [...new Set((balances ?? []).map((balance) => balance.referencePeriod).filter(Boolean))]
  return periods.sort((left, right) => right.localeCompare(left))[0] ?? null
}

function findCounter(balances, counterType) {
  return balances.find((balance) => balance.counterType === counterType) ?? null
}

export function selectUsableBalance(balances) {
  if (!balances || balances.length === 0) return null

  const period = latestReferencePeriod(balances)
  const scoped = period
    ? balances.filter((balance) => balance.referencePeriod === period)
    : balances

  return (
    findCounter(scoped, 'N-1') ??
    findCounter(scoped, 'N') ??
    scoped[0] ??
    null
  )
}

export function buildBalanceSummary(balances) {
  if (!balances || balances.length === 0) return null

  const referencePeriod = latestReferencePeriod(balances)
  const scoped = referencePeriod
    ? balances.filter((balance) => balance.referencePeriod === referencePeriod)
    : balances

  const nMinus1 = findCounter(scoped, 'N-1')
  const n = findCounter(scoped, 'N')
  const nPlus1 = findCounter(scoped, 'N+1')
  const usable = nMinus1 ?? n ?? scoped[0] ?? null

  if (!usable) return null

  const availableDays = numberValue(usable.availableDays)
  const reservedDays = numberValue(usable.reservedDays)
  const potentialDays = Number.isFinite(Number(usable.potentialDays))
    ? Number(usable.potentialDays)
    : Math.max(0, availableDays - reservedDays)

  const currentAccrualDays = numberValue(n?.acquiredDays ?? n?.availableDays)
  const forecastDays = numberValue(nPlus1?.availableDays ?? nPlus1?.acquiredDays)

  return {
    referencePeriod: usable.referencePeriod ?? referencePeriod,
    usableBalance: usable,
    availableDays,
    reservedDays,
    potentialDays,
    acquiredUsableDays: numberValue(usable.acquiredDays),
    currentAccrualDays,
    forecastDays,
    counters: {
      nMinus1,
      n,
      nPlus1,
    },
  }
}
