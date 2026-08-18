import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import {
  getDirectorPendingRequests,
  getDirectorRequestAvailability,
  getDirectorRequestFilterOptions,
} from '@/services/directorRequests'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

import '@/styles/director/requests.css'

const PAGE_SIZE = 8

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'urgent', label: 'Urgentes' },
  { id: 'manager', label: 'Responsables' },
  { id: 'rh', label: 'RH' },
  { id: 'relay', label: 'Relais' },
]

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function initials(employee) {
  return `${employee?.prenom?.[0] ?? ''}${employee?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function formatSubmittedAt(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function circuitMeta(request) {
  const kind = request.decisionAccess?.kind
  const role = request.employee?.role
  const serviceType = request.service?.serviceType

  if (kind === 'URGENCE' || request.isUrgent) {
    return { label: 'Urgence', tone: 'urgent', filter: 'urgent' }
  }

  if (role === 'RH' || kind === 'DIRECTEUR_SEUL') {
    return { label: 'Demande RH', tone: 'director', filter: 'rh' }
  }

  if (role === 'RESPONSABLE_SERVICE') {
    return { label: 'Demande Responsable', tone: 'manager', filter: 'manager' }
  }

  if (kind === 'RELAIS') {
    const reason = request.decisionAccess?.reason ?? ''
    const delay = request.service?.takeoverDelayDays
    if (reason.toLocaleLowerCase('fr-FR').includes('délai')) {
      return {
        label: delay ? `Relais après ${delay} j` : 'Relais après délai',
        tone: 'relay',
        filter: 'relay',
      }
    }
    return { label: 'Relais — valideur indisponible', tone: 'relay', filter: 'relay' }
  }

  if (kind === 'REMPLACEMENT') {
    return { label: 'Valideur temporaire', tone: 'temporary', filter: 'all' }
  }

  if (serviceType === 'EXTERNE') {
    return { label: 'Collaborateur externe', tone: 'shared', filter: 'all' }
  }

  return { label: 'Circuit Directeur / RH', tone: 'shared', filter: 'all' }
}

function hasServiceAlert(availability) {
  return Boolean(availability?.minimumPresenceBreached || availability?.overlaps?.length)
}

function matchesSearch(request, availability, query) {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  const circuit = circuitMeta(request)
  const searchable = [
    request.employee?.prenom,
    request.employee?.nom,
    request.employee?.email,
    request.service?.name,
    request.leaveType?.name,
    formatRangeNumericFR(request.startDate, request.endDate),
    `${formatDays(Number(request.deductedDays) || 0)} j`,
    circuit.label,
    circuit.filter,
    hasServiceAlert(availability) ? 'alerte service chevauchement presence minimale' : '',
    request.id,
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, index) => (
    <div className="director-requests-skeleton" key={index} aria-hidden="true">
      <span className="director-requests-skeleton__avatar" />
      <span className="director-requests-skeleton__line director-requests-skeleton__line--name" />
      <span className="director-requests-skeleton__line" />
      <span className="director-requests-skeleton__line" />
      <span className="director-requests-skeleton__line" />
      <span className="director-requests-skeleton__line" />
    </div>
  ))
}

export function DirectorRequestsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [alertFilter, setAlertFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [feedback, setFeedback] = useState(null)
  const [state, setState] = useState({
    loading: true,
    error: false,
    requests: [],
    availabilityById: {},
    filterOptions: { services: [], leaveTypes: [] },
  })

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: false }))
    }

    try {
      const [requests, filterOptions] = await Promise.all([
        getDirectorPendingRequests(),
        getDirectorRequestFilterOptions().catch(() => ({ services: [], leaveTypes: [] })),
      ])
      const availabilityResults = await Promise.allSettled(
        requests.map((request) => getDirectorRequestAvailability(request.id)),
      )
      const availabilityById = {}

      requests.forEach((request, index) => {
        const result = availabilityResults[index]
        if (result?.status === 'fulfilled') availabilityById[request.id] = result.value
      })

      setState({ loading: false, error: false, requests, availabilityById, filterOptions })
    } catch {
      if (!silent) {
        setState({
          loading: false,
          error: true,
          requests: [],
          availabilityById: {},
          filterOptions: { services: [], leaveTypes: [] },
        })
      }
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = () => load({ silent: true })
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
  }, [load])

  useEffect(() => {
    const flash = location.state?.flash
    if (!flash?.message) return

    setFeedback({ kind: flash.kind === 'error' ? 'error' : 'success', message: flash.message })
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const counts = useMemo(() => {
    const result = { all: state.requests.length, urgent: 0, manager: 0, rh: 0, relay: 0 }

    state.requests.forEach((request) => {
      const circuit = circuitMeta(request)
      if (circuit.filter !== 'all' && result[circuit.filter] !== undefined) {
        result[circuit.filter] += 1
      }
    })

    return result
  }, [state.requests])

  const services = useMemo(() => {
    const values = new Map()
    state.filterOptions.services.forEach((service) => {
      if (service?.id && service?.name) values.set(String(service.id), service.name)
    })
    state.requests.forEach((request) => {
      if (request.service?.id && request.service?.name) {
        values.set(String(request.service.id), request.service.name)
      }
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.services, state.requests])

  const leaveTypes = useMemo(() => {
    const values = new Map()
    state.filterOptions.leaveTypes.forEach((leaveType) => {
      if (leaveType?.id && leaveType?.name) values.set(String(leaveType.id), leaveType.name)
    })
    state.requests.forEach((request) => {
      if (request.leaveType?.id && request.leaveType?.name) {
        values.set(String(request.leaveType.id), request.leaveType.name)
      }
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.leaveTypes, state.requests])

  const activeAdvancedFilters = [
    serviceFilter !== 'all',
    typeFilter !== 'all',
    alertFilter !== 'all',
  ].filter(Boolean).length

  const query = searchParams.get('q') ?? ''

  const filteredRequests = useMemo(() => state.requests.filter((request) => {
    const circuit = circuitMeta(request)
    const availability = state.availabilityById[request.id]
    const serviceAlert = hasServiceAlert(availability)

    if (filter !== 'all' && circuit.filter !== filter) return false
    if (serviceFilter !== 'all' && String(request.service?.id) !== serviceFilter) return false
    if (typeFilter !== 'all' && String(request.leaveType?.id) !== typeFilter) return false
    if (alertFilter === 'with-alert' && !serviceAlert) return false
    if (alertFilter === 'without-alert' && serviceAlert) return false
    return matchesSearch(request, availability, query)
  }), [
    alertFilter,
    filter,
    query,
    serviceFilter,
    state.availabilityById,
    state.requests,
    typeFilter,
  ])

  useEffect(() => setPage(1), [alertFilter, filter, query, serviceFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleRequests = filteredRequests.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  return (
    <div className="director-requests-page">
      {feedback && (
        <div className={`director-requests-feedback director-requests-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

      <section className="director-requests-card">
        <div className="director-requests-toolbar">
          <div className="director-requests-tabs" role="tablist" aria-label="Circuit des demandes à traiter">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`director-requests-tab${filter === item.id ? ' is-active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span>
                <span className="director-requests-tab__count">{counts[item.id]}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`director-requests-filter-button${filtersOpen ? ' is-active' : ''}${activeAdvancedFilters ? ' has-filters' : ''}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            aria-controls="director-requests-filters"
          >
            <Icon name="filter" size={16} />
            <span>Filtres</span>
            {activeAdvancedFilters > 0 && (
              <span className="director-requests-filter-button__count">{activeAdvancedFilters}</span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="director-requests-filter-panel" id="director-requests-filters">
            <div className="director-requests-filter-grid">
              <label className="director-requests-filter-field">
                <span>Service</span>
                <div className="director-requests-select">
                  <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
                    <option value="all">Tous les services</option>
                    {services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              </label>

              <label className="director-requests-filter-field">
                <span>Type de congé</span>
                <div className="director-requests-select">
                  <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    <option value="all">Tous les types de congés</option>
                    {leaveTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              </label>

              <label className="director-requests-filter-field">
                <span>Alerte de service</span>
                <div className="director-requests-select">
                  <select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}>
                    <option value="all">Toutes les situations</option>
                    <option value="with-alert">Avec alerte</option>
                    <option value="without-alert">Sans alerte</option>
                  </select>
                </div>
              </label>

              <button
                type="button"
                className="director-requests-reset"
                disabled={activeAdvancedFilters === 0}
                onClick={() => {
                  setServiceFilter('all')
                  setTypeFilter('all')
                  setAlertFilter('all')
                }}
              >
                <Icon name="refresh" size={15} />
                Réinitialiser
              </button>
            </div>
          </div>
        )}

        <div className="director-requests-table-wrap">
          <div className="director-requests-table" role="table" aria-label="Demandes à traiter par le Directeur">
            <div className="director-requests-row director-requests-row--header" role="row">
              <span>Collaborateur</span>
              <span>Service</span>
              <span>Type</span>
              <span>Période</span>
              <span>Durée</span>
              <span>Motif du circuit</span>
              <span>Statut</span>
              <span aria-hidden="true" />
            </div>

            {state.loading ? (
              <LoadingRows />
            ) : state.error ? (
              <div className="director-requests-empty director-requests-empty--error">
                <span className="director-requests-empty__icon"><Icon name="alert" size={24} /></span>
                <strong>Impossible de charger les demandes.</strong>
                <span>Vérifiez la connexion au backend puis réessayez.</span>
                <button type="button" onClick={() => load()}>Réessayer</button>
              </div>
            ) : state.requests.length === 0 ? (
              <div className="director-requests-empty">
                <span className="director-requests-empty__icon director-requests-empty__icon--success"><Icon name="check" size={24} /></span>
                <strong>Aucune demande à traiter</strong>
                <span>Votre file de décision est à jour.</span>
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="director-requests-empty">
                <span className="director-requests-empty__icon"><Icon name="list" size={24} /></span>
                <strong>{query ? 'Aucune demande ne correspond à votre recherche.' : 'Aucune demande dans cette catégorie.'}</strong>
                <span>Modifiez votre recherche ou choisissez un autre filtre.</span>
              </div>
            ) : (
              visibleRequests.map((request) => {
                const circuit = circuitMeta(request)
                const availability = state.availabilityById[request.id]
                const alert = hasServiceAlert(availability)

                return (
                  <button
                    type="button"
                    role="row"
                    className="director-requests-row director-requests-row--data"
                    key={request.id}
                    onClick={() => navigate(`/app/director-requests/${request.id}`)}
                  >
                    <span className="director-requests-person">
                      <span className="director-requests-avatar">{initials(request.employee)}</span>
                      <span>
                        <strong>{request.employee?.prenom} {request.employee?.nom}</strong>
                        <small>{request.employee?.email ?? `Demande n°${request.id}`}</small>
                      </span>
                    </span>
                    <span className="director-requests-service">{request.service?.name ?? '—'}</span>
                    <span className="director-requests-type">{request.leaveType?.name ?? '—'}</span>
                    <span className="director-requests-period">{formatRangeNumericFR(request.startDate, request.endDate)}</span>
                    <span className="director-requests-duration">{formatDays(Number(request.deductedDays) || 0)} j</span>
                    <span>
                      <span className={`director-circuit-badge director-circuit-badge--${circuit.tone}`}>{circuit.label}</span>
                    </span>
                    <span className="director-requests-status-cell">
                      <span className={`director-request-status${request.isUrgent ? ' is-urgent' : ''}`}>
                        <Icon name={request.isUrgent ? 'alert' : 'clock'} size={12} />
                        {request.isUrgent ? 'Urgente' : 'En attente'}
                      </span>
                      {alert && <span className="director-request-alert-dot" title="Alerte de présence ou chevauchement" />}
                    </span>
                    <span className="director-requests-open"><Icon name="chevronRight" size={18} /></span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {!state.loading && !state.error && filteredRequests.length > 0 && (
          <footer className="director-requests-footer">
            <span>
              {filteredRequests.length} demande{filteredRequests.length > 1 ? 's' : ''}
              {filteredRequests.length !== state.requests.length ? ` sur ${state.requests.length}` : ''}
            </span>
            <PaginationBar
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={filteredRequests.length}
              onPageChange={setPage}
            />
          </footer>
        )}
      </section>
    </div>
  )
}
