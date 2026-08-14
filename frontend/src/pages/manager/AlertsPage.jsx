import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ManagerOverlapAlertCard } from '@/components/manager/alerts/ManagerOverlapAlertCard'
import { ManagerAlertsCalendar } from '@/components/manager/calendar/ManagerAlertsCalendar'
import { Icon } from '@/components/ui/Icon'
import { getManagerServicePresenceCalendar } from '@/services/managerDashboard'
import {
  getManagerPendingRequests,
  getManagerRequestAvailability,
} from '@/services/managerRequests'
import { formatRangeNumericFR } from '@/utils/format'
import {
  getCurrentMonthKey,
  monthKeyFromDate,
  shiftMonthKey,
} from '@/utils/managerCalendar'

import '@/styles/manager-alerts.css'

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'leave', label: 'Congés' },
  { id: 'absence', label: 'Absences' },
  { id: 'multiple', label: 'Multiples' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function includesSource(availability, source) {
  return (availability?.overlaps ?? []).some((item) => item.source === source)
}

function matchesSearch(request, availability, query) {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return true

  const searchable = [
    request.employee?.prenom,
    request.employee?.nom,
    request.leaveType?.name,
    request.service?.name,
    request.startDate,
    request.endDate,
    formatRangeNumericFR(request.startDate, request.endDate),
    ...(availability?.overlaps ?? []).flatMap((item) => [
      item.prenom,
      item.nom,
      item.startDate,
      item.endDate,
      item.source === 'DECLARATION_ABSENCE' ? 'absence' : 'conge',
    ]),
  ]
    .map(normalize)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
}

function LoadingState() {
  return (
    <div className="manager-alerts-list" aria-label="Chargement des alertes">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="manager-alerts-skeleton" key={index} aria-hidden="true">
          <span className="manager-alerts-skeleton__avatar" />
          <span className="manager-alerts-skeleton__body">
            <span className="manager-alerts-skeleton__line manager-alerts-skeleton__line--title" />
            <span className="manager-alerts-skeleton__line" />
            <span className="manager-alerts-skeleton__line manager-alerts-skeleton__line--short" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ManagerAlertsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [viewMode, setViewMode] = useState('list')
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonthKey())
  const [state, setState] = useState({ loading: true, error: false, alerts: [] })
  const [calendarState, setCalendarState] = useState({ loading: false, error: false, data: null })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))

    try {
      const requests = await getManagerPendingRequests()
      const safeRequests = Array.isArray(requests) ? requests : []
      const availabilityResults = await Promise.allSettled(
        safeRequests.map((request) => getManagerRequestAvailability(request.id)),
      )

      const alerts = safeRequests.flatMap((request, index) => {
        const result = availabilityResults[index]
        if (result?.status !== 'fulfilled') return []
        const availability = result.value
        if (!availability?.overlaps?.length) return []
        return [{ request, availability }]
      })

      setState({ loading: false, error: false, alerts })
    } catch {
      setState({ loading: false, error: true, alerts: [] })
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

    const refresh = () => load()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load])

  useEffect(() => {
    if (viewMode === 'calendar') loadCalendar(calendarMonth)
  }, [calendarMonth, loadCalendar, viewMode])

  const counts = useMemo(() => ({
    all: state.alerts.length,
    leave: state.alerts.filter(({ availability }) => includesSource(availability, 'DEMANDE_CONGE')).length,
    absence: state.alerts.filter(({ availability }) => includesSource(availability, 'DECLARATION_ABSENCE')).length,
    multiple: state.alerts.filter(({ availability }) => (availability?.overlaps?.length ?? 0) > 1).length,
  }), [state.alerts])

  const visibleAlerts = useMemo(() => {
    const query = searchParams.get('q') ?? ''

    return state.alerts.filter(({ request, availability }) => {
      if (filter === 'leave' && !includesSource(availability, 'DEMANDE_CONGE')) return false
      if (filter === 'absence' && !includesSource(availability, 'DECLARATION_ABSENCE')) return false
      if (filter === 'multiple' && (availability?.overlaps?.length ?? 0) <= 1) return false
      return matchesSearch(request, availability, query)
    })
  }, [filter, searchParams, state.alerts])

  useEffect(() => {
    if (viewMode !== 'calendar' || visibleAlerts.length === 0) return
    const hasAlertInMonth = visibleAlerts.some(({ request, availability }) => {
      const ranges = [
        { startDate: request.startDate, endDate: request.endDate },
        ...(availability?.overlaps ?? []),
      ]
      return ranges.some((item) => monthKeyFromDate(item.startDate) === calendarMonth || monthKeyFromDate(item.endDate) === calendarMonth)
    })
    if (!hasAlertInMonth && visibleAlerts[0]?.request?.startDate) {
      setCalendarMonth(monthKeyFromDate(visibleAlerts[0].request.startDate))
    }
  }, [calendarMonth, viewMode, visibleAlerts])

  const totalOverlaps = useMemo(
    () => state.alerts.reduce((sum, item) => sum + (item.availability?.overlaps?.length ?? 0), 0),
    [state.alerts],
  )
  const query = searchParams.get('q') ?? ''

  const toggleCalendar = () => {
    if (viewMode === 'calendar') {
      setViewMode('list')
      return
    }

    const hasCurrentMonthAlert = visibleAlerts.some(({ request }) => monthKeyFromDate(request.startDate) === calendarMonth)
    if (!hasCurrentMonthAlert && visibleAlerts[0]?.request?.startDate) {
      setCalendarMonth(monthKeyFromDate(visibleAlerts[0].request.startDate))
    }
    setViewMode('calendar')
  }

  const changeCalendarMonth = (offset, exactMonth) => {
    setCalendarMonth((current) => exactMonth ?? shiftMonthKey(current, offset))
  }

  return (
    <div className="manager-alerts-page">
      <div className="manager-alerts-toolbar">
        <div className="manager-alerts-toolbar__left">
          <div className="manager-alerts-filters" role="tablist" aria-label="Filtres des chevauchements">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`manager-alerts-filter${filter === item.id ? ' is-active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span>
                <span className="manager-alerts-filter__count">{counts[item.id]}</span>
              </button>
            ))}
          </div>

          <button type="button" className={`manager-view-toggle${viewMode === 'calendar' ? ' is-active' : ''}`} onClick={toggleCalendar}>
            <Icon name={viewMode === 'calendar' ? 'list' : 'calendar'} size={16} />
            {viewMode === 'calendar' ? 'Vue liste' : 'Vue calendrier'}
          </button>
        </div>

        <div className="manager-alerts-summary">
          <span className="manager-alerts-summary__icon"><Icon name="alert" size={17} /></span>
          <span>
            <strong>{totalOverlaps}</strong>
            {totalOverlaps > 1 ? ' chevauchements détectés' : ' chevauchement détecté'}
          </span>
        </div>
      </div>

      <div className="manager-alerts-info">
        <Icon name="shield" size={16} />
        <span>
          Ces alertes sont informatives : elles n’empêchent pas automatiquement une validation. Le Responsable reste décisionnaire.
        </span>
      </div>

      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <div className="manager-alerts-state manager-alerts-state--error">
          <span className="manager-alerts-state__icon"><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger les alertes.</strong>
          <span>Vérifiez la connexion au backend puis réessayez.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : state.alerts.length === 0 ? (
        <div className="manager-alerts-state">
          <span className="manager-alerts-state__icon"><Icon name="check" size={25} /></span>
          <strong>Aucun chevauchement détecté</strong>
          <span>Les demandes actuellement à traiter ne se chevauchent avec aucune absence ou demande du service.</span>
        </div>
      ) : visibleAlerts.length === 0 ? (
        <div className="manager-alerts-state">
          <span className="manager-alerts-state__icon"><Icon name="list" size={25} /></span>
          <strong>{query ? 'Aucune alerte ne correspond à votre recherche.' : 'Aucune alerte dans cette catégorie.'}</strong>
        </div>
      ) : viewMode === 'calendar' ? (
        calendarState.loading && !calendarState.data ? (
          <div className="manager-calendar-loading"><Icon name="calendar" size={24} /><span>Chargement du planning mensuel…</span></div>
        ) : calendarState.error || !calendarState.data ? (
          <div className="manager-alerts-state manager-alerts-state--error">
            <span className="manager-alerts-state__icon"><Icon name="alert" size={25} /></span>
            <strong>Impossible de charger le planning du service.</strong>
            <button type="button" onClick={() => loadCalendar(calendarMonth)}>Réessayer</button>
          </div>
        ) : (
          <ManagerAlertsCalendar
            alerts={visibleAlerts}
            calendarData={calendarState.data}
            month={calendarMonth}
            onMonthChange={changeCalendarMonth}
            onOpenRequest={(id) => navigate(`/app/requests/${id}`)}
          />
        )
      ) : (
        <div className="manager-alerts-list">
          {visibleAlerts.map(({ request, availability }) => (
            <ManagerOverlapAlertCard
              key={request.id}
              request={request}
              availability={availability}
              onOpen={(id) => navigate(`/app/requests/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
