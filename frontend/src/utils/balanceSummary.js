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

  return findCounter(scoped, 'N-1') ?? findCounter(scoped, 'N') ?? scoped[0] ?? null
}

export function buildBalanceSummary(balances) {
  if (!balances || balances.length === 0) return null

  const referencePeriod = latestReferencePeriod(balances)
  const scoped = referencePeriod
    ? balances.filter((balance) => balance.referencePeriod === referencePeriod)
    : balances

  const usable = findCounter(scoped, 'N-1') ?? findCounter(scoped, 'N') ?? scoped[0] ?? null
  const acquisition = findCounter(scoped, 'N')

  if (!usable) return null

  const availableDays = numberValue(usable.availableDays)
  return {
    referencePeriod: usable.referencePeriod ?? referencePeriod,
    usableBalance: usable,
    acquisitionBalance: acquisition,
    availableDays,
    currentAccrualDays: numberValue(acquisition?.acquiredDays ?? acquisition?.availableDays),
  }
}
