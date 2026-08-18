import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ManagerRequestCard } from '@/components/manager/requests/ManagerRequestCard'
import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import {
  getManagerPendingRequests,
  getManagerRequestAvailability,
} from '@/services/managerRequests'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

import '@/styles/manager/requests/index.css'

const PAGE_SIZE = 8

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'urgent', label: 'Urgentes' },
  { id: 'alerts', label: 'Avec alerte' },
  { id: 'standard', label: 'Standards' },
]

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function matchesSearch(request, availability, query) {
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
    formatRangeNumericFR(request.startDate, request.endDate),
    `${formatDays(Number(request.deductedDays) || 0)} j`,
    request.isUrgent ? 'urgente' : 'en attente',
    availability?.minimumPresenceBreached ? 'presence minimale alerte' : '',
    ...(availability?.overlaps ?? []).flatMap((item) => [item.prenom, item.nom]),
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
}

function LoadingState() {
  return (
    <div className="manager-requests-list" aria-label="Chargement des demandes">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="manager-requests-skeleton" key={index} aria-hidden="true">
          <span className="manager-requests-skeleton__avatar" />
          <span className="manager-requests-skeleton__body">
            <span className="manager-requests-skeleton__line manager-requests-skeleton__line--title" />
            <span className="manager-requests-skeleton__line" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ManagerRequestsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [state, setState] = useState({
    loading: true,
    error: false,
    requests: [],
    availabilityById: {},
  })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))

    try {
      const requests = await getManagerPendingRequests()
      const safeRequests = Array.isArray(requests) ? requests : []

      const availabilityResults = await Promise.allSettled(
        safeRequests.map((request) => getManagerRequestAvailability(request.id)),
      )

      const availabilityById = {}
      safeRequests.forEach((request, index) => {
        const result = availabilityResults[index]
        if (result?.status === 'fulfilled') {
          availabilityById[request.id] = result.value
        }
      })

      setState({
        loading: false,
        error: false,
        requests: safeRequests,
        availabilityById,
      })
    } catch {
      setState({ loading: false, error: true, requests: [], availabilityById: {} })
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

  const counts = useMemo(() => {
    const alerts = state.requests.filter((request) => {
      const availability = state.availabilityById[request.id]
      return Boolean(availability?.minimumPresenceBreached || availability?.overlaps?.length)
    }).length

    return {
      all: state.requests.length,
      urgent: state.requests.filter((request) => request.isUrgent).length,
      alerts,
      standard: state.requests.filter((request) => !request.isUrgent).length,
    }
  }, [state.availabilityById, state.requests])

  const query = searchParams.get('q') ?? ''

  const visibleRequests = useMemo(() => state.requests.filter((request) => {
      const availability = state.availabilityById[request.id]
      const hasAlert = Boolean(
        availability?.minimumPresenceBreached || availability?.overlaps?.length,
      )

      if (filter === 'urgent' && !request.isUrgent) return false
      if (filter === 'alerts' && !hasAlert) return false
      if (filter === 'standard' && request.isUrgent) return false

      return matchesSearch(request, availability, query)
    }), [filter, query, state.availabilityById, state.requests])

  useEffect(() => setPage(1), [filter, query])

  const totalPages = Math.max(1, Math.ceil(visibleRequests.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRequests = visibleRequests.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  return (
    <div className="manager-requests-page">
      <div className="manager-requests-toolbar">
        <div className="manager-requests-filters" role="tablist" aria-label="Filtres des demandes">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`manager-requests-filter${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              <span>{item.label}</span>
              <span className="manager-requests-filter__count">{counts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="manager-requests-summary">
          <span className="manager-requests-summary__icon"><Icon name="list" size={18} /></span>
          <span>
            <strong>{state.requests.length}</strong>
            {state.requests.length > 1 ? ' demandes à traiter' : ' demande à traiter'}
          </span>
        </div>
      </div>

      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <div className="manager-requests-state manager-requests-state--error">
          <span className="manager-requests-state__icon"><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger les demandes.</strong>
          <span>Vérifiez la connexion au backend puis réessayez.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : state.requests.length === 0 ? (
        <div className="manager-requests-state">
          <span className="manager-requests-state__icon"><Icon name="check" size={25} /></span>
          <strong>Aucune demande à traiter</strong>
          <span>Votre file de validation est à jour.</span>
        </div>
      ) : visibleRequests.length === 0 ? (
        <div className="manager-requests-state">
          <span className="manager-requests-state__icon"><Icon name="list" size={25} /></span>
          <strong>{query ? 'Aucune demande ne correspond à votre recherche.' : 'Aucune demande dans cette catégorie.'}</strong>
        </div>
      ) : (
        <>
          <div className="manager-requests-list">
            {pageRequests.map((request) => (
              <ManagerRequestCard
                key={request.id}
                request={request}
                availability={state.availabilityById[request.id]}
                onOpen={(id) => navigate(`/app/requests/${id}`)}
              />
            ))}
          </div>
          <div className="manager-requests-pagination-footer">
            <span>{visibleRequests.length} demande{visibleRequests.length > 1 ? 's' : ''}</span>
            <PaginationBar
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={visibleRequests.length}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  )
}
