import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import { getManagerAllRequests } from '@/services/manager/managerRequests'
import { formatDateNumericFR, formatDays } from '@/utils/format'

import '@/styles/manager/requests/all-requests.css'

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
    <div className="manager-all-requests-skeleton" key={index} aria-hidden="true">
      <span className="manager-all-requests-skeleton__avatar" />
      <span className="manager-all-requests-skeleton__line manager-all-requests-skeleton__line--name" />
      <span className="manager-all-requests-skeleton__line" />
      <span className="manager-all-requests-skeleton__line" />
      <span className="manager-all-requests-skeleton__line" />
    </div>
  ))
}

export function ManagerRequestsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState({ loading: true, error: false, requests: [] })
  const [statusFilter, setStatusFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const search = searchParams.get('q') ?? ''

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: false }))
    }

    try {
      const requests = await getManagerAllRequests()
      setState({ loading: false, error: false, requests })
    } catch {
      if (!silent) {
        setState({ loading: false, error: true, requests: [] })
      }
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = () => load({ silent: true })
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load({ silent: true })
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

  const leaveTypes = useMemo(() => {
    const values = new Map()

    state.requests.forEach((request) => {
      if (request.leaveType?.id && request.leaveType?.name) {
        values.set(String(request.leaveType.id), request.leaveType.name)
      }
    })

    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.requests])

  const counts = useMemo(() => ({
    all: state.requests.length,
    pending: state.requests.filter((request) => statusMatchesFilter(request.status, 'pending')).length,
    approved: state.requests.filter((request) => statusMatchesFilter(request.status, 'approved')).length,
    refused: state.requests.filter((request) => statusMatchesFilter(request.status, 'refused')).length,
    cancelled: state.requests.filter((request) => statusMatchesFilter(request.status, 'cancelled')).length,
  }), [state.requests])

  const activeAdvancedFilters = typeFilter !== 'all' ? 1 : 0

  const filteredRequests = useMemo(() => state.requests.filter((request) => {
    if (!statusMatchesFilter(request.status, statusFilter)) return false
    if (typeFilter !== 'all' && String(request.leaveType?.id) !== typeFilter) return false
    return requestMatchesSearch(request, search)
  }), [search, state.requests, statusFilter, typeFilter])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleRequests = filteredRequests.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const resetFilters = () => {
    setTypeFilter('all')
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('q')
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <PageContainer className="manager-all-requests-page">
      <section className="manager-all-requests-card">
        <div className="manager-all-requests-toolbar">
          <div className="manager-all-requests-tabs" role="tablist" aria-label="Statut des demandes du service">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === filter.id}
                className={`manager-all-requests-tab${statusFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <span className="manager-all-requests-tab__count">{counts[filter.id]}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`manager-all-requests-filter-button${filtersOpen ? ' is-active' : ''}${activeAdvancedFilters ? ' has-filters' : ''}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" size={15} />
            <span>Filtres</span>
            {activeAdvancedFilters > 0 && (
              <span className="manager-all-requests-filter-button__count">{activeAdvancedFilters}</span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="manager-all-requests-filter-panel manager-all-requests-filter-panel--service">
            <label>
              <span>Type de congé</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">Tous les types de congés</option>
                {leaveTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>

            <button
              type="button"
              className="manager-all-requests-reset"
              disabled={activeAdvancedFilters === 0 && !search.trim()}
              onClick={resetFilters}
            >
              <Icon name="refresh" size={15} />
              Réinitialiser
            </button>
          </div>
        )}

        <div className="manager-all-requests-table-wrap">
          <div className="manager-all-requests-table" role="table" aria-label="Demandes du service">
            <div className="manager-all-requests-row manager-all-requests-row--header" role="row">
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
              <div className="manager-all-requests-empty manager-all-requests-empty--error">
                <span className="manager-all-requests-empty__icon"><Icon name="alert" size={24} /></span>
                <strong>Impossible de charger les demandes.</strong>
                <span>Vérifiez la connexion au backend puis réessayez.</span>
                <button type="button" onClick={() => load()}>Réessayer</button>
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="manager-all-requests-empty">
                <span className="manager-all-requests-empty__icon"><Icon name="doc" size={24} /></span>
                <strong>Aucune demande trouvée</strong>
                <span>Modifiez votre recherche ou vos filtres.</span>
              </div>
            ) : (
              visibleRequests.map((request) => {
                const meta = statusMeta(request.status)

                return (
                  <button
                    type="button"
                    className={`manager-all-requests-row manager-all-requests-row--data${request.hasAvailabilityAlert ? ' is-warning' : ''}`}
                    role="row"
                    key={request.id}
                    onClick={() => navigate(`/app/requests/${request.id}`)}
                  >
                    <span className="manager-all-requests-person">
                      <span className="manager-all-requests-avatar">{initials(request.employee)}</span>
                      <span>
                        <strong>{request.employee?.prenom} {request.employee?.nom}</strong>
                        <small>{request.service?.name ?? 'Service non renseigné'}</small>
                      </span>
                    </span>
                    <span className="manager-all-requests-type">{request.leaveType?.name ?? '—'}</span>
                    <span>{formatDateNumericFR(request.startDate)}</span>
                    <span>{formatDateNumericFR(request.endDate)}</span>
                    <span className="manager-all-requests-duration">{formatDays(Number(request.deductedDays) || 0)} j</span>
                    <span><span className={`manager-request-status manager-request-status--${meta.tone}`}>{meta.label}</span></span>
                    <span>{formatDateTime(request.submittedAt)}</span>
                    <span className="manager-all-requests-open"><Icon name="eye" size={17} /></span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {!state.loading && !state.error && filteredRequests.length > 0 && (
          <footer className="manager-all-requests-footer">
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
