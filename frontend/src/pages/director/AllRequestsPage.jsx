import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  getDirectorAllRequests,
  getDirectorPendingRequests,
  getDirectorRequestFilterOptions,
} from '@/services/director/directorRequests'
import { formatDateNumericFR, formatDays } from '@/utils/format'
import { buildGroupedServiceOptions, isReservedDirectorLeaveType, matchesGroupedServiceFilter } from '@/utils/filterOptions'
import { requestValidationStageMeta } from '@/utils/requestValidationStage'

import '@/styles/director/all-requests.css'

const PAGE_SIZE = 8

const STATUS_META = {
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'pending' },
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


function statusMeta(request) {
  const stage = requestValidationStageMeta(request)
  if (stage) return stage
  return STATUS_META[request?.status] ?? { label: request?.status || '—', tone: 'neutral' }
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
    request.employee?.role,
    request.leaveType?.name,
    request.service?.name,
    request.startDate,
    request.endDate,
    statusMeta(request).label,
    request.finalDecider?.prenom,
    request.finalDecider?.nom,
    request.id,
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, index) => (
    <div className="director-all-requests-skeleton" key={index} aria-hidden="true">
      <span className="director-all-requests-skeleton__avatar" />
      <span className="director-all-requests-skeleton__line director-all-requests-skeleton__line--name" />
      <span className="director-all-requests-skeleton__line" />
      <span className="director-all-requests-skeleton__line" />
      <span className="director-all-requests-skeleton__line" />
    </div>
  ))
}

