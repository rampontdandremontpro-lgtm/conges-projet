import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  buildMonthGrid,
  formatMonthLabel,
  formatShortDateFR,
  getCurrentMonthKey,
  getPersonColor,
  WEEKDAY_LABELS,
} from '@/utils/managerCalendar'

const STATUS_META = {
  PRESENT: { label: 'Présent', short: 'Présent' },
  EN_VACANCES: { label: 'En congés', short: 'Congé' },
  ABSENT: { label: 'Absent', short: 'Absence' },
}

function initials(person) {
  return `${person?.prenom?.[0] ?? ''}${person?.nom?.[0] ?? ''}`.toUpperCase()
}

function memberStatusLabel(memberDay) {
  if (memberDay.morningStatus === memberDay.afternoonStatus) {
    return STATUS_META[memberDay.morningStatus]?.short ?? memberDay.morningStatus
  }
  const parts = []
  if (memberDay.morningStatus !== 'PRESENT') parts.push(`Matin : ${STATUS_META[memberDay.morningStatus]?.short ?? memberDay.morningStatus}`)
  if (memberDay.afternoonStatus !== 'PRESENT') parts.push(`Après-midi : ${STATUS_META[memberDay.afternoonStatus]?.short ?? memberDay.afternoonStatus}`)
  return parts.join(' · ') || 'Présent'
}

function matchesCalendarFilter(memberDay, filter) {
  if (filter === 'all') return memberDay.morningStatus !== 'PRESENT' || memberDay.afternoonStatus !== 'PRESENT'
  return memberDay.morningStatus === filter || memberDay.afternoonStatus === filter
}

