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
  EN_COURS_TRAITEMENT: { label: 'En cours de traitement', tone: 'pending' },
  VALIDEE: { label: 'Validée · traitement terminé', tone: 'approved' },
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
  return `${employee?.nom?.[0] ?? ''}${employee?.prenom?.[0] ?? ''}`.toUpperCase() || '—'
}

function effectiveStatus(request) {
  if (request?.status === 'EN_ATTENTE_VALIDATION' && request?.finalDeciderId) {
    return 'EN_COURS_TRAITEMENT'
  }
  return request?.status
}

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status || '—', tone: 'neutral' }
}

function requestUrgencyScore(request) {
  const status = effectiveStatus(request)
  if (request?.isUrgent && ['EN_ATTENTE_VALIDATION', 'EN_COURS_TRAITEMENT'].includes(status)) return 600
  if (status === 'EN_COURS_TRAITEMENT') return 500
  if (status === 'EN_ATTENTE_VALIDATION') return 350
  if (status === 'ANNULATION_EN_ATTENTE_ACCORD') return 300
  return 0
}

function sortMostUrgentFirst(left, right) {
  const scoreDiff = requestUrgencyScore(right) - requestUrgencyScore(left)
  if (scoreDiff !== 0) return scoreDiff

  const leftStart = left?.startDate ? new Date(`${left.startDate}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER
  const rightStart = right?.startDate ? new Date(`${right.startDate}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER
  if (leftStart !== rightStart) return leftStart - rightStart

  const leftSubmitted = new Date(left?.submittedAt ?? left?.createdAt ?? 0).getTime()
  const rightSubmitted = new Date(right?.submittedAt ?? right?.createdAt ?? 0).getTime()
  return leftSubmitted - rightSubmitted
}

function statusMatchesFilter(status, filter) {
  if (filter === 'all') return true
  if (filter === 'pending') {
    return ['EN_ATTENTE_VALIDATION', 'EN_COURS_TRAITEMENT', 'ANNULATION_EN_ATTENTE_ACCORD'].includes(status)
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
    statusMeta(effectiveStatus(request)).label,
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
  const requestedStatus = searchParams.get('status') ?? 'all'
  const statusFilter = STATUS_FILTERS.some((filter) => filter.id === requestedStatus) ? requestedStatus : 'all'
  const search = searchParams.get('q') ?? ''
  const dateFrom = searchParams.get('from') ?? ''
  const dateTo = searchParams.get('to') ?? ''
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

  const externalServiceIds = useMemo(() => new Set(
    state.filterOptions.services
      .filter((service) => service?.serviceType === 'EXTERNE' || service?.externalCompanyName)
      .map((service) => String(service.id)),
  ), [state.filterOptions.services])

  const services = useMemo(() => {
    const values = new Map()
    state.filterOptions.services.forEach((service) => {
      if (!service?.id || !service?.name) return
      if (service.serviceType === 'EXTERNE' || service.externalCompanyName) return
      values.set(String(service.id), service.name)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.services])

  const leaveTypes = useMemo(() => {
    const values = new Map()
    state.filterOptions.leaveTypes.forEach((leaveType) => {
      if (leaveType?.id && leaveType?.name) values.set(String(leaveType.id), leaveType.name)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.leaveTypes])

  const counts = useMemo(() => {
    const requests = state.requests.filter((request) => request.employee?.role !== 'DIRECTEUR')
    return {
      all: requests.length,
      pending: requests.filter((request) => statusMatchesFilter(effectiveStatus(request), 'pending')).length,
      approved: requests.filter((request) => statusMatchesFilter(effectiveStatus(request), 'approved')).length,
      refused: requests.filter((request) => statusMatchesFilter(effectiveStatus(request), 'refused')).length,
      cancelled: requests.filter((request) => statusMatchesFilter(effectiveStatus(request), 'cancelled')).length,
    }
  }, [state.requests])

  const filteredRequests = useMemo(() => state.requests.filter((request) => {
    if (request.employee?.role === 'DIRECTEUR') return false
    if (!statusMatchesFilter(effectiveStatus(request), statusFilter)) return false
    if (serviceFilter === 'external' && !externalServiceIds.has(String(request.service?.id))) return false
    if (serviceFilter !== 'all' && serviceFilter !== 'external' && String(request.service?.id) !== serviceFilter) return false
    if (typeFilter !== 'all' && String(request.leaveType?.id) !== typeFilter) return false
    if (dateFrom && request.endDate && request.endDate < dateFrom) return false
    if (dateTo && request.startDate && request.startDate > dateTo) return false
    return requestMatchesSearch(request, search)
  }).sort(sortMostUrgentFirst), [dateFrom, dateTo, externalServiceIds, search, serviceFilter, state.requests, statusFilter, typeFilter])

  useEffect(() => {
    setPage(1)
  }, [dateFrom, dateTo, search, serviceFilter, statusFilter, typeFilter])

  const updateQueryParam = (key, value) => {
    const nextParams = new URLSearchParams(searchParams)
    if (value && value !== 'all') nextParams.set(key, value)
    else nextParams.delete(key)
    setSearchParams(nextParams, { replace: true })
  }

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
                onClick={() => updateQueryParam('status', filter.id)}
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
                {externalServiceIds.size > 0 && <option value="external">Mis à disposition</option>}
              </select>
            </label>
            <label>
              <span>Type de congé</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">Tous les types de congés</option>
                {leaveTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>Date du congé · du</span>
              <input type="date" value={dateFrom} onChange={(event) => updateQueryParam('from', event.target.value)} />
            </label>
            <label>
              <span>Date du congé · au</span>
              <input type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => updateQueryParam('to', event.target.value)} />
            </label>
            <button
              type="button"
              className="rh-all-requests-reset"
              onClick={() => {
                setServiceFilter('all')
                setTypeFilter('all')
                const nextParams = new URLSearchParams(searchParams)
                nextParams.delete('q')
                nextParams.delete('from')
                nextParams.delete('to')
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
              <span>Refusée le</span>
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
                const meta = statusMeta(effectiveStatus(request))
                return (
                  <button
                    type="button"
                    className={`rh-all-requests-row rh-all-requests-row--data${request.hasAvailabilityAlert ? ' is-warning' : ''}`}
                    role="row"
                    key={request.id}
                    onClick={() => navigate(`/app/rh-all-requests/${request.id}`)}
                  >
                    <span className="rh-all-requests-person">
                      <span className="rh-all-requests-avatar">{initials(request.employee)}</span>
                      <span>
                        <strong>{request.employee?.nom} {request.employee?.prenom}</strong>
                        <small>{request.service?.name ?? 'Service non renseigné'}</small>
                      </span>
                    </span>
                    <span className="rh-all-requests-type">{request.leaveType?.name ?? '—'}</span>
                    <span>{formatDateNumericFR(request.startDate)}</span>
                    <span>{formatDateNumericFR(request.endDate)}</span>
                    <span className="rh-all-requests-duration">{formatDays(Number(request.deductedDays) || 0)} j</span>
                    <span><span className={`rh-request-status rh-request-status--${meta.tone}`}>{meta.label}</span></span>
                    <span>{formatDateTime(request.submittedAt)}</span>
                    <span>{effectiveStatus(request) === 'REFUSEE' ? formatDateTime(request.decisionAt) : '—'}</span>
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
