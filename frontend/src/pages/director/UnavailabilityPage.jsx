import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import {
  cancelDirectorAbsence,
  cancelDirectorLeaveRequest,
  getDirectorAbsences,
  getDirectorLeaveRequests,
} from '@/services/director/directorUnavailability'
import { formatDateFR, formatDays, formatRangeNumericFR, todayISO } from '@/utils/format'
import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/director/unavailability.css'

const PAGE_SIZE = 8

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'upcoming', label: 'À venir' },
  { key: 'current', label: 'En cours' },
  { key: 'completed', label: 'Terminées' },
]

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function temporalStatus(item, today) {
  if (item.backendStatus === 'ANNULEE' || item.backendStatus === 'ANNULEE_APRES_VALIDATION') {
    return 'cancelled'
  }
  if (item.endDate < today) return 'completed'
  if (item.startDate > today) return 'upcoming'
  return 'current'
}

function statusMeta(status) {
  const values = {
    upcoming: { label: 'À venir', className: 'is-upcoming' },
    current: { label: 'En cours', className: 'is-current' },
    completed: { label: 'Terminée', className: 'is-completed' },
    cancelled: { label: 'Annulée', className: 'is-cancelled' },
  }
  return values[status] ?? values.completed
}

function periodLabel(value) {
  if (value === 'MATIN') return 'Matin'
  if (value === 'APRES_MIDI') return 'Après-midi'
  return null
}

function durationLabel(item) {
  return `${formatDays(item.duration)} ${item.durationUnit}`
}

function normalizeLeave(request, today) {
  const usesHours = request.durationHours !== null && request.durationHours !== undefined
  const item = {
    key: `leave-${request.id}`,
    id: request.id,
    source: 'leave',
    category: 'Indisponibilité',
    type: 'Indisponibilité',
    startDate: request.startDate,
    endDate: request.endDate,
    startPeriod: usesHours ? null : request.startPeriod,
    endPeriod: usesHours ? null : request.endPeriod,
    duration: Number(usesHours ? request.durationHours : request.deductedDays) || 0,
    durationUnit: usesHours ? 'h' : 'j',
    comment: request.comment || '',
    backendStatus: request.status,
    createdAt: request.createdAt,
  }
  return { ...item, temporalStatus: temporalStatus(item, today) }
}

function normalizeAbsence(declaration, today) {
  const usesHours = declaration.durationHours !== null && declaration.durationHours !== undefined
  const item = {
    key: `absence-${declaration.id}`,
    id: declaration.id,
    source: 'absence',
    category: 'Indisponibilité',
    type: 'Indisponibilité',
    startDate: declaration.startDate,
    endDate: declaration.endDate,
    startPeriod: declaration.startPeriod,
    endPeriod: declaration.endPeriod,
    duration: Number(usesHours ? declaration.durationHours : declaration.durationDays) || 0,
    durationUnit: usesHours ? 'h' : 'j',
    comment: declaration.comment || '',
    backendStatus: declaration.status,
    createdAt: declaration.createdAt,
  }
  return { ...item, temporalStatus: temporalStatus(item, today) }
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true
  if (filter === 'completed') {
    return item.temporalStatus === 'completed' || item.temporalStatus === 'cancelled'
  }
  return item.temporalStatus === filter
}

function matchesSearch(item, query) {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  const status = statusMeta(item.temporalStatus).label
  const text = [
    item.category,
    item.type,
    item.comment,
    item.startDate,
    item.endDate,
    formatRangeNumericFR(item.startDate, item.endDate),
    durationLabel(item),
    status,
  ]
    .map(normalizeSearchValue)
    .join(' ')

  return normalizedQuery.split(/\s+/).every((token) => text.includes(token))
}