export function ManagerPresenceCalendar({ data, month, filter, onMonthChange }) {
  const cells = useMemo(() => buildMonthGrid(month), [month])
  const daysByDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data?.days])
  const membersById = useMemo(() => new Map((data?.members ?? []).map((member) => [Number(member.id), member])), [data?.members])
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const initialSelected = month === todayKey.slice(0, 7) ? todayKey : `${month}-01`
  const [selectedDate, setSelectedDate] = useState(initialSelected)

  useEffect(() => {
    setSelectedDate(initialSelected)
  }, [initialSelected])

  const selectedDay = daysByDate.get(selectedDate) ?? null
  const selectedMembers = selectedDay?.members ?? []

  return (
    <section className="manager-calendar-card manager-calendar-card--presence">
      <div className="manager-calendar-head">
        <div className="manager-calendar-head__title">
          <span className="manager-calendar-head__icon"><Icon name="calendar" size={18} /></span>
          <div>
            <strong>{formatMonthLabel(month)}</strong>
            <small>Visualisez les congés, absences et demi-journées de l’équipe sur le mois.</small>
          </div>
        </div>
        <div className="manager-calendar-nav">
          <button type="button" onClick={() => onMonthChange(-1)} aria-label="Mois précédent"><Icon name="chevronLeft" size={17} /></button>
          <button type="button" className="manager-calendar-nav__today" onClick={() => onMonthChange(0, getCurrentMonthKey())}>Aujourd’hui</button>
          <button type="button" onClick={() => onMonthChange(1)} aria-label="Mois suivant"><Icon name="chevronRight" size={17} /></button>
        </div>
      </div>

      <div className="manager-calendar-legend manager-calendar-legend--presence">
        {(data?.members ?? []).map((person) => {
          const color = getPersonColor(person)
          return (
            <span key={person.id} className="manager-calendar-legend__person">
              <i style={{ background: color.solid }} />
              <b>{initials(person)}</b>
              <span>{person.prenom} {person.nom}</span>
            </span>
          )
        })}
        <span className="manager-calendar-status-key"><i className="is-leave" /> Congé</span>
        <span className="manager-calendar-status-key"><i className="is-absence" /> Absence</span>
        <span className="manager-calendar-status-key"><i className="is-risk" /> Seuil à risque</span>
      </div>

      <div className="manager-calendar-grid manager-calendar-grid--presence">
        {WEEKDAY_LABELS.map((label) => <div className="manager-calendar-weekday" key={label}>{label}</div>)}
        {cells.map((date, index) => {
          if (!date) return <div className="manager-calendar-day is-empty" key={`empty-${index}`} />
          const day = daysByDate.get(date)
          const dayMembers = day?.members ?? []
          const displayed = dayMembers.filter((memberDay) => matchesCalendarFilter(memberDay, filter))
          const risk = day && (!day.morningMinimumRespected || !day.afternoonMinimumRespected)
          const visible = displayed.slice(0, 3)
          const extra = Math.max(displayed.length - visible.length, 0)
          const total = data?.totalMembers ?? data?.members?.length ?? 0
          const selected = selectedDate === date

          return (
            <button
              type="button"
              key={date}
              className={`manager-calendar-day manager-calendar-day--selectable${risk ? ' has-risk' : ''}${selected ? ' is-selected' : ''}`}
              onClick={() => setSelectedDate(date)}
            >
              <div className="manager-calendar-day__number">
                <span>{Number(date.slice(-2))}</span>
                {risk && <span className="manager-calendar-risk-badge"><Icon name="alert" size={11} /> Risque</span>}
              </div>
              <div className="manager-calendar-day__events">
                {visible.map((memberDay) => {
                  const person = membersById.get(Number(memberDay.id))
                  if (!person) return null
                  const color = getPersonColor(person)
                  return (
                    <span
                      key={memberDay.id}
                      className="manager-calendar-event"
                      style={{ '--person-color': color.solid, '--person-soft': color.soft }}
                    >
                      <span className="manager-calendar-event__dot" />
                      <strong>{person.prenom}</strong>
                      <small>{memberStatusLabel(memberDay)}</small>
                    </span>
                  )
                })}
                {extra > 0 && <span className="manager-calendar-day__extra">+{extra} autre{extra > 1 ? 's' : ''}</span>}
              </div>
              <span className="manager-calendar-day__coverage">
                M {day?.morningPresent ?? total}/{total} · AM {day?.afternoonPresent ?? total}/{total}
              </span>
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div className="manager-calendar-detail">
          <div className="manager-calendar-detail__head">
            <div>
              <span>Journée sélectionnée</span>
              <strong>{formatShortDateFR(selectedDate)}</strong>
            </div>
            <div className={`manager-calendar-detail__coverage${(!selectedDay.morningMinimumRespected || !selectedDay.afternoonMinimumRespected) ? ' is-risk' : ''}`}>
              Matin {selectedDay.morningPresent}/{data.totalMembers ?? data.members.length} · Après-midi {selectedDay.afternoonPresent}/{data.totalMembers ?? data.members.length}
            </div>
          </div>
          <div className="manager-calendar-detail__members">
            {selectedMembers.map((memberDay) => {
              const person = membersById.get(Number(memberDay.id))
              if (!person) return null
              const color = getPersonColor(person)
              return (
                <div className="manager-calendar-detail-member" key={memberDay.id}>
                  <span className="manager-calendar-detail-member__avatar" style={{ background: color.soft, color: color.solid }}>{initials(person)}</span>
                  <div className="manager-calendar-detail-member__identity">
                    <strong>{person.prenom} {person.nom}</strong>
                    <small>{person.role === 'RESPONSABLE_SERVICE' ? 'Responsable de service' : 'Collaborateur'}</small>
                  </div>
                  <span className={`manager-calendar-detail-member__slot is-${memberDay.morningStatus.toLowerCase()}`}>Matin · {STATUS_META[memberDay.morningStatus]?.label}</span>
                  <span className={`manager-calendar-detail-member__slot is-${memberDay.afternoonStatus.toLowerCase()}`}>Après-midi · {STATUS_META[memberDay.afternoonStatus]?.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
