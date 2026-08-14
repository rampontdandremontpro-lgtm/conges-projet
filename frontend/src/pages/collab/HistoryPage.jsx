import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/config/navigation'

import { Icon } from '@/components/ui/Icon'
import { getMyBalanceHistory } from '@/services/balances'
import { formatDays } from '@/utils/format'

import '@/styles/history.css'

const HIDDEN_MOVEMENT_TYPES = new Set(['RESERVATION', 'LIBERATION_RESERVATION'])

const FILTERS = [
  { key: 'all', label: 'Tous' },
  { key: 'credits', label: 'Crédits' },
  { key: 'debits', label: 'Débits' },
  { key: 'corrections', label: 'Corrections' },
]

const CREDIT_TYPES = new Set(['ACQUISITION', 'CORRECTION_POSITIVE', 'RECREDIT'])
const DEBIT_TYPES = new Set(['DEDUCTION', 'CORRECTION_NEGATIVE', 'REMISE_A_ZERO'])
const CORRECTION_TYPES = new Set(['CORRECTION_POSITIVE', 'CORRECTION_NEGATIVE'])

function movementDirection(type) {
  if (CREDIT_TYPES.has(type)) return 1
  if (DEBIT_TYPES.has(type)) return -1
  return 0
}

function movementVisual(type) {
  switch (type) {
    case 'ACQUISITION':
      return { tone: 'credit', icon: 'plus', fallback: 'Acquisition de congés' }
    case 'DEDUCTION':
      return { tone: 'debit', icon: 'calendar', fallback: 'Congés payés validés' }
    case 'RECREDIT':
      return { tone: 'credit', icon: 'refresh', fallback: 'Recrédit de congés' }
    case 'CORRECTION_POSITIVE':
      return { tone: 'correction-positive', icon: 'plus', fallback: 'Correction positive du solde' }
    case 'CORRECTION_NEGATIVE':
      return { tone: 'correction-negative', icon: 'refresh', fallback: 'Correction négative du solde' }
    case 'REMISE_A_ZERO':
      return { tone: 'neutral', icon: 'refresh', fallback: 'Clôture de la période' }
    default:
      return { tone: 'neutral', icon: 'wallet', fallback: 'Mouvement de solde' }
  }
}

function cleanReason(reason, fallback) {
  const value = String(reason ?? '').trim()
  if (!value) return fallback

  if (value.includes('|')) {
    const parts = value.split('|').map((part) => part.trim()).filter(Boolean)
    return parts.at(-1) || fallback
  }

  return value.replace(/\s+/g, ' ')
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function monthKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'

  const label = date.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })

  return label.charAt(0).toUpperCase() + label.slice(1)
}

function counterLabel(counterType) {
  if (counterType === 'N-1') return 'Congés à utiliser'
  if (counterType === 'N') return 'En cours d’acquisition'
  if (counterType === 'N+1') return 'Prévisionnel'
  return 'Solde de congés'
}

function LoadingState() {
  return (
    <div className="history-page__list" aria-label="Chargement de l’historique">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="history-row history-row--skeleton">
          <span className="history-skeleton history-skeleton--icon" />
          <div className="history-row__main">
            <span className="history-skeleton history-skeleton--title" />
            <span className="history-skeleton history-skeleton--meta" />
          </div>
          <span className="history-skeleton history-skeleton--amount" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ filtered }) {
  return (
    <div className="history-page__empty">
      <span className="history-page__empty-icon" aria-hidden="true">
        <Icon name="clock" size={28} />
      </span>
      <strong>{filtered ? 'Aucun mouvement dans cette catégorie.' : 'Aucun mouvement de solde pour le moment.'}</strong>
      <p>
        {filtered
          ? 'Choisissez un autre filtre pour consulter le reste de votre historique.'
          : 'Les acquisitions, validations, recrédits et corrections apparaîtront ici automatiquement.'}
      </p>
    </div>
  )
}

