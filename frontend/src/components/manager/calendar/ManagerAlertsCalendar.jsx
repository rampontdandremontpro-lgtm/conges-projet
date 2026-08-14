import { useMemo } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  buildMonthDays,
  dateInRange,
  formatMonthLabel,
  getCurrentDateKey,
  getCurrentMonthKey,
  getMonthDayMeta,
  getPersonColor,
} from '@/utils/managerCalendar'

function initials(person) {
  return `${person?.prenom?.[0] ?? ''}${person?.nom?.[0] ?? ''}`.toUpperCase()
}

function buildEvents(alerts) {
  const byKey = new Map()
  const primaryRequestIds = new Set(alerts.map(({ request }) => Number(request.id)))

  alerts.forEach(({ request, availability }) => {
    const primary = {
      key: `DEMANDE_CONGE-${request.id}`,
      employeeId: request.employee?.id ?? request.employeeId,
      nom: request.employee?.nom,
      prenom: request.employee?.prenom,
      source: 'DEMANDE_CONGE',
      sourceId: request.id,
      status: request.status,
      startDate: request.startDate,
      endDate: request.endDate,
      startPeriod: request.startPeriod,
      endPeriod: request.endPeriod,
      isPrimary: true,
    }
    byKey.set(primary.key, primary)

    ;(availability?.overlaps ?? []).forEach((item) => {
      const key = `${item.source}-${item.sourceId}`
      const existing = byKey.get(key)
      byKey.set(key, {
        ...item,
        key,
        isPrimary: existing?.isPrimary || (item.source === 'DEMANDE_CONGE' && primaryRequestIds.has(Number(item.sourceId))),
      })
    })
  })

  return [...byKey.values()]
}

function eventStatus(event) {
  return event?.source === 'DECLARATION_ABSENCE' ? 'ABSENT' : 'EN_VACANCES'
}