function DetailDrawer({ item, busy, onClose, onEdit, onCancel }) {
  if (!item) return null
  const status = statusMeta(item.temporalStatus)
  const canManage = item.temporalStatus === 'upcoming'
  const startPeriod = periodLabel(item.startPeriod)
  const endPeriod = periodLabel(item.endPeriod)

  return (
    <div className="director-unavailability-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="director-unavailability-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="director-unavailability-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="director-unavailability-drawer__header">
          <div>
            <span>{item.category}</span>
            <h2 id="director-unavailability-detail-title">{item.type}</h2>
          </div>
          <button type="button" className="director-unavailability-drawer__close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        <div className="director-unavailability-drawer__status-row">
          <span className={`director-unavailability-status ${status.className}`}>{status.label}</span>
          {canManage && <span className="director-unavailability-drawer__hint">Modifiable avant son début</span>}
        </div>

        <div className="director-unavailability-detail-grid">
          <div>
            <small>Début</small>
            <strong>{formatDateFR(item.startDate)}</strong>
            {startPeriod && <span>{startPeriod}</span>}
          </div>
          <div>
            <small>Fin</small>
            <strong>{formatDateFR(item.endDate)}</strong>
            {endPeriod && <span>{endPeriod}</span>}
          </div>
          <div>
            <small>Durée</small>
            <strong>{durationLabel(item)}</strong>
          </div>
          <div>
            <small>Nature</small>
            <strong>{item.category}</strong>
          </div>
        </div>

        <div className="director-unavailability-detail-comment">
          <small>Motif</small>
          <p>{item.comment || 'Aucun motif renseigné.'}</p>
        </div>

        {canManage ? (
          <div className="director-unavailability-drawer__actions">
            <button type="button" className="director-unavailability-action director-unavailability-action--edit" onClick={() => onEdit(item)} disabled={busy}>
              <Icon name="calendar" size={17} />
              Modifier
            </button>
            <button type="button" className="director-unavailability-action director-unavailability-action--cancel" onClick={() => onCancel(item)} disabled={busy}>
              <Icon name="trash" size={17} />
              Annuler
            </button>
          </div>
        ) : (
          <div className="director-unavailability-drawer__locked">
            <Icon name="info" size={17} />
            <span>
              {item.temporalStatus === 'cancelled'
                ? 'Cette indisponibilité a été annulée et reste visible dans votre historique.'
                : 'Une indisponibilité en cours ou terminée reste consultable mais ne peut plus être modifiée.'}
            </span>
          </div>
        )}
      </aside>
    </div>
  )
}

