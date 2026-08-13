import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { MyRequestCard } from '@/components/collab/requests/MyRequestCard'
import { getRequestStatusLabel } from '@/components/collab/requests/RequestStatusBadge'
import { Icon } from '@/components/ui/Icon'
import { getMyDocuments } from '@/services/documents'
import { getMyAbsenceDeclarations, getMyLeaveRequests } from '@/services/myRequests'
import { deleteAbsenceDraft, deleteLeaveDraft, downloadCancellationPdf, downloadPendingSummaryPdf, downloadValidationPdf } from '@/services/requestDetails'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

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

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function matchesSearch(item, query) {
  const normalizedQuery = normalizeSearchValue(query)

  if (!normalizedQuery) {
    return true
  }

  const duration = `${formatDays(item.duration)} ${item.durationUnit}`
  const searchableText = [
    item.type,
    getRequestStatusLabel(item.status),
    item.status,
    item.startDate,
    item.endDate,
    formatRangeNumericFR(item.startDate, item.endDate),
    duration,
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => searchableText.includes(token))
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

function EmptyState({ globalEmpty, hasSearch, onCreate }) {
  return (
    <div className="my-requests-empty">
      <span className="my-requests-empty__icon" aria-hidden="true">
        <Icon name="list" size={26} />
      </span>
      <strong>
        {globalEmpty
          ? 'Aucune demande pour le moment.'
          : hasSearch
            ? 'Aucune demande ne correspond à votre recherche.'
            : 'Aucune demande dans cette catégorie.'}
      </strong>
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
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [busyKey, setBusyKey] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [state, setState] = useState({
    loading: true,
    leaveRequests: [],
    absences: [],
    documents: [],
    leaveError: false,
    absenceError: false,
    documentsError: false,
  })

  const load = useCallback(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      leaveError: false,
      absenceError: false,
      documentsError: false,
    }))

    const [leaveResult, absenceResult, documentsResult] = await Promise.allSettled([
      getMyLeaveRequests(),
      getMyAbsenceDeclarations(),
      getMyDocuments(),
    ])

    setState({
      loading: false,
      leaveRequests: leaveResult.status === 'fulfilled' ? leaveResult.value ?? [] : [],
      absences: absenceResult.status === 'fulfilled' ? absenceResult.value ?? [] : [],
      documents: documentsResult.status === 'fulfilled' ? documentsResult.value ?? [] : [],
      leaveError: leaveResult.status === 'rejected',
      absenceError: absenceResult.status === 'rejected',
      documentsError: documentsResult.status === 'rejected',
    })
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

  const items = useMemo(() => {
    const availablePdfKindsByRequestId = new Map()
    for (const document of state.documents) {
      if (!document?.leaveRequestId) continue
      if (!['PDF_VALIDATION', 'PDF_ANNULATION'].includes(document.documentKind)) continue

      const requestId = Number(document.leaveRequestId)
      const kinds = availablePdfKindsByRequestId.get(requestId) ?? new Set()
      kinds.add(document.documentKind)
      availablePdfKindsByRequestId.set(requestId, kinds)
    }

    const leaveItems = state.leaveRequests.map((request) => {
      const item = normalizeLeaveRequest(request)
      const kinds = availablePdfKindsByRequestId.get(Number(request.id)) ?? new Set()
      const downloadDocumentKind = request.status === 'ANNULEE_APRES_VALIDATION'
        ? kinds.has('PDF_ANNULATION')
          ? 'PDF_ANNULATION'
          : kinds.has('PDF_VALIDATION')
            ? 'PDF_VALIDATION'
            : null
        : kinds.has('PDF_VALIDATION')
          ? 'PDF_VALIDATION'
          : null

      return {
        ...item,
        canDownloadPdf: Boolean(downloadDocumentKind),
        downloadDocumentKind,
      }
    })
    const absenceItems = state.absences.map(normalizeAbsenceDeclaration)
    return [...leaveItems, ...absenceItems].sort(sortNewestFirst)
  }, [state.leaveRequests, state.absences, state.documents])

  const searchQuery = searchParams.get('q') ?? ''

  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && matchesSearch(item, searchQuery)),
    [filter, items, searchQuery],
  )

  const totalFailure = !state.loading && state.leaveError && state.absenceError
  const partialFailure = !state.loading && !totalFailure && (state.leaveError || state.absenceError || state.documentsError)

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const openItem = (item) => {
    if (item.status === 'BROUILLON') {
      navigate(item.source === 'leave' ? `/app/new-request/${item.id}` : `/app/declare-absence/${item.id}`)
      return
    }
    navigate(`/app/my-requests/${item.source}/${item.id}`)
  }

  const removeItemLocally = (item) => {
    if (item.source === 'leave') {
      setState((current) => ({
        ...current,
        leaveRequests: current.leaveRequests.filter((request) => Number(request.id) !== Number(item.id)),
      }))
    } else {
      setState((current) => ({
        ...current,
        absences: current.absences.filter((declaration) => Number(declaration.id) !== Number(item.id)),
      }))
    }
  }

  const handleCardAction = async (item, action) => {
    if (busyKey) return

    if (action === 'delete') {
      const label = item.source === 'leave' ? 'cette demande de congé' : 'cette déclaration d’absence'
      if (!window.confirm(`Supprimer définitivement le brouillon de ${label} ?`)) return
      setBusyKey(item.key)
      try {
        if (item.source === 'leave') await deleteLeaveDraft(item.id)
        else await deleteAbsenceDraft(item.id)
        removeItemLocally(item)
        setFeedback({ kind: 'success', message: 'Brouillon supprimé.' })
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: error.response?.data?.message || error.message || 'Impossible de supprimer ce brouillon.',
        })
      } finally {
        setBusyKey(null)
      }
      return
    }

    if (action === 'summary' && item.source === 'leave') {
      setBusyKey(item.key)
      try {
        await downloadPendingSummaryPdf(item.id)
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: error.response?.data?.message || error.message || 'Impossible de télécharger le récapitulatif.',
        })
      } finally {
        setBusyKey(null)
      }
      return
    }

    if (action === 'download' && item.source === 'leave') {
      setBusyKey(item.key)
      try {
        if (item.downloadDocumentKind === 'PDF_ANNULATION') {
          await downloadCancellationPdf(item.id)
        } else {
          await downloadValidationPdf(item.id)
        }
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: error.response?.data?.message || error.message || 'Impossible de télécharger ce document.',
        })
      } finally {
        setBusyKey(null)
      }
    }
  }

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

      {feedback && (
        <div className={`my-requests-feedback my-requests-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

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
          hasSearch={Boolean(searchQuery.trim())}
          onCreate={() => navigate('/app/new-request')}
        />
      ) : (
        <div className="my-requests-list">
          {filteredItems.map((item) => (
            <MyRequestCard key={item.key} item={item} busy={busyKey === item.key} onOpen={openItem} onAction={handleCardAction} />
          ))}
        </div>
      )}
    </section>
  )
}