function occupiesHalf(event, date, period) {
  if (!dateInRange(date, event?.startDate, event?.endDate)) return false

  const startPeriod = event?.startPeriod ?? 'MATIN'
  const endPeriod = event?.endPeriod ?? 'APRES_MIDI'

  if (event.startDate === event.endDate) {
    if (startPeriod === 'MATIN' && endPeriod === 'MATIN') return period === 'MATIN'
    if (startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI') return period === 'APRES_MIDI'
    return true
  }

  if (date === event.startDate && startPeriod === 'APRES_MIDI') return period === 'APRES_MIDI'
  if (date === event.endDate && endPeriod === 'MATIN') return period === 'MATIN'
  return true
}

function resolveHalfStatus(events, date, period) {
  const active = events.filter((event) => occupiesHalf(event, date, period))
  if (active.some((event) => eventStatus(event) === 'ABSENT')) return 'ABSENT'
  if (active.some((event) => eventStatus(event) === 'EN_VACANCES')) return 'EN_VACANCES'
  return 'PRESENT'
}

function statusClass(status) {
  if (status === 'EN_VACANCES') return 'is-leave'
  if (status === 'ABSENT') return 'is-absence'
  return 'is-present'
}

function Half({ status, baseClass }) {
  return <span className={`manager-month-cell__half ${statusClass(status)} ${baseClass}`} />
}

export function ManagerAlertsCalendar({
  alerts,
  calendarData,
  month,
  onMonthChange,
  onOpenRequest,
}) {
  const monthDays = useMemo(() => buildMonthDays(month), [month])
  const events = useMemo(() => buildEvents(alerts), [alerts])
  const holidayByDate = useMemo(() => {
    const map = new Map()
    ;(calendarData?.holidays ?? []).forEach((holiday) => {
      if (!map.has(holiday.date)) map.set(holiday.date, [])
      map.get(holiday.date).push(holiday)
    })
    return map
  }, [calendarData?.holidays])
  const todayKey = getCurrentDateKey()

  const people = useMemo(() => {
    const map = new Map()
    ;(calendarData?.members ?? []).forEach((person) => {
      map.set(Number(person.id), person)
    })
    events.forEach((event) => {
      if (!map.has(Number(event.employeeId))) {
        map.set(Number(event.employeeId), {
          id: event.employeeId,
          nom: event.nom,
          prenom: event.prenom,
          role: null,
        })
      }
    })
    return [...map.values()].sort((a, b) => `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`, 'fr'))
  }, [calendarData?.members, events])

  const eventsByPerson = useMemo(() => {
    const map = new Map()
    events.forEach((event) => {
      const id = Number(event.employeeId)
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(event)
    })
    return map
  }, [events])

  const dayStats = useMemo(() => new Map(monthDays.map((date) => {
    const dayEvents = events.filter((event) => dateInRange(date, event.startDate, event.endDate))
    const peopleIds = new Set(dayEvents.map((event) => Number(event.employeeId)))
    return [date, { unavailable: peopleIds.size, overlap: peopleIds.size > 1 }]
  })), [events, monthDays])

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
            <small>Le mois de l’alerte est affiché. Les cellules entourées d’orange indiquent la zone réelle de chevauchement.</small>
          </div>
        </div>
        <div className="manager-calendar-nav">
          <button type="button" onClick={() => onMonthChange(-1)} aria-label="Mois précédent"><Icon name="chevronLeft" size={17} /></button>
          <button type="button" className="manager-calendar-nav__today" onClick={() => onMonthChange(0, getCurrentMonthKey())}>Aujourd’hui</button>
          <button type="button" onClick={() => onMonthChange(1)} aria-label="Mois suivant"><Icon name="chevronRight" size={17} /></button>
        </div>
      </div>

      <div className="manager-month-planning-wrap">
        <div className="manager-month-planning manager-month-planning--alerts" style={gridStyle}>
          <div className="manager-month-planning__corner">Équipe</div>

          {monthDays.map((date) => {
            const meta = getMonthDayMeta(date)
            const holidays = holidayByDate.get(date) ?? []
            const stats = dayStats.get(date)
            const isHoliday = holidays.length > 0
            const isToday = date === todayKey
            return (
              <div
                key={date}
                title={isHoliday ? holidays.map((holiday) => holiday.name).join(' · ') : undefined}
                className={`manager-month-planning__day-head${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}${stats?.overlap ? ' has-overlap' : ''}`}
              >
                <span>{meta.weekday}</span>
                <strong>{meta.day}</strong>
                {stats?.overlap && <i aria-label={`${stats.unavailable} personnes indisponibles`} />}
              </div>
            )
          })}

          {people.map((person) => {
            const personColor = getPersonColor(person)
            const personEvents = eventsByPerson.get(Number(person.id)) ?? []

            return (
              <div className="manager-month-planning__row" key={person.id}>
                <div className="manager-month-planning__person">
                  <span className="manager-month-planning__avatar" style={{ background: personColor.soft, color: personColor.solid }}>{initials(person)}</span>
                  <span className="manager-month-planning__person-copy">
                    <strong>{person.prenom} {person.nom}</strong>
                    <small>{person.role === 'RESPONSABLE_SERVICE' ? 'Responsable de service' : 'Collaborateur'}</small>
                  </span>
                </div>

                {monthDays.map((date) => {
                  const meta = getMonthDayMeta(date)
                  const holidays = holidayByDate.get(date) ?? []
                  const stats = dayStats.get(date)
                  const isHoliday = holidays.length > 0
                  const isToday = date === todayKey
                  const morningStatus = resolveHalfStatus(personEvents, date, 'MATIN')
                  const afternoonStatus = resolveHalfStatus(personEvents, date, 'APRES_MIDI')
                  const hasEvent = morningStatus !== 'PRESENT' || afternoonStatus !== 'PRESENT'
                  const overlap = hasEvent && stats?.overlap
                  const baseClass = isHoliday ? 'is-holiday' : isToday ? 'is-today' : meta.isWeekend ? 'is-weekend' : ''
                  const primary = personEvents.find((event) => event.isPrimary && dateInRange(date, event.startDate, event.endDate))
                  const commonClass = `manager-month-planning__cell${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}${overlap ? ' has-overlap' : ''}`
                  const content = (
                    <>
                      <Half status={morningStatus} baseClass={baseClass} />
                      <Half status={afternoonStatus} baseClass={baseClass} />
                      {overlap && <span className="manager-month-planning__overlap-mark">!</span>}
                    </>
                  )

                  if (primary) {
                    return (
                      <button
                        type="button"
                        key={`${person.id}-${date}`}
                        className={`${commonClass} is-clickable`}
                        onClick={() => onOpenRequest?.(primary.sourceId)}
                        title={`Ouvrir la demande de ${person.prenom} ${person.nom}`}
                      >
                        {content}
                      </button>
                    )
                  }

                  return (
                    <div key={`${person.id}-${date}`} className={commonClass}>
                      {content}
                    </div>
                  )
                })}
              </div>
            )
          })}

          <div className="manager-month-planning__footer-label">Indispo.</div>
          {monthDays.map((date) => {
            const meta = getMonthDayMeta(date)
            const holidays = holidayByDate.get(date) ?? []
            const stats = dayStats.get(date)
            const isHoliday = holidays.length > 0
            const isToday = date === todayKey
            return (
              <div
                key={`summary-${date}`}
                className={`manager-month-planning__footer-cell${meta.isWeekend ? ' is-weekend' : ''}${isHoliday ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}${stats?.overlap ? ' has-overlap' : ''}`}
              >
                <strong>{stats?.unavailable ?? 0}</strong>
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
        <span><i className="is-overlap" /> Chevauchement</span>
      </div>
    </section>
  )
}
