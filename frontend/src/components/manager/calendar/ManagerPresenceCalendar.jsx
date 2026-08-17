import { useMemo } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  buildMonthDays,
  formatMonthLabel,
  getCurrentDateKey,
  getCurrentMonthKey,
  getMonthDayMeta,
  getPersonColor,
} from '@/utils/managerCalendar'

const STATUS_LABELS = {
  PRESENT: 'Présent',
  EN_VACANCES: 'Congé',
  ABSENT: 'Absence',
}

function initials(person) {
  return `${person?.prenom?.[0] ?? ''}${person?.nom?.[0] ?? ''}`.toUpperCase()
}

function getMemberDay(day, memberId) {
  return day?.members?.find((member) => Number(member.id) === Number(memberId)) ?? null
}

function memberMatchesFilter(member, daysByDate, monthDays, filter) {
  if (filter === 'all') return true

  const statuses = monthDays.flatMap((date) => {
    const memberDay = getMemberDay(daysByDate.get(date), member.id)
    return memberDay ? [memberDay.morningStatus, memberDay.afternoonStatus] : []
  })

  if (filter === 'PRESENT') return statuses.includes('PRESENT')
  return statuses.includes(filter)
}

function statusClass(status) {
  if (status === 'EN_VACANCES') return 'is-leave'
  if (status === 'ABSENT') return 'is-absence'
  return 'is-present'
}

function DaySlot({ status, baseClass }) {
  return <span className={`manager-month-cell__half ${statusClass(status)} ${baseClass}`} />
}

export function ManagerPresenceCalendar({ data, month, filter, onMonthChange }) {
  const monthDays = useMemo(() => buildMonthDays(month), [month])
  const daysByDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data?.days])
  const holidayByDate = useMemo(() => {
    const map = new Map()
    ;(data?.holidays ?? []).forEach((holiday) => {
      if (!map.has(holiday.date)) map.set(holiday.date, [])
      map.get(holiday.date).push(holiday)
    })
    return map
  }, [data?.holidays])
  const todayKey = getCurrentDateKey()
  const members = useMemo(
    () => (data?.members ?? []).filter((member) => memberMatchesFilter(member, daysByDate, monthDays, filter)),
    [data?.members, daysByDate, filter, monthDays],
  )
  const total = data?.totalMembers ?? data?.members?.length ?? 0
  const threshold = data?.service?.minimumPresence ?? null
  const gridStyle = {
    gridTemplateColumns: `170px repeat(${monthDays.length}, minmax(28px, 1fr))`,
    minWidth: `${170 + (monthDays.length * 29)}px`,
  }

  return (
    <section className="manager-calendar-card manager-calendar-card--monthly">
      <div className="manager-calendar-head">
        <div className="manager-calendar-head__title">
          <span className="manager-calendar-head__icon"><Icon name="calendar" size={18} /></span>
          <div>
            <strong>{formatMonthLabel(month)}</strong>
            <small>Planning mensuel de l’équipe.</small>
          </div>
        </div>
        <div className="manager-calendar-nav">
          <button type="button" onClick={() => onMonthChange(-1)} aria-label="Mois précédent"><Icon name="chevronLeft" size={17} /></button>
          <button type="button" className="manager-calendar-nav__today" onClick={() => onMonthChange(0, getCurrentMonthKey())}>Aujourd’hui</button>
          <button type="button" onClick={() => onMonthChange(1)} aria-label="Mois suivant"><Icon name="chevronRight" size={17} /></button>
        </div>
      </div>

      <div className="manager-month-planning-wrap">
        <div className="manager-month-planning" style={gridStyle}>
          <div className="manager-month-planning__corner">Équipe</div>

          {monthDays.map((date) => {
            const meta = getMonthDayMeta(date)
            const holidays = holidayByDate.get(date) ?? []
            const isHoliday = holidays.length > 0
            const isToday = date === todayKey
            const title = isHoliday ? holidays.map((holiday) => holiday.name).join(' · ') : undefined
            return (
              <div
                key={date}
                title={title}
                className={`manager-month-planning__day-head${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}`}
              >
                <span>{meta.weekday}</span>
                <strong>{meta.day}</strong>
              </div>
            )
          })}

          {members.map((member) => {
            const personColor = getPersonColor(member)
            return (
              <div className="manager-month-planning__row" key={member.id}>
                <div className="manager-month-planning__person">
                  <span className="manager-month-planning__avatar" style={{ background: personColor.soft, color: personColor.solid }}>{initials(member)}</span>
                  <span className="manager-month-planning__person-copy">
                    <strong>{member.prenom} {member.nom}</strong>
                    <small>{member.role === 'RESPONSABLE_SERVICE' ? 'Responsable de service' : 'Collaborateur'}</small>
                  </span>
                </div>

                {monthDays.map((date) => {
                  const meta = getMonthDayMeta(date)
                  const day = daysByDate.get(date)
                  const memberDay = getMemberDay(day, member.id) ?? { morningStatus: 'PRESENT', afternoonStatus: 'PRESENT' }
                  const holidays = holidayByDate.get(date) ?? []
                  const isHoliday = holidays.length > 0
                  const isToday = date === todayKey
                  const baseClass = isHoliday ? 'is-holiday' : isToday ? 'is-today' : meta.isWeekend ? 'is-weekend' : ''
                  const label = memberDay.morningStatus === memberDay.afternoonStatus
                    ? STATUS_LABELS[memberDay.morningStatus]
                    : `Matin : ${STATUS_LABELS[memberDay.morningStatus]} · Après-midi : ${STATUS_LABELS[memberDay.afternoonStatus]}`
                  const holidayLabel = isHoliday ? ` · ${holidays.map((holiday) => holiday.name).join(', ')}` : ''

                  return (
                    <div
                      key={`${member.id}-${date}`}
                      className={`manager-month-planning__cell${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}`}
                      title={`${member.prenom} ${member.nom} · ${date} · ${label}${holidayLabel}`}
                    >
                      <DaySlot status={memberDay.morningStatus} baseClass={baseClass} />
                      <DaySlot status={memberDay.afternoonStatus} baseClass={baseClass} />
                    </div>
                  )
                })}
              </div>
            )
          })}

          <div className="manager-month-planning__footer-label">Présents</div>
          {monthDays.map((date) => {
            const meta = getMonthDayMeta(date)
            const day = daysByDate.get(date)
            const holidays = holidayByDate.get(date) ?? []
            const isHoliday = holidays.length > 0
            const isToday = date === todayKey
            const risk = day && (!day.morningMinimumRespected || !day.afternoonMinimumRespected)
            const skip = meta.isWeekend || isHoliday
            return (
              <div
                key={`summary-${date}`}
                className={`manager-month-planning__footer-cell${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}${risk && !skip ? ' has-risk' : ''}`}
              >
                {skip ? (
                  <strong>—</strong>
                ) : (
                  <>
                    <strong>{day?.morningPresent ?? total}/{total}</strong>
                    <small>{day?.morningPresent === day?.afternoonPresent ? 'M/AM' : `AM ${day?.afternoonPresent ?? total}/${total}`}</small>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="manager-month-planning__legend">
        <span><i className="is-present" /> Présent</span>
        <span><i className="is-leave" /> Congé</span>
        <span><i className="is-absence" /> Absence</span>
        <span><i className="is-weekend" /> Week-end</span>
        <span><i className="is-holiday" /> Jour férié / fermeture</span>
        <span><i className="is-today" /> Aujourd’hui</span>
      </div>
    </section>
  )
}
