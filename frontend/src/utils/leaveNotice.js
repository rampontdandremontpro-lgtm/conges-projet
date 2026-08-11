const DAY_MS = 24 * 60 * 60 * 1000

export function parseUTCDate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

export function calendarDurationOf(startIso, endIso) {
  return (
    Math.round(
      (parseUTCDate(endIso).getTime() - parseUTCDate(startIso).getTime()) /
        DAY_MS,
    ) + 1
  )
}

export function buildNoticeRules(settings, seasonal) {
  return {
    normalDeadlineDays: Number(settings?.NORMAL_REQUEST_DEADLINE_DAYS) || 30,
    specialDeadlineDays: Number(settings?.SPECIAL_REQUEST_DEADLINE_DAYS) || 60,
    specialDurationThresholdDays:
      Number(settings?.SPECIAL_DURATION_THRESHOLD_DAYS) || 21,
    derogationLastAllowedDay:
      Number(settings?.DEROGATION_LAST_ALLOWED_DAY) || 3,
    summerPeriodStart: seasonal?.summerPeriodStart ?? '05-01',
    summerPeriodEnd: seasonal?.summerPeriodEnd ?? '10-31',
  }
}

export function todayUTCDate() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )
}

export function evaluateNotice({ startIso, endIso, settings, seasonal }) {
  const rules = buildNoticeRules(settings, seasonal)
  const startDate = parseUTCDate(startIso)
  const endDate = parseUTCDate(endIso)
  const today = todayUTCDate()

  const daysBeforeStart = Math.floor(
    (startDate.getTime() - today.getTime()) / DAY_MS,
  )
  const duration = calendarDurationOf(startIso, endIso)
  const isLongLeave = duration >= rules.specialDurationThresholdDays
  const overlapsSummerPeriod = overlapsConfiguredPeriod(
    startDate,
    endDate,
    rules.summerPeriodStart,
    rules.summerPeriodEnd,
  )
  const requiredNoticeDays =
    isLongLeave || overlapsSummerPeriod
      ? rules.specialDeadlineDays
      : rules.normalDeadlineDays

  return {
    daysBeforeStart,
    requiredNoticeDays,
    isLongLeave,
    overlapsSummerPeriod,
    isNoticeCompliant: daysBeforeStart >= requiredNoticeDays,
    isDerogationWindow:
      daysBeforeStart >= rules.derogationLastAllowedDay &&
      daysBeforeStart < rules.normalDeadlineDays,
  }
}

function overlapsConfiguredPeriod(startDate, endDate, periodStart, periodEnd) {
  const [startMonth, startDay] = periodStart.split('-').map(Number)
  const [endMonth, endDay] = periodEnd.split('-').map(Number)

  for (
    let year = startDate.getUTCFullYear() - 1;
    year <= endDate.getUTCFullYear() + 1;
    year += 1
  ) {
    const configuredStart = new Date(Date.UTC(year, startMonth - 1, startDay))
    const endYear =
      endMonth < startMonth ||
      (endMonth === startMonth && endDay < startDay)
        ? year + 1
        : year
    const configuredEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay))

    if (
      startDate.getTime() <= configuredEnd.getTime() &&
      endDate.getTime() >= configuredStart.getTime()
    ) {
      return true
    }
  }

  return false
}