function HistoryRow({ movement, onOpenRequest }) {
  const visual = movementVisual(movement.movementType)
  const direction = movementDirection(movement.movementType)
  const amount = Number(movement.days ?? 0)
  const balanceAfter = Number(movement.balanceAfter ?? 0)
  const referencePeriod = movement.leaveBalance?.referencePeriod
  const counter = movement.leaveBalance?.counterType
  const requestId = Number(movement.leaveRequestId ?? movement.leaveRequest?.id)
  const canOpenRequest = Number.isInteger(requestId) && requestId > 0
  const title = cleanReason(movement.reason, visual.fallback)

  return (
    <article
      className={`history-row${canOpenRequest ? ' is-clickable' : ''}`}
      onClick={canOpenRequest ? () => onOpenRequest(requestId) : undefined}
      onKeyDown={canOpenRequest ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenRequest(requestId)
        }
      } : undefined}
      role={canOpenRequest ? 'button' : undefined}
      tabIndex={canOpenRequest ? 0 : undefined}
    >
      <span className={`history-row__icon history-row__icon--${visual.tone}`} aria-hidden="true">
        <Icon name={visual.icon} size={19} />
      </span>

      <div className="history-row__main">
        <div className="history-row__heading">
          <h3>{title}</h3>
          <span className="history-row__counter">{counterLabel(counter)}</span>
        </div>
        <div className="history-row__meta">
          <span>{formatDate(movement.createdAt)} à {formatTime(movement.createdAt)}</span>
          {referencePeriod && <span>Période {referencePeriod}</span>}
          {canOpenRequest && <span>Demande n°{requestId}</span>}
        </div>
      </div>

      <div className="history-row__values">
        <strong className={`history-row__amount history-row__amount--${direction > 0 ? 'credit' : direction < 0 ? 'debit' : 'neutral'}`}>
          {direction > 0 ? '+' : direction < 0 ? '−' : ''}{formatDays(amount)} j
        </strong>
        <span>Solde après : <b>{formatDays(balanceAfter)} j</b></span>
      </div>

      {canOpenRequest && (
        <span className="history-row__arrow" aria-hidden="true">
          <Icon name="chevronRight" size={18} />
        </span>
      )}
    </article>
  )
}

export function HistoryPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const backNavigation = user?.role === ROLES.RESPONSABLE_SERVICE
    ? { to: '/app/my-balance', label: 'Retour à Mon solde' }
    : user?.role === ROLES.COLLABORATEUR
      ? { to: '/app/dashboard', label: 'Retour au Tableau de bord' }
      : null
  const [filter, setFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, movements: [] })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))

    try {
      const movements = await getMyBalanceHistory()
      setState({ loading: false, error: false, movements: Array.isArray(movements) ? movements : [] })
    } catch {
      setState({ loading: false, error: true, movements: [] })
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

  const visibleMovements = useMemo(
    () => state.movements.filter((movement) => !HIDDEN_MOVEMENT_TYPES.has(movement.movementType)),
    [state.movements],
  )

  const counts = useMemo(() => ({
    all: visibleMovements.length,
    credits: visibleMovements.filter((movement) => CREDIT_TYPES.has(movement.movementType)).length,
    debits: visibleMovements.filter((movement) => DEBIT_TYPES.has(movement.movementType)).length,
    corrections: visibleMovements.filter((movement) => CORRECTION_TYPES.has(movement.movementType)).length,
  }), [visibleMovements])

  const filteredMovements = useMemo(() => {
    if (filter === 'credits') return visibleMovements.filter((movement) => CREDIT_TYPES.has(movement.movementType))
    if (filter === 'debits') return visibleMovements.filter((movement) => DEBIT_TYPES.has(movement.movementType))
    if (filter === 'corrections') return visibleMovements.filter((movement) => CORRECTION_TYPES.has(movement.movementType))
    return visibleMovements
  }, [filter, visibleMovements])

  const groups = useMemo(() => {
    const ordered = []
    const byMonth = new Map()

    filteredMovements.forEach((movement) => {
      const key = monthKey(movement.createdAt)
      if (!byMonth.has(key)) {
        const group = { key, label: monthLabel(movement.createdAt), movements: [] }
        byMonth.set(key, group)
        ordered.push(group)
      }
      byMonth.get(key).movements.push(movement)
    })

    return ordered
  }, [filteredMovements])

  return (
    <div className="history-page">
      {backNavigation && (
        <div className="history-page__back-row">
          <button
            type="button"
            className="history-page__back"
            onClick={() => navigate(backNavigation.to)}
          >
            <Icon name="chevronLeft" size={17} />
            {backNavigation.label}
          </button>
        </div>
      )}

      <div className="history-page__toolbar">
        <div className="history-page__filters" role="tablist" aria-label="Filtrer l’historique">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={filter === item.key ? 'is-active' : ''}
              onClick={() => setFilter(item.key)}
            >
              <span>{item.label}</span>
              <small>{counts[item.key]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="history-page__notice">
        <span className="history-page__notice-icon" aria-hidden="true"><Icon name="info" size={17} /></span>
        <p>
          Cet historique affiche uniquement les mouvements qui modifient réellement vos compteurs. Une demande en attente réserve des jours, mais n’apparaît pas comme un débit avant sa validation.
        </p>
      </div>

      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <div className="history-page__error">
          <span className="history-page__error-icon" aria-hidden="true"><Icon name="alert" size={22} /></span>
          <div>
            <strong>Impossible de charger votre historique.</strong>
            <p>Les mouvements de solde sont momentanément indisponibles.</p>
          </div>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : filteredMovements.length === 0 ? (
        <EmptyState filtered={filter !== 'all'} />
      ) : (
        <div className="history-page__groups">
          {groups.map((group) => (
            <section key={group.key} className="history-group">
              <h2>{group.label}</h2>
              <div className="history-page__list">
                {group.movements.map((movement) => (
                  <HistoryRow
                    key={movement.id}
                    movement={movement}
                    onOpenRequest={(requestId) => navigate(`/app/my-requests/leave/${requestId}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
