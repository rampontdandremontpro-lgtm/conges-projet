import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications'

import '@/styles/collab/notifications/index.css'

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'unread', label: 'Non lues' },
  { key: 'read', label: 'Lues' },
]

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
}

function formatNotificationDate(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatNotificationTime(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sectionKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'older'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const notificationDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const elapsedDays = Math.round((today.getTime() - notificationDay.getTime()) / 86_400_000)

  if (elapsedDays === 0) return 'today'
  if (elapsedDays === 1) return 'yesterday'
  return 'older'
}

function notificationVisual(type = '') {
  const normalized = type.toUpperCase()

  if (normalized.includes('REFUSE') || normalized.includes('REJETE') || normalized.includes('EXPIRED')) {
    return { tone: 'danger', icon: 'alert' }
  }

  if (
    normalized.includes('VALIDEE') ||
    normalized.includes('APPROVED') ||
    normalized.includes('ACCEPTE') ||
    normalized.includes('ENREGISTRE')
  ) {
    return { tone: 'success', icon: 'check' }
  }

  if (normalized.includes('DOCUMENT') || normalized.includes('JUSTIFICATIF')) {
    return { tone: 'document', icon: 'file' }
  }

  if (normalized.includes('BALANCE') || normalized.includes('SOLDE') || normalized.includes('CARRYOVER')) {
    return { tone: 'balance', icon: 'wallet' }
  }

  if (normalized.includes('DEROGATION')) {
    return { tone: 'warning', icon: 'alert' }
  }

  if (normalized.includes('REMINDER') || normalized.includes('RAPPEL')) {
    return { tone: 'warning', icon: 'clock' }
  }

  if (normalized.includes('ABSENCE') || normalized.includes('CONGE_DIRECTEUR')) {
    return { tone: 'calendar', icon: 'calendar' }
  }

  return { tone: 'info', icon: 'bell' }
}

function LoadingState() {
  return (
    <div className="notifications-page__list" aria-label="Chargement des notifications">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="notifications-page-card notifications-page-card--skeleton">
          <span className="notifications-page-skeleton notifications-page-skeleton--icon" />
          <div className="notifications-page-card__content">
            <span className="notifications-page-skeleton notifications-page-skeleton--title" />
            <span className="notifications-page-skeleton notifications-page-skeleton--text" />
            <span className="notifications-page-skeleton notifications-page-skeleton--meta" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ filtered }) {
  return (
    <div className="notifications-page__empty">
      <span className="notifications-page__empty-icon" aria-hidden="true">
        <Icon name="bell" size={28} />
      </span>
      <strong>{filtered ? 'Aucune notification dans cette catégorie.' : 'Aucune notification pour le moment.'}</strong>
      <p>
        {filtered
          ? 'Modifiez le filtre ou la recherche pour afficher d’autres notifications.'
          : 'Vos alertes et informations importantes apparaîtront ici.'}
      </p>
    </div>
  )
}

function NotificationCard({ item, onRead, onOpenDraft, busy }) {
  const unread = !item.readAt
  const visual = notificationVisual(item.type)

  return (
    <article className={`notifications-page-card${unread ? ' is-unread' : ''}`}>
      <span className={`notifications-page-card__icon notifications-page-card__icon--${visual.tone}`} aria-hidden="true">
        <Icon name={visual.icon} size={21} />
      </span>

      <div className="notifications-page-card__content">
        <div className="notifications-page-card__heading">
          <h3>{item.title}</h3>
          {unread && <span className="notifications-page-card__badge">Non lue</span>}
        </div>

        <p className="notifications-page-card__message">{item.message}</p>

        <div className="notifications-page-card__meta">
          <span>{formatNotificationDate(item.createdAt)}</span>
          <span>{formatNotificationTime(item.createdAt)}</span>
        </div>
      </div>

      <div className="notifications-page-card__action">
        {item.type === 'LEAVE_REQUEST_PREPARED_BY_RH' && item.leaveRequestId ? (
          <button type="button" disabled={busy} onClick={() => onOpenDraft(item)}>
            <Icon name="chevronRight" size={15} />
            Ouvrir le brouillon
          </button>
        ) : unread ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRead(item)}
          >
            <Icon name="check" size={15} />
            {busy ? 'Traitement…' : 'Marquer comme lue'}
          </button>
        ) : (
          <span className="notifications-page-card__read">
            <Icon name="check" size={14} />
            Lue
          </span>
        )}
      </div>
    </article>
  )
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)

    try {
      const notifications = await getMyNotifications()
      setItems(notifications)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const unreadCount = useMemo(
    () => items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0),
    [items],
  )

  const readCount = items.length - unreadCount
  const query = normalizeText(searchParams.get('q') ?? '').trim()

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'unread' && item.readAt) return false
      if (filter === 'read' && !item.readAt) return false

      if (!query) return true

      const haystack = normalizeText([
        item.title,
        item.message,
        item.type,
        formatNotificationDate(item.createdAt),
      ].join(' '))

      return query.split(/\s+/).every((part) => haystack.includes(part))
    })
  }, [filter, items, query])

  const groups = useMemo(() => {
    const result = {
      today: [],
      yesterday: [],
      older: [],
    }

    filteredItems.forEach((item) => {
      result[sectionKey(item.createdAt)].push(item)
    })

    return result
  }, [filteredItems])

  const notifyHeader = () => {
    window.dispatchEvent(new CustomEvent('gmes:notifications-updated'))
  }

  const handleRead = async (item) => {
    if (item.readAt || busyId) return

    setBusyId(item.id)
    try {
      const updated = await markNotificationRead(item.id)
      setItems((current) =>
        current.map((notification) =>
          notification.id === item.id
            ? { ...notification, ...updated, readAt: updated.readAt ?? new Date().toISOString() }
            : notification,
        ),
      )
      notifyHeader()
    } catch {
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleOpenDraft = async (item) => {
    if (!item.leaveRequestId || busyId) return
    setBusyId(item.id)
    try {
      if (!item.readAt) await markNotificationRead(item.id)
      notifyHeader()
      navigate(`/app/new-request/${item.leaveRequestId}`)
    } catch {
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleReadAll = async () => {
    if (unreadCount === 0 || markingAll) return

    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt ?? readAt,
        })),
      )
      notifyHeader()
    } catch {
      await load()
    } finally {
      setMarkingAll(false)
    }
  }

  const counts = {
    all: items.length,
    unread: unreadCount,
    read: readCount,
  }

  const hasActiveFilter = filter !== 'all' || Boolean(query)

  return (
    <section className="notifications-page">
      <div className="notifications-page__toolbar">
        <div className="notifications-page__filters" role="tablist" aria-label="Filtrer les notifications">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={`notifications-page__filter${filter === item.key ? ' is-active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span>{counts[item.key]}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="notifications-page__read-all"
          disabled={unreadCount === 0 || markingAll || loading}
          onClick={handleReadAll}
        >
          <Icon name="check" size={16} />
          {markingAll ? 'Traitement…' : 'Tout marquer comme lu'}
        </button>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <div className="notifications-page__error" role="alert">
          <span className="notifications-page__empty-icon" aria-hidden="true">
            <Icon name="alert" size={28} />
          </span>
          <strong>Impossible de charger les notifications</strong>
          <p>Les informations sont momentanément indisponibles.</p>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState filtered={hasActiveFilter} />
      ) : (
        <div className="notifications-page__groups">
          {groups.today.length > 0 && (
            <section className="notifications-page__group">
              <h2>Aujourd’hui</h2>
              <div className="notifications-page__list">
                {groups.today.map((item) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    onRead={handleRead}
                    busy={busyId === item.id}
                  />
                ))}
              </div>
            </section>
          )}

          {groups.yesterday.length > 0 && (
            <section className="notifications-page__group">
              <h2>Hier</h2>
              <div className="notifications-page__list">
                {groups.yesterday.map((item) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    onRead={handleRead}
                    busy={busyId === item.id}
                  />
                ))}
              </div>
            </section>
          )}

          {groups.older.length > 0 && (
            <section className="notifications-page__group">
              <h2>Plus anciennes</h2>
              <div className="notifications-page__list">
                {groups.older.map((item) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    onRead={handleRead}
                    busy={busyId === item.id}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  )
}
