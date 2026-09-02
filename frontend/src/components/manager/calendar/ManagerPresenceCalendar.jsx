import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { useMemo } from 'react'

import { Icon } from '@/components/ui/Icon'
import { memberMatchesPresenceSituation } from '@/utils/globalPresenceSituation'
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

const ROLE_LABELS = {
  COLLABORATEUR: 'Collaborateur',
  RESPONSABLE_SERVICE: 'Responsable de service',
  RH: 'RH',
  DIRECTEUR: 'Directeur',
}

function memberSubtitle(member) {
  const role = ROLE_LABELS[member?.role] ?? 'Collaborateur'
  return member?.serviceName ? `${role} · ${member.serviceName}` : role
}


function getMemberDay(day, memberId) {
  return day?.members?.find((member) => Number(member.id) === Number(memberId)) ?? null
}

function statusClass(status) {
  if (status === 'EN_VACANCES') return 'is-leave'
  if (status === 'ABSENT') return 'is-absence'
  return 'is-present'
}

function DaySlot({ status, baseClass }) {
  return <span className={`manager-month-cell__half ${statusClass(status)} ${baseClass}`} />
}

export function ManagerPresenceCalendar({ data, month, filter, onMonthChange, currentUserId, onPendingRequestClick }) {
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
    () => (data?.members ?? []).filter((member) => memberMatchesPresenceSituation(member, data?.days ?? [], filter)),
    [data?.days, data?.members, filter],
  )
  const total = data?.totalMembers ?? data?.members?.length ?? 0
  const threshold = data?.service?.minimumPresence ?? null
  const isGlobal = !data?.service
  const gridStyle = {
    gridTemplateColumns: `190px repeat(${monthDays.length}, minmax(38px, 1fr))`,
    minWidth: `${190 + (monthDays.length * 38)}px`,
  }

  return (
    <section className="manager-calendar-card manager-calendar-card--monthly">
      <div className="manager-calendar-head">
        <div className="manager-calendar-head__title">
          <div>
            <strong>{formatMonthLabel(month)}</strong>
            <small>{isGlobal ? 'Planning mensuel de tous les services.' : 'Planning mensuel de l’équipe.'}</small>
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
          <div className="manager-month-planning__corner">{isGlobal ? 'Tous' : 'Équipe'}</div>

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
                  <ProfileAvatar user={member} className="manager-month-planning__avatar" style={{ background: personColor.soft, color: personColor.solid }} />
                  <span className="manager-month-planning__person-copy">
                    <strong>{member.nom} {member.prenom}</strong>
                    <small>{memberSubtitle(member)}</small>
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
                  const pendingRequestIds = [...new Set([
                    ...(memberDay.morningPendingRequestIds ?? []),
                    ...(memberDay.afternoonPendingRequestIds ?? []),
                  ])]
                  const pendingLabel = pendingRequestIds.length > 0
                    ? ` · ${pendingRequestIds.length} demande${pendingRequestIds.length > 1 ? 's' : ''} en attente de validation`
                    : ''
                  const isOwnPendingRequest = pendingRequestIds.length > 0 && Number(member.id) === Number(currentUserId)

                  return (
                    <div
                      key={`${member.id}-${date}`}
                      className={`manager-month-planning__cell${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}${pendingRequestIds.length > 0 ? ' has-pending-request' : ''}`}
                      title={`${member.nom} ${member.prenom} · ${date} · ${label}${holidayLabel}${pendingLabel}`}
                    >
                      <DaySlot status={memberDay.morningStatus} baseClass={baseClass} />
                      <DaySlot status={memberDay.afternoonStatus} baseClass={baseClass} />
                      {pendingRequestIds.length > 0 && (
                        isOwnPendingRequest ? (
                          <span
                            className="manager-month-planning__pending-request is-readonly"
                            title="Votre demande est en attente — elle doit être validée par un autre valideur"
                            aria-label="Votre demande est en attente de validation par un autre valideur"
                          >
                            <Icon name="clock" size={10} />
                            {pendingRequestIds.length > 1 ? pendingRequestIds.length : ''}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="manager-month-planning__pending-request"
                            title="Demande en attente — cliquer pour valider"
                            aria-label={`Valider la demande en attente de ${member.nom} ${member.prenom}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onPendingRequestClick?.(pendingRequestIds[0])
                            }}
                          >
                            <Icon name="clock" size={10} />
                            {pendingRequestIds.length > 1 ? pendingRequestIds.length : ''}
                          </button>
                        )
                      )}
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
                    {day?.morningPresent !== day?.afternoonPresent && (
                      <small>AM {day?.afternoonPresent ?? total}/{total}</small>
                    )}
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
        <span><i className="is-pending" /> En attente de validation</span>
        <span><i className="is-absence" /> Absence</span>
        <span><i className="is-weekend" /> Week-end</span>
        <span><i className="is-holiday" /> Jour férié / fermeture</span>
        <span><i className="is-today" /> Aujourd’hui</span>
      </div>
    </section>
  )
}
