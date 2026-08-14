import { useMemo } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  buildMonthGrid,
  dateInRange,
  formatMonthLabel,
  getCurrentMonthKey,
  getPersonColor,
  WEEKDAY_LABELS,
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

function eventLabel(event) {
  return event.source === 'DECLARATION_ABSENCE' ? 'Absence' : 'Congé'
}

function slotLabel(event, date) {
  const start = event.startPeriod ?? 'MATIN'
  const end = event.endPeriod ?? 'APRES_MIDI'
  if (event.startDate === event.endDate) {
    if (start === 'MATIN' && end === 'MATIN') return 'Matin'
    if (start === 'APRES_MIDI' && end === 'APRES_MIDI') return 'Après-midi'
    return ''
  }
  if (date === event.startDate && start === 'APRES_MIDI') return 'Après-midi'
  if (date === event.endDate && end === 'MATIN') return 'Matin'
  return ''
}

export function ManagerAlertsCalendar({ alerts, month, onMonthChange, onOpenRequest }) {
  const cells = useMemo(() => buildMonthGrid(month), [month])
  const events = useMemo(() => buildEvents(alerts), [alerts])
  const people = useMemo(() => {
    const map = new Map()
    events.forEach((event) => {
      if (!map.has(event.employeeId)) {
        map.set(event.employeeId, {
          id: event.employeeId,
          nom: event.nom,
          prenom: event.prenom,
        })
      }
    })
    return [...map.values()].sort((a, b) => `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`, 'fr'))
  }, [events])

  return (
    <section className="manager-calendar-card manager-calendar-card--alerts">
      <div className="manager-calendar-head">
        <div className="manager-calendar-head__title">
          <span className="manager-calendar-head__icon"><Icon name="calendar" size={18} /></span>
          <div>
            <strong>{formatMonthLabel(month)}</strong>
            <small>Les zones orange signalent les jours où plusieurs indisponibilités se recouvrent.</small>
          </div>
        </div>
        <div className="manager-calendar-nav">
          <button type="button" onClick={() => onMonthChange(-1)} aria-label="Mois précédent"><Icon name="chevronLeft" size={17} /></button>
          <button type="button" className="manager-calendar-nav__today" onClick={() => onMonthChange(0, getCurrentMonthKey())}>Aujourd’hui</button>
          <button type="button" onClick={() => onMonthChange(1)} aria-label="Mois suivant"><Icon name="chevronRight" size={17} /></button>
        </div>
      </div>

      <div className="manager-calendar-legend" aria-label="Légende des collaborateurs">
        {people.map((person) => {
          const color = getPersonColor(person)
          return (
            <span key={person.id} className="manager-calendar-legend__person">
              <i style={{ background: color.solid }} />
              <b>{initials(person)}</b>
              <span>{person.prenom} {person.nom}</span>
            </span>
          )
        })}
      </div>

      <div className="manager-calendar-grid manager-calendar-grid--alerts">
        {WEEKDAY_LABELS.map((label) => <div className="manager-calendar-weekday" key={label}>{label}</div>)}
        {cells.map((date, index) => {
          if (!date) return <div className="manager-calendar-day is-empty" key={`empty-${index}`} />
          const dayEvents = events.filter((event) => dateInRange(date, event.startDate, event.endDate))
          const uniquePeople = new Set(dayEvents.map((event) => event.employeeId))
          const hasOverlap = uniquePeople.size > 1
          const visible = dayEvents.slice(0, 3)
          const extra = Math.max(dayEvents.length - visible.length, 0)

          return (
            <div className={`manager-calendar-day${hasOverlap ? ' has-overlap' : ''}`} key={date}>
              <div className="manager-calendar-day__number">
                <span>{Number(date.slice(-2))}</span>
                {hasOverlap && <span className="manager-calendar-overlap-badge">{uniquePeople.size} pers.</span>}
              </div>
              <div className="manager-calendar-day__events">
                {visible.map((event) => {
                  const person = { id: event.employeeId, nom: event.nom, prenom: event.prenom }
                  const color = getPersonColor(person)
                  const slot = slotLabel(event, date)
                  const canOpen = event.source === 'DEMANDE_CONGE' && event.isPrimary
                  const Component = canOpen ? 'button' : 'div'
                  return (
                    <Component
                      key={event.key}
                      type={canOpen ? 'button' : undefined}
                      className="manager-calendar-event"
                      style={{ '--person-color': color.solid, '--person-soft': color.soft }}
                      title={`${person.prenom} ${person.nom} — ${eventLabel(event)}${slot ? ` (${slot})` : ''}`}
                      onClick={canOpen ? () => onOpenRequest(event.sourceId) : undefined}
                    >
                      <span className="manager-calendar-event__dot" />
                      <strong>{person.prenom}</strong>
                      <small>{eventLabel(event)}{slot ? ` · ${slot}` : ''}</small>
                    </Component>
                  )
                })}
                {extra > 0 && <span className="manager-calendar-day__extra">+{extra} autre{extra > 1 ? 's' : ''}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
