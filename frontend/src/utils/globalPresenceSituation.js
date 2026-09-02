export const PRESENCE_SITUATIONS = Object.freeze({
  ALL: 'all',
  PRESENT: 'PRESENT',
  PENDING: 'PENDING',
  LEAVE: 'EN_VACANCES',
  ABSENCE: 'ABSENT',
})

function memberDayFor(day, memberId) {
  return day?.members?.find((entry) => Number(entry.id) === Number(memberId)) ?? null
}

export function memberMatchesPresenceSituation(member, days = [], situation = PRESENCE_SITUATIONS.ALL) {
  if (situation === PRESENCE_SITUATIONS.ALL) return true

  return days.some((day) => {
    const memberDay = memberDayFor(day, member?.id)
    if (!memberDay) return false

    if (situation === PRESENCE_SITUATIONS.PENDING) {
      return (memberDay.morningPendingRequestIds?.length ?? 0) > 0 ||
        (memberDay.afternoonPendingRequestIds?.length ?? 0) > 0
    }

    return memberDay.morningStatus === situation || memberDay.afternoonStatus === situation
  })
}
