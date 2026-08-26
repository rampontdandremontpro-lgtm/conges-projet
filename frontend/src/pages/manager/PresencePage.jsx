import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import { ManagerPresenceCalendar } from '@/components/manager/calendar/ManagerPresenceCalendar'
import { ManagerPresenceMemberCard } from '@/components/manager/presence/ManagerPresenceMemberCard'
import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import {
  getManagerServicePresence,
  getManagerServicePresenceCalendar,
} from '@/services/manager/managerDashboard'
import {
  getManagerRequest,
  getManagerRequestAvailability,
  validateManagerRequest,
} from '@/services/manager/managerRequests'
import { getCurrentMonthKey, shiftMonthKey } from '@/utils/managerCalendar'

import '@/styles/manager/presence/index.css'

const PAGE_SIZE = 8

const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'PRESENT', label: 'Présents' },
  { id: 'EN_VACANCES', label: 'En vacances' },
  { id: 'ABSENT', label: 'Absents' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function formatDateFR(value) {
  if (!value) return 'Aujourd’hui'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function countSlotPresent(members, slotName) {
  return members.filter((member) => member.dailyAvailability?.[slotName]?.status === 'PRESENT').length
}

export function ManagerPresencePage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState('calendar')
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonthKey())
  const [state, setState] = useState({ loading: true, error: false, data: null })
  const [calendarState, setCalendarState] = useState({ loading: false, error: false, data: null })
  const [calendarDecision, setCalendarDecision] = useState(null)
  const [decisionLoading, setDecisionLoading] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [decisionSubmitting, setDecisionSubmitting] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getManagerServicePresence()
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [])

  const loadCalendar = useCallback(async (month) => {
    setCalendarState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getManagerServicePresenceCalendar(month)
      setCalendarState({ loading: false, error: false, data })
    } catch {
      setCalendarState({ loading: false, error: true, data: null })
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = () => {
      load()
      if (viewMode === 'calendar') loadCalendar(calendarMonth)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [calendarMonth, load, loadCalendar, viewMode])

  useEffect(() => {
    if (viewMode === 'calendar') loadCalendar(calendarMonth)
  }, [calendarMonth, loadCalendar, viewMode])

  useEffect(() => {
    if (!actionFeedback) return undefined
    const timer = window.setTimeout(() => setActionFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [actionFeedback])

  const openCalendarValidation = useCallback(async (requestId) => {
    setDecisionLoading(true)
    setActionFeedback(null)
    try {
      const [request, availability] = await Promise.all([
        getManagerRequest(requestId),
        getManagerRequestAvailability(requestId),
      ])
      setCalendarDecision({
        request,
        availability,
        justification: '',
      })
    } catch (error) {
      setActionFeedback({
        error: true,
        text: error?.response?.data?.message ?? 'Cette demande ne peut pas être traitée depuis le calendrier.',
      })
    } finally {
      setDecisionLoading(false)
    }
  }, [])

  const confirmCalendarValidation = useCallback(async (signatureType, signatureData) => {
    if (!calendarDecision?.request?.id) return
    setDecisionSubmitting(true)
    try {
      const result = await validateManagerRequest(calendarDecision.request.id, {
        signatureType,
        signatureData,
        minimumPresenceJustification: calendarDecision.justification?.trim() || undefined,
      })
      const sentToRh = result?.workflowStatus === 'EN_COURS_TRAITEMENT'
      setSignatureOpen(false)
      setCalendarDecision(null)
      setActionFeedback({
        error: false,
        text: sentToRh
          ? 'Demande validée au premier niveau et transmise à la RH.'
          : 'Demande validée avec succès.',
      })
      await Promise.all([load(), loadCalendar(calendarMonth)])
      window.dispatchEvent(new CustomEvent('gmes:data-changed'))
    } catch (error) {
      setActionFeedback({
        error: true,
        text: error?.response?.data?.message ?? 'La validation a échoué.',
      })
    } finally {
      setDecisionSubmitting(false)
    }
  }, [calendarDecision, calendarMonth, load, loadCalendar])

  const members = state.data?.members ?? []
  const summary = state.data?.summary ?? { total: 0, present: 0, onLeave: 0, absent: 0 }
  const service = state.data?.service
  const threshold = service?.hasMinimumPresenceRule ? service.minimumPresence : null
  const thresholdOk = threshold == null || summary.present >= threshold
  const margin = threshold == null ? null : summary.present - threshold
  const query = searchParams.get('q') ?? ''

  const counts = useMemo(() => ({
    all: members.length,
    PRESENT: members.filter((member) => member.presenceStatus === 'PRESENT').length,
    EN_VACANCES: members.filter((member) => member.presenceStatus === 'EN_VACANCES').length,
    ABSENT: members.filter((member) => member.presenceStatus === 'ABSENT').length,
  }), [members])

  const visibleMembers = useMemo(() => {
    const normalizedQuery = normalize(query)

    return members.filter((member) => {
      if (filter !== 'all' && member.presenceStatus !== filter) return false
      if (!normalizedQuery) return true

      const searchable = normalize([
        member.prenom,
        member.nom,
        member.role,
        member.presenceStatus,
        service?.name,
      ].join(' '))

      return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
    })
  }, [filter, members, query, service?.name])

  useEffect(() => {
    setPage(1)
  }, [filter, query])

  useEffect(() => {
    if (viewMode === 'list') setPage(1)
  }, [viewMode])


  const totalMemberPages = Math.max(1, Math.ceil(visibleMembers.length / PAGE_SIZE))
  const safeMemberPage = Math.min(page, totalMemberPages)
  const paginatedMembers = useMemo(() => {
    const start = (safeMemberPage - 1) * PAGE_SIZE
    return visibleMembers.slice(start, start + PAGE_SIZE)
  }, [safeMemberPage, visibleMembers])

  useEffect(() => {
    if (page > totalMemberPages) setPage(totalMemberPages)
  }, [page, totalMemberPages])

  const calendarData = useMemo(() => {
    if (!calendarState.data || !query) return calendarState.data
    const normalizedQuery = normalize(query)
    const matchingIds = new Set(
      (calendarState.data.members ?? [])
        .filter((member) => normalize(`${member.nom} ${member.prenom} ${member.role}`).includes(normalizedQuery))
        .map((member) => Number(member.id)),
    )

    return {
      ...calendarState.data,
      totalMembers: calendarState.data.members?.length ?? 0,
      members: calendarState.data.members.filter((member) => matchingIds.has(Number(member.id))),
      days: calendarState.data.days.map((day) => ({
        ...day,
        members: day.members.filter((member) => matchingIds.has(Number(member.id))),
      })),
    }
  }, [calendarState.data, query])

  const morningPresent = countSlotPresent(members, 'morning')
  const afternoonPresent = countSlotPresent(members, 'afternoon')
  const total = summary.total ?? members.length
  const percentage = total > 0 ? Math.round(((summary.present ?? 0) / total) * 100) : 0

  const changeCalendarMonth = (offset, exactMonth) => {
    setCalendarMonth((current) => exactMonth ?? shiftMonthKey(current, offset))
  }

  return (
    <div className={`manager-presence-page${viewMode === 'calendar' ? ' manager-presence-page--calendar' : ''}`}>
      {decisionLoading && (
        <div className="manager-calendar-action-feedback">Chargement de la demande…</div>
      )}
      {actionFeedback && !decisionLoading && (
        <div className={`manager-calendar-action-feedback${actionFeedback.error ? ' is-error' : ''}`}>
          {actionFeedback.text}
        </div>
      )}
      {state.loading && !state.data ? (
        <>
          <div className="manager-presence-toolbar manager-presence-toolbar--top" aria-hidden="true">
            <div className="manager-presence-toolbar__left">
              <span className="manager-view-toggle is-active">Vue liste</span>
            </div>
          </div>
          <div className="manager-calendar-loading">
            <Icon name="calendar" size={24} />
            <span>Chargement du calendrier du service…</span>
          </div>
          <div className="manager-presence-insights-grid">
            <div className="manager-presence-summary-skeleton" aria-hidden="true" />
            <div className="manager-presence-summary-skeleton" aria-hidden="true" />
          </div>
        </>
      ) : state.error && !state.data ? (
        <div className="manager-presence-state manager-presence-state--error">
          <span className="manager-presence-state__icon"><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger la présence du service.</strong>
          <span>Vérifiez la connexion au backend puis réessayez.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : (
        <>
          <div className="manager-presence-toolbar manager-presence-toolbar--top">
            <div className="manager-presence-toolbar__left">
              <button
                type="button"
                className={`manager-view-toggle${viewMode === 'calendar' ? ' is-active' : ''}`}
                onClick={() => setViewMode((current) => current === 'calendar' ? 'list' : 'calendar')}
              >
                <Icon name={viewMode === 'calendar' ? 'list' : 'calendar'} size={16} />
                {viewMode === 'calendar' ? 'Vue liste' : 'Vue calendrier'}
              </button>

              {viewMode === 'list' && (
                <div className="manager-presence-filters" role="tablist" aria-label="Filtres de présence">
                  {FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={filter === item.id}
                      className={`manager-presence-filter${filter === item.id ? ' is-active' : ''}`}
                      onClick={() => setFilter(item.id)}
                    >
                      {item.label}
                      <span>{counts[item.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>

          <div className="manager-presence-main-view">
            {viewMode === 'calendar' ? (
              calendarState.loading && !calendarState.data ? (
                <div className="manager-calendar-loading">
                  <Icon name="calendar" size={24} />
                  <span>Chargement du calendrier…</span>
                </div>
              ) : calendarState.error || !calendarData ? (
                <div className="manager-presence-state manager-presence-state--error">
                  <span className="manager-presence-state__icon"><Icon name="alert" size={25} /></span>
                  <strong>Impossible de charger le calendrier du service.</strong>
                  <button type="button" onClick={() => loadCalendar(calendarMonth)}>Réessayer</button>
                </div>
              ) : (
                <ManagerPresenceCalendar
                  key={calendarMonth}
                  data={calendarData}
                  month={calendarMonth}
                  filter="all"
                  onMonthChange={changeCalendarMonth}
                  currentUserId={user?.id}
                  onPendingRequestClick={openCalendarValidation}
                />
              )
            ) : visibleMembers.length === 0 ? (
              <div className="manager-presence-state">
                <span className="manager-presence-state__icon"><Icon name="users" size={25} /></span>
                <strong>{query ? 'Aucun membre ne correspond à votre recherche.' : 'Aucun membre dans cette catégorie.'}</strong>
              </div>
            ) : (
              <>
                <div className="manager-presence-members">
                  {paginatedMembers.map((member) => (
                    <ManagerPresenceMemberCard
                      key={member.id}
                      member={member}
                      currentPeriod={state.data?.currentPeriod}
                    />
                  ))}
                </div>
                <div className="manager-presence-pagination">
                  <PaginationBar
                    page={safeMemberPage}
                    pageSize={PAGE_SIZE}
                    totalItems={visibleMembers.length}
                    onPageChange={setPage}
                  />
                </div>
              </>
            )}
          </div>

          <div className="manager-presence-insights-grid">
            <section className="manager-presence-summary-card manager-presence-summary-card--compact">
              <div className="manager-presence-summary-card__header">
                <div>
                  <span className="manager-presence-eyebrow">Présence aujourd’hui</span>
                  <strong>{service?.name ?? 'Votre service'}</strong>
                  <small>{formatDateFR(state.data?.date)}</small>
                </div>
                <span className={`manager-presence-threshold-badge ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
                  {threshold == null ? 'Aucun seuil' : thresholdOk ? 'Seuil respecté' : 'Seuil non respecté'}
                </span>
              </div>

              <div className="manager-presence-summary-card__main">
                <div className="manager-presence-summary-card__hero">
                  <strong>{percentage}%</strong>
                </div>

                <div className="manager-presence-summary-card__metrics">
                  <div className="is-present"><span>Présents</span><strong>{summary.present ?? 0}</strong></div>
                  <div className="is-leave"><span>En vacances</span><strong>{summary.onLeave ?? 0}</strong></div>
                  <div className="is-absent"><span>Absents</span><strong>{summary.absent ?? 0}</strong></div>
                  <div className="is-threshold"><span>Minimum requis</span><strong>{threshold ?? '—'}</strong></div>
                </div>
              </div>

              <div className="manager-presence-summary-card__progress" aria-hidden="true">
                <span style={{ width: `${Math.min(percentage, 100)}%` }} />
              </div>

              {threshold != null && (
                <div className={`manager-presence-threshold-note ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
                  <Icon name={thresholdOk ? 'check' : 'alert'} size={16} />
                  <span>
                    {thresholdOk
                      ? `La présence minimale est respectée${margin > 0 ? ` avec une marge de ${margin} personne${margin > 1 ? 's' : ''}` : ''}.`
                      : `Il manque ${Math.abs(margin)} personne${Math.abs(margin) > 1 ? 's' : ''} pour respecter le seuil minimum du service.`}
                  </span>
                </div>
              )}
            </section>

            <section className="manager-presence-day-card manager-presence-day-card--compact">
              <div className="manager-presence-day-card__header">
                <span className="manager-presence-day-card__icon"><Icon name="clock" size={18} /></span>
                <div>
                  <span className="manager-presence-eyebrow">Aujourd’hui</span>
                  <strong>Couverture de la journée</strong>
                  <small>Les demi-journées sont prises en compte automatiquement.</small>
                </div>
              </div>

              <div className="manager-presence-day-card__slots">
                <div className={state.data?.currentPeriod === 'MATIN' ? 'is-current' : ''}>
                  <span>Matin</span>
                  <strong>{morningPresent} / {total}</strong>
                  <small>{threshold == null ? 'présents' : `minimum ${threshold}`}</small>
                </div>
                <div className={state.data?.currentPeriod === 'APRES_MIDI' ? 'is-current' : ''}>
                  <span>Après-midi</span>
                  <strong>{afternoonPresent} / {total}</strong>
                  <small>{threshold == null ? 'présents' : `minimum ${threshold}`}</small>
                </div>
              </div>

              <div className={`manager-presence-day-card__status ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
                <Icon name={thresholdOk ? 'check' : 'alert'} size={16} />
                <span>
                  {threshold == null
                    ? 'Aucun seuil minimum n’est configuré pour ce service.'
                    : thresholdOk
                      ? 'La couverture respecte le minimum requis.'
                      : 'La couverture est sous le minimum requis.'}
                </span>
              </div>
            </section>
          </div>
        </>
      )}

      {calendarDecision && !signatureOpen && createPortal(
        <div
          className="manager-calendar-decision-backdrop"
          role="presentation"
          onMouseDown={() => !decisionSubmitting && setCalendarDecision(null)}
        >
          <div
            className="manager-calendar-decision"
            role="dialog"
            aria-modal="true"
            aria-label="Validation depuis le calendrier"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="manager-calendar-decision__head">
              <div>
                <strong>Valider cette demande</strong>
                <small>La validation du Responsable transmettra ensuite la demande à la RH.</small>
              </div>
              <button
                type="button"
                className="manager-calendar-decision__close"
                onClick={() => setCalendarDecision(null)}
                aria-label="Fermer"
              >×</button>
            </div>

            <div className="manager-calendar-decision__summary">
              <div>
                <span>Collaborateur</span>
                <strong>{calendarDecision.request?.employee?.nom} {calendarDecision.request?.employee?.prenom}</strong>
              </div>
              <div>
                <span>Type</span>
                <strong>{calendarDecision.request?.leaveType?.name ?? 'Congé'}</strong>
              </div>
              <div>
                <span>Début</span>
                <strong>{calendarDecision.request?.startDate}</strong>
              </div>
              <div>
                <span>Fin</span>
                <strong>{calendarDecision.request?.endDate}</strong>
              </div>
            </div>

            {calendarDecision.availability?.minimumPresenceBreached && (
              <>
                <div className="manager-calendar-decision__warning">
                  Le minimum de présence du service serait dépassé. Une justification est obligatoire pour poursuivre.
                </div>
                <label className="manager-calendar-decision__field">
                  Justification
                  <textarea
                    value={calendarDecision.justification}
                    onChange={(event) => setCalendarDecision((current) => ({
                      ...current,
                      justification: event.target.value,
                    }))}
                    placeholder="Expliquez pourquoi cette validation reste possible…"
                  />
                </label>
              </>
            )}

            <div className="manager-calendar-decision__actions">
              <button type="button" onClick={() => setCalendarDecision(null)}>Annuler</button>
              <button
                type="button"
                className="is-primary"
                disabled={calendarDecision.availability?.minimumPresenceBreached && !calendarDecision.justification?.trim()}
                onClick={() => setSignatureOpen(true)}
              >
                Signer et valider
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <SignatureModal
        open={signatureOpen}
        requestLabel={calendarDecision?.request
          ? `${calendarDecision.request.employee?.nom ?? ''} ${calendarDecision.request.employee?.prenom ?? ''} · ${calendarDecision.request.startDate} au ${calendarDecision.request.endDate}`
          : ''}
        submitting={decisionSubmitting}
        onClose={() => !decisionSubmitting && setSignatureOpen(false)}
        onConfirm={confirmCalendarValidation}
        title="Signer la validation"
        confirmLabel="Valider et transmettre à la RH"
        submittingLabel="Validation…"
        dialogLabel="Signer la validation de la demande"
      />
    </div>
  )
}