export function DirectorAllRequestsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState({
    loading: true,
    error: false,
    requests: [],
    filterOptions: { services: [], leaveTypes: [] },
    actionableIds: [],
  })
  const [statusFilter, setStatusFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const search = searchParams.get('q') ?? ''
  const actionableOnly = searchParams.get('actionable') === '1'

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: false }))
    }

    try {
      const [requests, actionableRequests, filterOptions] = await Promise.all([
        getDirectorAllRequests(),
        getDirectorPendingRequests().catch(() => []),
        getDirectorRequestFilterOptions().catch(() => ({ services: [], leaveTypes: [] })),
      ])

      setState({
        loading: false,
        error: false,
        requests,
        actionableIds: actionableRequests.map((request) => String(request.id)),
        filterOptions,
      })
    } catch {
      if (!silent) {
        setState({
          loading: false,
          error: true,
          requests: [],
          actionableIds: [],
          filterOptions: { services: [], leaveTypes: [] },
        })
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

  useEffect(() => {
    if (actionableOnly) setStatusFilter('pending')
  }, [actionableOnly])

  const actionableIds = useMemo(() => new Set(state.actionableIds.map(String)), [state.actionableIds])

  const serviceRecords = useMemo(() => {
    const values = new Map()
    state.filterOptions.services.forEach((service) => {
      if (service?.id && service?.name) values.set(String(service.id), service)
    })
    state.requests.forEach((request) => {
      if (request.service?.id && request.service?.name && !values.has(String(request.service.id))) {
        values.set(String(request.service.id), request.service)
      }
    })
    return [...values.values()]
  }, [state.filterOptions.services, state.requests])

  const services = useMemo(() => buildGroupedServiceOptions(serviceRecords), [serviceRecords])
  const externalServiceIds = useMemo(() => new Set(
    serviceRecords
      .filter((service) => service?.serviceType === 'EXTERNE' || service?.externalCompanyName)
      .map((service) => String(service.id)),
  ), [serviceRecords])

  const leaveTypes = useMemo(() => {
    const values = new Map()

    state.filterOptions.leaveTypes.forEach((leaveType) => {
      if (leaveType?.id && leaveType?.name && !isReservedDirectorLeaveType(leaveType)) values.set(String(leaveType.id), leaveType.name)
    })

    state.requests.forEach((request) => {
      if (request.leaveType?.id && request.leaveType?.name && !isReservedDirectorLeaveType(request.leaveType)) {
        values.set(String(request.leaveType.id), request.leaveType.name)
      }
    })

    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.filterOptions.leaveTypes, state.requests])

  const employeeOptions = useMemo(() => {
    const values = new Map()
    state.requests.forEach((request) => {
      if (request.employee?.id) {
        values.set(String(request.employee.id), `${request.employee.nom ?? ''} ${request.employee.prenom ?? ''}`.trim())
      }
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'))
  }, [state.requests])

  const scopedRequests = useMemo(
    () => actionableOnly ? state.requests.filter((request) => actionableIds.has(String(request.id))) : state.requests,
    [actionableIds, actionableOnly, state.requests],
  )

  const counts = useMemo(() => ({
    all: scopedRequests.length,
    pending: scopedRequests.filter((request) => statusMatchesFilter(request.status, 'pending')).length,
    approved: scopedRequests.filter((request) => statusMatchesFilter(request.status, 'approved')).length,
    refused: scopedRequests.filter((request) => statusMatchesFilter(request.status, 'refused')).length,
    cancelled: scopedRequests.filter((request) => statusMatchesFilter(request.status, 'cancelled')).length,
  }), [scopedRequests])

  const activeAdvancedFilters = [
    serviceFilter !== 'all',
    typeFilter !== 'all',
    employeeFilter !== 'all',
  ].filter(Boolean).length

  const filteredRequests = useMemo(() => {
    const result = scopedRequests.filter((request) => {
      if (!statusMatchesFilter(request.status, statusFilter)) return false
      if (!matchesGroupedServiceFilter(request.service?.id, serviceFilter, externalServiceIds)) return false
      if (typeFilter !== 'all' && String(request.leaveType?.id) !== typeFilter) return false
      if (employeeFilter !== 'all' && String(request.employee?.id) !== employeeFilter) return false
      return requestMatchesSearch(request, search)
    })

    return result.sort((left, right) => {
      const leftPending = statusMatchesFilter(left.status, 'pending')
      const rightPending = statusMatchesFilter(right.status, 'pending')
      if (leftPending !== rightPending) return leftPending ? -1 : 1

      if (leftPending && rightPending) {
        const byStart = String(left.startDate ?? '').localeCompare(String(right.startDate ?? ''))
        if (byStart !== 0) return byStart
        return new Date(left.submittedAt ?? left.createdAt ?? 0).getTime() - new Date(right.submittedAt ?? right.createdAt ?? 0).getTime()
      }

      return new Date(right.decisionAt ?? right.submittedAt ?? right.createdAt ?? 0).getTime() - new Date(left.decisionAt ?? left.submittedAt ?? left.createdAt ?? 0).getTime()
    })
  }, [employeeFilter, externalServiceIds, scopedRequests, search, serviceFilter, statusFilter, typeFilter])

  useEffect(() => {
    setPage(1)
  }, [employeeFilter, search, serviceFilter, statusFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleRequests = filteredRequests.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const resetFilters = () => {
    setServiceFilter('all')
    setTypeFilter('all')
    setEmployeeFilter('all')
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('q')
    nextParams.delete('actionable')
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <PageContainer className="director-all-requests-page">
      <section className="director-all-requests-card">
        <div className="director-all-requests-toolbar">
          <div className="director-all-requests-tabs" role="tablist" aria-label="Statut des demandes">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === filter.id}
                className={`director-all-requests-tab${statusFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => {
                  setStatusFilter(filter.id)
                  if (actionableOnly) {
                    const nextParams = new URLSearchParams(searchParams)
                    nextParams.delete('actionable')
                    setSearchParams(nextParams, { replace: true })
                  }
                }}
              >
                <span>{filter.label}</span>
                <span className="director-all-requests-tab__count">{counts[filter.id]}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`director-all-requests-filter-button${filtersOpen ? ' is-active' : ''}${activeAdvancedFilters ? ' has-filters' : ''}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" size={15} />
            <span>Filtres</span>
            {activeAdvancedFilters > 0 && (
              <span className="director-all-requests-filter-button__count">{activeAdvancedFilters}</span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="director-all-requests-filter-panel">
            <label>
              <span>Service</span>
              <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
                <option value="all">Tous les services</option>
                {services.map((service) => <option key={service.value} value={service.value}>{service.label}</option>)}
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
              <span>Collaborateur</span>
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                <option value="all">Tous les collaborateurs</option>
                {employeeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>

            <button
              type="button"
              className="director-all-requests-reset"
              disabled={activeAdvancedFilters === 0 && !search.trim()}
              onClick={resetFilters}
            >
              <Icon name="refresh" size={15} />
              Réinitialiser
            </button>
          </div>
        )}

        <div className="director-all-requests-table-wrap">
          <div className="director-all-requests-table" role="table" aria-label="Toutes les demandes de congé">
            <div className="director-all-requests-row director-all-requests-row--header" role="row">
              <span>Collaborateur</span>
              <span>Type de congé</span>
              <span>Début</span>
              <span>Fin</span>
              <span>Durée</span>
              <span>Statut</span>
              <span>Soumis le</span>
              <span>Refusé le</span>
              <span aria-hidden="true" />
            </div>

            {state.loading ? (
              <LoadingRows />
            ) : state.error ? (
              <div className="director-all-requests-empty director-all-requests-empty--error">
                <span className="director-all-requests-empty__icon"><Icon name="alert" size={24} /></span>
                <strong>Impossible de charger les demandes.</strong>
                <span>Vérifiez la connexion au backend puis réessayez.</span>
                <button type="button" onClick={() => load()}>Réessayer</button>
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="director-all-requests-empty">
                <span className="director-all-requests-empty__icon"><Icon name="doc" size={24} /></span>
                <strong>Aucune demande trouvée</strong>
                <span>Modifiez votre recherche ou vos filtres.</span>
              </div>
            ) : (
              visibleRequests.map((request) => {
                const meta = statusMeta(request)

                return (
                  <button
                    type="button"
                    className={`director-all-requests-row director-all-requests-row--data${request.hasAvailabilityAlert ? ' is-warning' : ''}`}
                    role="row"
                    key={request.id}
                    onClick={() => navigate(`/app/director-all-requests/${request.id}`)}
                  >
                    <span className="director-all-requests-person">
                      <ProfileAvatar user={request.employee} className="director-all-requests-avatar" />
                      <span>
                        <strong>{request.employee?.nom} {request.employee?.prenom}</strong>
                        <small>{request.service?.name ?? 'Service non renseigné'}</small>
                      </span>
                    </span>
                    <span className="director-all-requests-type">{request.leaveType?.name ?? '—'}</span>
                    <span>{formatDateNumericFR(request.startDate)}</span>
                    <span>{formatDateNumericFR(request.endDate)}</span>
                    <span className="director-all-requests-duration">{formatDays(Number(request.deductedDays) || 0)} j</span>
                    <span><span className={`director-request-status director-request-status--${meta.tone}`}>{meta.label}</span></span>
                    <span>{formatDateTime(request.submittedAt)}</span>
                    <span>{request.status === 'REFUSEE' ? formatDateTime(request.decisionAt) : '—'}</span>
                    <span className="director-all-requests-open"><Icon name="eye" size={17} /></span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {!state.loading && !state.error && filteredRequests.length > 0 && (
          <footer className="director-all-requests-footer">
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