export function DirectorUnavailabilityPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [state, setState] = useState({ loading: true, leave: [], absences: [], error: false })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    const [leaveResult, absenceResult] = await Promise.allSettled([
      getDirectorLeaveRequests(),
      getDirectorAbsences(),
    ])

    const totalFailure = leaveResult.status === 'rejected' && absenceResult.status === 'rejected'
    setState({
      loading: false,
      leave: leaveResult.status === 'fulfilled' ? leaveResult.value : [],
      absences: absenceResult.status === 'fulfilled' ? absenceResult.value : [],
      error: totalFailure,
    })
  }, [])

  useEffect(() => {
    load()
    const refresh = () => load()
    window.addEventListener('gmes:data-changed', refresh)
    return () => window.removeEventListener('gmes:data-changed', refresh)
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const today = todayISO()
  const items = useMemo(() => {
    const leave = state.leave.map((item) => normalizeLeave(item, today))
    const absences = state.absences.map((item) => normalizeAbsence(item, today))
    return [...leave, ...absences].sort((a, b) => {
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate)
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    })
  }, [state.absences, state.leave, today])

  const counts = useMemo(() => ({
    all: items.length,
    upcoming: items.filter((item) => item.temporalStatus === 'upcoming').length,
    current: items.filter((item) => item.temporalStatus === 'current').length,
    completed: items.filter((item) => ['completed', 'cancelled'].includes(item.temporalStatus)).length,
  }), [items])

  const query = searchParams.get('q') ?? ''
  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && matchesSearch(item, query)),
    [filter, items, query],
  )

  useEffect(() => setPage(1), [filter, query])
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleEdit = (item) => {
    navigate(`/app/director-availability/${item.source}/${item.id}`)
  }

  const handleCancel = async () => {
    if (!cancelTarget || busy) return
    setBusy(true)
    try {
      if (cancelTarget.source === 'leave') {
        await cancelDirectorLeaveRequest(cancelTarget.id)
      } else {
        await cancelDirectorAbsence(cancelTarget.id)
      }
      setCancelTarget(null)
      setSelected(null)
      setFeedback({ kind: 'success', message: 'Votre indisponibilité a été annulée.' })
      notifyAppDataChanged()
      await load()
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible d’annuler cette indisponibilité.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="director-unavailability-page">
      <div className="director-unavailability-toolbar">
        <div className="director-unavailability-filters" aria-label="Filtrer les indisponibilités">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`director-unavailability-filter${filter === item.key ? ' is-active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              <span>{item.label}</span>
              <strong>{counts[item.key]}</strong>
            </button>
          ))}
        </div>

        <button type="button" className="director-unavailability-new" onClick={() => navigate('/app/director-availability')}>
          <Icon name="plus" size={17} />
          Enregistrer une indisponibilité
        </button>
      </div>

      {feedback && (
        <div className={`director-unavailability-feedback is-${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

      {state.loading ? (
        <div className="director-unavailability-list" aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => <div className="director-unavailability-skeleton" key={index} />)}
        </div>
      ) : state.error ? (
        <div className="director-unavailability-empty is-error">
          <span><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger vos indisponibilités.</strong>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : pageItems.length === 0 ? (
        <div className="director-unavailability-empty">
          <span><Icon name="calendar" size={25} /></span>
          <strong>{items.length === 0 ? 'Aucune indisponibilité enregistrée.' : 'Aucune indisponibilité dans cette catégorie.'}</strong>
          {items.length === 0 && <button type="button" onClick={() => navigate('/app/director-availability')}>Enregistrer une indisponibilité</button>}
        </div>
      ) : (
        <div className="director-unavailability-list">
          {pageItems.map((item) => {
            const status = statusMeta(item.temporalStatus)
            return (
              <button type="button" className="director-unavailability-card" key={item.key} onClick={() => setSelected(item)}>
                <span className={`director-unavailability-card__icon is-${item.source}`}>
                  <Icon name={item.source === 'leave' ? 'sun' : 'calendar'} size={20} />
                </span>
                <span className="director-unavailability-card__content">
                  <span className="director-unavailability-card__topline">
                    <strong>{item.type}</strong>
                    <span className={`director-unavailability-status ${status.className}`}>{status.label}</span>
                  </span>
                  <span className="director-unavailability-card__meta">
                    <span>{formatRangeNumericFR(item.startDate, item.endDate)}</span>
                    <i>·</i>
                    <b>{durationLabel(item)}</b>
                    {item.comment && <><i>·</i><span className="director-unavailability-card__comment">{item.comment}</span></>}
                  </span>
                </span>
                <span className="director-unavailability-card__chevron"><Icon name="chevronRight" size={18} /></span>
              </button>
            )
          })}
        </div>
      )}

      {!state.loading && filteredItems.length > PAGE_SIZE && (
        <PaginationBar page={safePage} totalPages={totalPages} onChange={setPage} />
      )}

      <DetailDrawer
        item={selected}
        busy={busy}
        onClose={() => setSelected(null)}
        onEdit={handleEdit}
        onCancel={(item) => setCancelTarget(item)}
      />

      {cancelTarget && (
        <div className="director-unavailability-confirm-backdrop" role="presentation" onMouseDown={() => !busy && setCancelTarget(null)}>
          <div className="director-unavailability-confirm" role="dialog" aria-modal="true" aria-labelledby="director-cancel-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="director-unavailability-confirm__icon"><Icon name="alert" size={22} /></span>
            <h2 id="director-cancel-title">Annuler cette indisponibilité ?</h2>
            <p>
              L’indisponibilité du <strong>{formatDateFR(cancelTarget.startDate)}</strong> au <strong>{formatDateFR(cancelTarget.endDate)}</strong> sera annulée. La RH et les Responsables de service seront informés.
            </p>
            <div>
              <button type="button" className="is-secondary" onClick={() => setCancelTarget(null)} disabled={busy}>Conserver</button>
              <button type="button" className="is-danger" onClick={handleCancel} disabled={busy}>{busy ? 'Annulation…' : 'Annuler l’indisponibilité'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
