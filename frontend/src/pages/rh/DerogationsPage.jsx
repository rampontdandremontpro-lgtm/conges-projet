import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  decideRhDerogation,
  getRhDerogation,
  getRhDerogations,
} from '@/services/rhDerogations'
import { formatDateNumericFR, formatDays } from '@/utils/format'

import '@/styles/rh-derogations.css'

const PAGE_SIZE = 8

const STATUS_META = {
  EN_ATTENTE_RH: { label: 'En attente', tone: 'pending' },
  ACCORDEE: { label: 'Accordée', tone: 'granted' },
  REFUSEE: { label: 'Refusée', tone: 'refused' },
  UTILISEE: { label: 'Utilisée', tone: 'used' },
  EXPIREE: { label: 'Expirée', tone: 'expired' },
}

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'granted', label: 'Accordées' },
  { id: 'refused', label: 'Refusées' },
  { id: 'used', label: 'Utilisées' },
  { id: 'expired', label: 'Expirées' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function fullName(user) {
  if (!user) return '—'
  return `${user.prenom ?? ''} ${user.nom ?? ''}`.trim() || '—'
}

function initials(user) {
  return `${user?.prenom?.[0] ?? ''}${user?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status || '—', tone: 'neutral' }
}

function statusMatches(status, filter) {
  if (filter === 'all') return true
  if (filter === 'pending') return status === 'EN_ATTENTE_RH'
  if (filter === 'granted') return status === 'ACCORDEE'
  if (filter === 'refused') return status === 'REFUSEE'
  if (filter === 'used') return status === 'UTILISEE'
  if (filter === 'expired') return status === 'EXPIREE'
  return true
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
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatPeriod(item) {
  if (!item?.requestedStartDate) return '—'
  if (!item.requestedEndDate || item.requestedStartDate === item.requestedEndDate) {
    return formatDateNumericFR(item.requestedStartDate)
  }
  return `${formatDateNumericFR(item.requestedStartDate)} → ${formatDateNumericFR(item.requestedEndDate)}`
}

function formatDuration(item) {
  const duration = Number(item?.leaveRequest?.calendarDuration)
  return Number.isFinite(duration) && duration > 0 ? `${formatDays(duration)} j` : '—'
}

function truncate(value, limit = 76) {
  const text = String(value ?? '').trim()
  if (!text) return '—'
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function matchesSearch(item, query) {
  const needle = normalize(query)
  if (!needle) return true

  const haystack = [
    item.id,
    item.employee?.prenom,
    item.employee?.nom,
    item.employee?.email,
    item.leaveType?.name,
    item.requestedStartDate,
    item.requestedEndDate,
    item.reason,
    statusMeta(item.status).label,
    item.decisionComment,
    item.decidedByRh?.prenom,
    item.decidedByRh?.nom,
  ].map(normalize).join(' ')

  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function StatusBadge({ status }) {
  const meta = statusMeta(status)
  return <span className={`rh-derogation-status rh-derogation-status--${meta.tone}`}>{meta.label}</span>
}

function DerogationDetailDrawer({ itemId, onClose, onChanged }) {
  const [state, setState] = useState({ loading: true, error: false, item: null })
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState('')

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const item = await getRhDerogation(itemId)
      setState({ loading: false, error: false, item })
    } catch {
      setState({ loading: false, error: true, item: null })
    }
  }, [itemId])

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])

  const item = state.item
  const isPending = item?.status === 'EN_ATTENTE_RH'

  const decide = async (decision) => {
    if (!item || busy) return
    const cleanComment = comment.trim()

    if (decision === 'REFUSER' && !cleanComment) {
      setFeedback('Indiquez le motif du refus avant de poursuivre.')
      return
    }

    setBusy(decision)
    setFeedback('')
    try {
      const updated = await decideRhDerogation(item.id, decision, cleanComment)
      setState({ loading: false, error: false, item: updated })
      setComment('')
      onChanged(
        decision === 'ACCORDER'
          ? `Dérogation accordée à ${fullName(updated.employee)}.`
          : `Dérogation refusée pour ${fullName(updated.employee)}.`,
      )
    } catch (error) {
      setFeedback(errorMessage(error))
      await load()
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rh-derogation-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="rh-derogation-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Détail de la dérogation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rh-derogation-drawer__head">
          <div>
            <span>DÉROGATION N°{itemId}</span>
            <h2>{item ? fullName(item.employee) : 'Détail de la dérogation'}</h2>
            {item?.employee?.role && <p>{String(item.employee.role).replaceAll('_', ' ')}</p>}
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </div>

        {state.loading ? (
          <div className="rh-derogation-drawer__state">Chargement de la dérogation…</div>
        ) : state.error || !item ? (
          <div className="rh-derogation-drawer__state rh-derogation-drawer__state--error">
            <Icon name="alert" size={22} />
            <strong>Impossible de charger cette dérogation.</strong>
            <button type="button" onClick={load}>Réessayer</button>
          </div>
        ) : (
          <>
            <div className="rh-derogation-detail-status">
              <StatusBadge status={item.status} />
              <strong>{item.leaveType?.name ?? 'Type de congé'}</strong>
            </div>

            <div className="rh-derogation-detail-grid">
              <div>
                <small>Période demandée</small>
                <strong>{formatPeriod(item)}</strong>
              </div>
              <div>
                <small>Durée</small>
                <strong>{formatDuration(item)}</strong>
              </div>
              <div>
                <small>Demandée le</small>
                <strong>{formatDateTime(item.requestedAt)}</strong>
              </div>
              <div>
                <small>Valable jusqu’au</small>
                <strong>{formatDateTime(item.expiresAt)}</strong>
              </div>
              <div>
                <small>Demande de congé liée</small>
                <strong>{item.leaveRequestId ? `N°${item.leaveRequestId}` : '—'}</strong>
              </div>
              <div>
                <small>Statut du brouillon lié</small>
                <strong>{item.leaveRequest?.status ? String(item.leaveRequest.status).replaceAll('_', ' ') : '—'}</strong>
              </div>
            </div>

            <div className="rh-derogation-reason">
              <small>Motif de la demande</small>
              <p>{item.reason || 'Aucun motif renseigné.'}</p>
            </div>

            {item.status !== 'EN_ATTENTE_RH' && (
              <div className="rh-derogation-decision-summary">
                <div className="rh-derogation-decision-summary__title">
                  <Icon name={item.status === 'REFUSEE' ? 'alert' : 'check'} size={17} />
                  <strong>Décision RH</strong>
                </div>
                <div className="rh-derogation-decision-summary__grid">
                  <div>
                    <small>Décidée par</small>
                    <strong>{fullName(item.decidedByRh)}</strong>
                  </div>
                  <div>
                    <small>Décidée le</small>
                    <strong>{formatDateTime(item.decidedAt)}</strong>
                  </div>
                </div>
                {item.decisionComment && <p>{item.decisionComment}</p>}
                {item.status === 'UTILISEE' && item.usedAt && (
                  <p className="rh-derogation-used">Dérogation utilisée le {formatDateTime(item.usedAt)}.</p>
                )}
              </div>
            )}

            {isPending && (
              <div className="rh-derogation-decision-card">
                <div className="rh-derogation-decision-card__intro">
                  <span className="rh-derogation-decision-card__icon"><Icon name="shield" size={19} /></span>
                  <div>
                    <strong>Décision RH</strong>
                    <p>Vérifiez le motif et la période avant d’accorder ou de refuser cette dérogation.</p>
                  </div>
                </div>

                <label className="rh-derogation-comment">
                  <span>Commentaire de décision <em>obligatoire en cas de refus</em></span>
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={comment}
                    onChange={(event) => {
                      setComment(event.target.value)
                      setFeedback('')
                    }}
                    placeholder="Ajoutez une précision ou indiquez le motif du refus…"
                  />
                  <small>{comment.length}/2000</small>
                </label>

                {feedback && <div className="rh-derogation-decision-error"><Icon name="alert" size={15} /> {feedback}</div>}

                <div className="rh-derogation-detail-actions">
                  <button
                    type="button"
                    className="rh-derogation-button rh-derogation-button--danger"
                    disabled={Boolean(busy)}
                    onClick={() => decide('REFUSER')}
                  >
                    <Icon name="alert" size={16} />
                    {busy === 'REFUSER' ? 'Refus…' : 'Refuser'}
                  </button>
                  <button
                    type="button"
                    className="rh-derogation-button rh-derogation-button--primary"
                    disabled={Boolean(busy)}
                    onClick={() => decide('ACCORDER')}
                  >
                    <Icon name="check" size={16} />
                    {busy === 'ACCORDER' ? 'Validation…' : 'Accorder la dérogation'}
                  </button>
                </div>
              </div>
            )}

            {!isPending && (
              <div className="rh-derogation-detail-actions">
                <button type="button" className="rh-derogation-button rh-derogation-button--secondary" onClick={onClose}>Fermer</button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

export function RhDerogationsPage() {
  const [searchParams] = useSearchParams()
  const [state, setState] = useState({ loading: true, error: false, items: [] })
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const items = await getRhDerogations()
      setState({ loading: false, error: false, items })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])

  useEffect(() => {
    const refresh = () => load({ silent: true })
    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
    }
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const query = searchParams.get('q') ?? ''

  const counts = useMemo(() => ({
    all: state.items.length,
    pending: state.items.filter((item) => item.status === 'EN_ATTENTE_RH').length,
    granted: state.items.filter((item) => item.status === 'ACCORDEE').length,
    refused: state.items.filter((item) => item.status === 'REFUSEE').length,
    used: state.items.filter((item) => item.status === 'UTILISEE').length,
    expired: state.items.filter((item) => item.status === 'EXPIREE').length,
  }), [state.items])

  const filtered = useMemo(
    () => state.items.filter((item) => statusMatches(item.status, filter) && matchesSearch(item, query)),
    [filter, query, state.items],
  )

  useEffect(() => setPage(1), [query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const changed = async (message) => {
    setFeedback({ kind: 'success', message })
    await load({ silent: true })
    window.dispatchEvent(new CustomEvent('gmes:data-changed'))
  }

  return (
    <PageContainer className="rh-derogations-page">
      {feedback && (
        <div className={`rh-derogations-feedback rh-derogations-feedback--${feedback.kind}`} role="status">
          <Icon name="check" size={17} />
          <span>{feedback.message}</span>
          <button type="button" aria-label="Fermer" onClick={() => setFeedback(null)}>×</button>
        </div>
      )}

      <section className="rh-derogations-card">
        <div className="rh-derogations-toolbar">
          <div>
            <h2>Gestion des dérogations</h2>
            <p>Demandes exceptionnelles liées au délai de prévenance des congés.</p>
          </div>
        </div>

        <div className="rh-derogations-tabs" role="tablist" aria-label="Filtrer les dérogations">
          {FILTERS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`rh-derogations-tab${filter === tab.id ? ' is-active' : ''}`}
              onClick={() => { setFilter(tab.id); setPage(1) }}
            >
              {tab.label}<span>{counts[tab.id]}</span>
            </button>
          ))}
        </div>

        {state.loading ? (
          <div className="rh-derogations-loading">
            {[0, 1, 2, 3].map((key) => <span key={key} />)}
          </div>
        ) : state.error ? (
          <div className="rh-derogations-empty rh-derogations-empty--error">
            <Icon name="alert" size={28} />
            <strong>Impossible de charger les dérogations</strong>
            <p>Vérifiez la connexion au serveur puis réessayez.</p>
            <button type="button" onClick={() => load()}>Réessayer</button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="rh-derogations-empty">
            <Icon name="shield" size={28} />
            <strong>Aucune dérogation à afficher</strong>
            <p>{query ? 'Aucun résultat ne correspond à la recherche.' : 'Les demandes de dérogation apparaîtront ici.'}</p>
          </div>
        ) : (
          <div className="rh-derogations-table-wrap">
            <div className="rh-derogations-table">
              <div className="rh-derogations-row rh-derogations-row--head">
                <span>Collaborateur</span>
                <span>Type de congé</span>
                <span>Période</span>
                <span>Durée</span>
                <span>Motif</span>
                <span>Demandée le</span>
                <span>Statut</span>
                <span aria-hidden="true" />
              </div>

              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="rh-derogations-row rh-derogations-row--body"
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="rh-derogations-person">
                    <span className="rh-derogations-avatar">{initials(item.employee)}</span>
                    <span>
                      <strong>{fullName(item.employee)}</strong>
                      <small>{item.employee?.email ?? `Dérogation n°${item.id}`}</small>
                    </span>
                  </span>
                  <span className="rh-derogations-cell-strong">{item.leaveType?.name ?? '—'}</span>
                  <span>{formatPeriod(item)}</span>
                  <span className="rh-derogations-cell-strong">{formatDuration(item)}</span>
                  <span className="rh-derogations-reason-preview" title={item.reason ?? ''}>{truncate(item.reason)}</span>
                  <span>{formatDateTime(item.requestedAt)}</span>
                  <span><StatusBadge status={item.status} /></span>
                  <span className="rh-derogations-eye"><Icon name="eye" size={17} /></span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!state.loading && !state.error && (
          <div className="rh-derogations-footer">
            <span>{filtered.length} dérogation{filtered.length > 1 ? 's' : ''}</span>
            <PaginationBar
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={filtered.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </section>

      {selectedId && (
        <DerogationDetailDrawer
          itemId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={changed}
        />
      )}
    </PageContainer>
  )
}
