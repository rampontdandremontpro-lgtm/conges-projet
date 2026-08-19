import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import { getRhAllRequestFilterOptions, getRhAllRequests } from '@/services/rh/rhAllRequests'
import { formatDateNumericFR, formatDays } from '@/utils/format'

import '@/styles/rh/all-requests.css'

const PAGE_SIZE = 8

const STATUS_META = {
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'pending' },
  VALIDEE: { label: 'Validée', tone: 'approved' },
  REFUSEE: { label: 'Refusée', tone: 'refused' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled' },
  ANNULATION_EN_ATTENTE_ACCORD: { label: 'Annulation en attente', tone: 'pending' },
  ANNULEE_APRES_VALIDATION: { label: 'Annulée après validation', tone: 'cancelled' },
  EXPIREE_NON_VALIDEE: { label: 'Expirée', tone: 'expired' },
}

const STATUS_FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'approved', label: 'Validées' },
  { id: 'refused', label: 'Refusées' },
  { id: 'cancelled', label: 'Annulées' },
]

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function formatDateTime(value) {
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

function initials(employee) {
  return `${employee?.prenom?.[0] ?? ''}${employee?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status || '—', tone: 'neutral' }
}

function statusMatchesFilter(status, filter) {
  if (filter === 'all') return true
  if (filter === 'pending') {
    return ['EN_ATTENTE_VALIDATION', 'ANNULATION_EN_ATTENTE_ACCORD'].includes(status)
  }
  if (filter === 'approved') return status === 'VALIDEE'
  if (filter === 'refused') return status === 'REFUSEE'
  if (filter === 'cancelled') {
    return ['ANNULEE', 'ANNULEE_APRES_VALIDATION', 'EXPIREE_NON_VALIDEE'].includes(status)
  }
  return true
}

function requestMatchesSearch(request, query) {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  const searchable = [
    request.employee?.prenom,
    request.employee?.nom,
    request.employee?.email,
    request.leaveType?.name,
    request.service?.name,
    request.startDate,
    request.endDate,
    statusMeta(request.status).label,
    request.id,
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, index) => (
    <div className="rh-all-requests-skeleton" key={index} aria-hidden="true">
      <span className="rh-all-requests-skeleton__avatar" />
      <span className="rh-all-requests-skeleton__line rh-all-requests-skeleton__line--name" />
      <span className="rh-all-requests-skeleton__line" />
      <span className="rh-all-requests-skeleton__line" />
      <span className="rh-all-requests-skeleton__line" />
    </div>
  ))
}

export function RhAllRequestsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState({
    loading: true,
    error: false,
    requests: [],
    filterOptions: { services: [], leaveTypes: [] },
  })
  const [statusFilter, setStatusFilter] = useState('all')
  const search = searchParams.get('q') ?? ''
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const [requests, filterOptions] = await Promise.all([
        getRhAllRequests(),
        getRhAllRequestFilterOptions().catch(() => ({ services: [], leaveTypes: [] })),
      ])
      setState({ loading: false, error: false, requests, filterOptions })
    } catch {
      setState({
        loading: false,
        error: true,
        requests: [],
        filterOptions: { services: [], leaveTypes: [] },
      })
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

  const services = useMemo(() => {
    const values = new Map()
    state.filterOptions.services.forEach((service) => {
      if (service?.id && service?.name) values.set(String(service.id), service.name)
    })
    state.requests.forEach((request) => {
      if (request.service?.id && request.service?.name) values.set(String(request.service.id), request.service.name)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.services, state.requests])

  const leaveTypes = useMemo(() => {
    const values = new Map()
    state.filterOptions.leaveTypes.forEach((leaveType) => {
      if (leaveType?.id && leaveType?.name) values.set(String(leaveType.id), leaveType.name)
    })
    state.requests.forEach((request) => {
      if (request.leaveType?.id && request.leaveType?.name) values.set(String(request.leaveType.id), request.leaveType.name)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.leaveTypes, state.requests])

  const counts = useMemo(() => ({
    all: state.requests.length,
    pending: state.requests.filter((request) => statusMatchesFilter(request.status, 'pending')).length,
    approved: state.requests.filter((request) => statusMatchesFilter(request.status, 'approved')).length,
    refused: state.requests.filter((request) => statusMatchesFilter(request.status, 'refused')).length,
    cancelled: state.requests.filter((request) => statusMatchesFilter(request.status, 'cancelled')).length,
  }), [state.requests])

  const filteredRequests = useMemo(() => state.requests.filter((request) => {
    if (!statusMatchesFilter(request.status, statusFilter)) return false
    if (serviceFilter !== 'all' && String(request.service?.id) !== serviceFilter) return false
    if (typeFilter !== 'all' && String(request.leaveType?.id) !== typeFilter) return false
    return requestMatchesSearch(request, search)
  }), [search, serviceFilter, state.requests, statusFilter, typeFilter])

  useEffect(() => {
    setPage(1)
  }, [search, serviceFilter, statusFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleRequests = filteredRequests.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <PageContainer className="rh-all-requests-page">
      {feedback && (
        <div className={`rh-all-requests-feedback rh-all-requests-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}
      <section className="rh-all-requests-card">
        <div className="rh-all-requests-toolbar">
          <div className="rh-all-requests-tabs" role="tablist" aria-label="Statut des demandes">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === filter.id}
                className={`rh-all-requests-tab${statusFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <span className="rh-all-requests-tab__count">{counts[filter.id]}</span>
              </button>
            ))}
          </div>

          <div className="rh-all-requests-actions">
            <button
              type="button"
              className={`rh-all-requests-filter-button${filtersOpen ? ' is-active' : ''}`}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              <Icon name="filter" size={15} /> Filtres
            </button>
            <button type="button" className="rh-all-requests-new" onClick={() => navigate('/app/rh-prepare-request')}>
              <Icon name="plus" size={17} /> Saisir une demande
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="rh-all-requests-filter-panel">
            <label>
              <span>Service</span>
              <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
                <option value="all">Tous les services</option>
                {services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>Type de congé</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">Tous les types de congés</option>
                {leaveTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="rh-all-requests-reset"
              onClick={() => {
                setServiceFilter('all')
                setTypeFilter('all')
                const nextParams = new URLSearchParams(searchParams)
                nextParams.delete('q')
                setSearchParams(nextParams, { replace: true })
              }}
            >
              Réinitialiser
            </button>
          </div>
        )}

        <div className="rh-all-requests-table-wrap">
          <div className="rh-all-requests-table" role="table" aria-label="Toutes les demandes de congé">
            <div className="rh-all-requests-row rh-all-requests-row--header" role="row">
              <span>Collaborateur</span>
              <span>Type de congé</span>
              <span>Début</span>
              <span>Fin</span>
              <span>Durée</span>
              <span>Statut</span>
              <span>Soumis le</span>
              <span aria-hidden="true" />
            </div>

            {state.loading ? (
              <LoadingRows />
            ) : state.error ? (
              <div className="rh-all-requests-empty rh-all-requests-empty--error">
                <span className="rh-all-requests-empty__icon"><Icon name="alert" size={24} /></span>
                <strong>Impossible de charger les demandes.</strong>
                <span>Vérifiez la connexion au backend puis réessayez.</span>
                <button type="button" onClick={load}>Réessayer</button>
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="rh-all-requests-empty">
                <span className="rh-all-requests-empty__icon"><Icon name="doc" size={24} /></span>
                <strong>Aucune demande trouvée</strong>
                <span>Modifiez votre recherche ou vos filtres.</span>
              </div>
            ) : (
              visibleRequests.map((request) => {
                const meta = statusMeta(request.status)
                return (
                  <button
                    type="button"
                    className="rh-all-requests-row rh-all-requests-row--data"
                    role="row"
                    key={request.id}
                    onClick={() => navigate(`/app/rh-all-requests/${request.id}`)}
                  >
                    <span className="rh-all-requests-person">
                      <span className="rh-all-requests-avatar">{initials(request.employee)}</span>
                      <span>
                        <strong>{request.employee?.prenom} {request.employee?.nom}</strong>
                        <small>{request.service?.name ?? 'Service non renseigné'}</small>
                      </span>
                    </span>
                    <span className="rh-all-requests-type">{request.leaveType?.name ?? '—'}</span>
                    <span>{formatDateNumericFR(request.startDate)}</span>
                    <span>{formatDateNumericFR(request.endDate)}</span>
                    <span className="rh-all-requests-duration">{formatDays(Number(request.deductedDays) || 0)} j</span>
                    <span><span className={`rh-request-status rh-request-status--${meta.tone}`}>{meta.label}</span></span>
                    <span>{formatDateTime(request.submittedAt)}</span>
                    <span className="rh-all-requests-open"><Icon name="eye" size={17} /></span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {!state.loading && !state.error && filteredRequests.length > 0 && (
          <footer className="rh-all-requests-footer">
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

    </PageContainer>
  )
}
