import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { MyRequestCard } from '@/components/collab/requests/MyRequestCard'
import { Icon } from '@/components/ui/Icon'
import { getMyAbsenceDeclarations, getMyLeaveRequests } from '@/services/myRequests'

import '@/styles/requests.css'

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'pending', label: 'En attente' },
  { key: 'validated', label: 'Validées' },
  { key: 'refused', label: 'Refusées' },
  { key: 'drafts', label: 'Brouillons' },
]

const FILTER_STATUSES = {
  pending: new Set([
    'EN_ATTENTE_VALIDATION',
    'ANNULATION_EN_ATTENTE_ACCORD',
    'DECLAREE',
    'JUSTIFICATIF_EN_ATTENTE',
    'A_VERIFIER_PAR_RH',
  ]),
  validated: new Set(['VALIDEE', 'ENREGISTREE']),
  refused: new Set(['REFUSEE', 'JUSTIFICATIF_REJETE']),
  drafts: new Set(['BROUILLON']),
}

function normalizeLeaveRequest(request) {
  return {
    key: `leave-${request.id}`,
    id: request.id,
    source: 'leave',
    type: request.leaveType?.name || 'Demande de congé',
    startDate: request.startDate,
    endDate: request.endDate,
    duration: Number(request.deductedDays) || 0,
    durationUnit: 'j',
    status: request.status,
    sortDate: request.createdAt || request.updatedAt || request.submittedAt || request.startDate,
  }
}

function normalizeAbsenceDeclaration(declaration) {
  const hasHours = declaration.durationHours !== null && declaration.durationHours !== undefined

  return {
    key: `absence-${declaration.id}`,
    id: declaration.id,
    source: 'absence',
    type: declaration.leaveType?.name || "Déclaration d'absence",
    startDate: declaration.startDate,
    endDate: declaration.endDate,
    duration: Number(hasHours ? declaration.durationHours : declaration.durationDays) || 0,
    durationUnit: hasHours ? 'h' : 'j',
    status: declaration.status,
    sortDate: declaration.createdAt || declaration.updatedAt || declaration.declaredAt || declaration.startDate,
  }
}

function sortNewestFirst(left, right) {
  const leftTime = Date.parse(left.sortDate || '') || 0
  const rightTime = Date.parse(right.sortDate || '') || 0
  return rightTime - leftTime
}

function matchesFilter(item, filter) {
  if (filter === 'all') {
    return true
  }

  return FILTER_STATUSES[filter]?.has(item.status) ?? false
}

function LoadingState() {
  return (
    <div className="my-requests-list" aria-label="Chargement des demandes">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="my-request-skeleton" key={index} aria-hidden="true">
          <span className="my-request-skeleton__icon" />
          <div className="my-request-skeleton__content">
            <span className="my-request-skeleton__line my-request-skeleton__line--title" />
            <span className="my-request-skeleton__line my-request-skeleton__line--meta" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ globalEmpty, onCreate }) {
  return (
    <div className="my-requests-empty">
      <span className="my-requests-empty__icon" aria-hidden="true">
        <Icon name="list" size={26} />
      </span>
      <strong>{globalEmpty ? 'Aucune demande pour le moment.' : 'Aucune demande dans cette catégorie.'}</strong>
      {globalEmpty && (
        <button type="button" className="my-requests-empty__button" onClick={onCreate}>
          <Icon name="plus" size={15} />
          Nouvelle demande
        </button>
      )}
    </div>
  )
}

export function MyRequestsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [state, setState] = useState({
    loading: true,
    leaveRequests: [],
    absences: [],
    leaveError: false,
    absenceError: false,
  })

  const load = useCallback(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      leaveError: false,
      absenceError: false,
    }))

    const [leaveResult, absenceResult] = await Promise.allSettled([
      getMyLeaveRequests(),
      getMyAbsenceDeclarations(),
    ])

    setState({
      loading: false,
      leaveRequests: leaveResult.status === 'fulfilled' ? leaveResult.value ?? [] : [],
      absences: absenceResult.status === 'fulfilled' ? absenceResult.value ?? [] : [],
      leaveError: leaveResult.status === 'rejected',
      absenceError: absenceResult.status === 'rejected',
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const items = useMemo(() => {
    const leaveItems = state.leaveRequests.map(normalizeLeaveRequest)
    const absenceItems = state.absences.map(normalizeAbsenceDeclaration)
    return [...leaveItems, ...absenceItems].sort(sortNewestFirst)
  }, [state.leaveRequests, state.absences])

  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilter(item, filter)),
    [filter, items],
  )

  const totalFailure = !state.loading && state.leaveError && state.absenceError
  const partialFailure = !state.loading && !totalFailure && (state.leaveError || state.absenceError)

  return (
    <section className="my-requests-page">
      <div className="my-requests-toolbar">
        <div className="my-requests-filters" role="tablist" aria-label="Filtrer les demandes">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={`my-requests-filter${filter === item.key ? ' is-active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="my-requests-new-button"
          onClick={() => navigate('/app/new-request')}
        >
          <Icon name="plus" size={15} />
          Nouvelle demande
        </button>
      </div>

      {partialFailure && (
        <div className="my-requests-notice" role="status">
          <Icon name="info" size={16} />
          <span>
            Une partie de vos informations n’a pas pu être chargée. Les données disponibles sont affichées.
          </span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      )}

      {state.loading ? (
        <LoadingState />
      ) : totalFailure ? (
        <div className="my-requests-error" role="alert">
          <span className="my-requests-error__icon" aria-hidden="true">
            <Icon name="alert" size={24} />
          </span>
          <strong>Impossible de charger vos demandes</strong>
          <span>Les informations sont momentanément indisponibles.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          globalEmpty={items.length === 0}
          onCreate={() => navigate('/app/new-request')}
        />
      ) : (
        <div className="my-requests-list">
          {filteredItems.map((item) => (
            <MyRequestCard key={item.key} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
