import { useCallback, useEffect, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { useClickOutside } from '@/hooks/useClickOutside'
import {
  getMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications'

function formatNotificationTime(value) {
  if (!value) {
    return ''
  }

  const createdAt = new Date(value)
  if (Number.isNaN(createdAt.getTime())) {
    return ''
  }

  const elapsedMs = Date.now() - createdAt.getTime()
  if (elapsedMs < 60_000) {
    return "À l'instant"
  }

  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60) {
    return `Il y a ${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `Il y a ${hours} h`
  }

  const days = Math.floor(hours / 24)
  if (days === 1) {
    return 'Hier'
  }
  if (days < 7) {
    return `Il y a ${days} jours`
  }

  return createdAt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: createdAt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const ref = useClickOutside(() => setOpen(false), open)

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await getUnreadNotificationCount()
      setUnreadCount(count)
    } catch {
      return
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    setError(false)

    try {
      const [notifications, count] = await Promise.all([
        getMyNotifications(),
        getUnreadNotificationCount(),
      ])
      setItems(notifications)
      setUnreadCount(count)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUnreadCount()

    const handleWindowFocus = () => refreshUnreadCount()
    const handleNotificationsUpdated = () => refreshUnreadCount()
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('gmes:notifications-updated', handleNotificationsUpdated)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('gmes:notifications-updated', handleNotificationsUpdated)
    }
  }, [refreshUnreadCount])

  useEffect(() => {
    if (open) {
      loadNotifications()
    }
  }, [open, loadNotifications])

  async function handleMarkRead(item) {
    if (item.readAt) {
      return
    }

    const previousItems = items
    const previousUnreadCount = unreadCount
    const readAt = new Date().toISOString()

    setItems((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, readAt } : notification,
      ),
    )
    setUnreadCount((current) => Math.max(0, current - 1))

    try {
      await markNotificationRead(item.id)
    } catch {
      setItems(previousItems)
      setUnreadCount(previousUnreadCount)
    }
  }

  async function handleMarkAllRead() {
    if (unreadCount === 0 || markingAll) {
      return
    }

    setMarkingAll(true)
    setError(false)

    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })))
      setUnreadCount(0)
    } catch {
      await loadNotifications()
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="icon-button icon-button--badge"
        onClick={() => setOpen((value) => !value)}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} non lues` : 'Notifications'
        }
        aria-expanded={open}
      >
        <Icon name="bell" />
        {unreadCount > 0 && <span className="header__badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="dropdown__panel dropdown__panel--notifications" role="menu">
          <div className="notifications__header">
            <h2 className="notifications__title">Notifications</h2>
            <button
              type="button"
              className="notifications__mark-all"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0 || markingAll}
            >
              {markingAll ? 'Traitement…' : 'Tout lire'}
            </button>
          </div>

          {loading && (
            <div className="notifications__state" role="status">
              Chargement des notifications…
            </div>
          )}

          {!loading && error && (
            <div className="notifications__state notifications__state--error" role="alert">
              <span>Impossible de charger les notifications.</span>
              <button type="button" onClick={loadNotifications}>
                Réessayer
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="notifications__state">Aucune notification pour le moment.</div>
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="notifications__list">
              {items.map((item) => {
                const unread = !item.readAt
                return (
                  <li
                    key={item.id}
                    className={`notification-item${unread ? ' notification-item--unread' : ''}`}
                  >
                    <button
                      type="button"
                      className="notification-item__button"
                      onClick={() => handleMarkRead(item)}
                      aria-label={
                        unread ? `Marquer comme lue : ${item.title}` : `${item.title}, déjà lue`
                      }
                    >
                      <div className="notification-item__body">
                        <p className="notification-item__title">{item.title}</p>
                        <p className="notification-item__text">{item.message}</p>
                        <span className="notification-item__time">
                          {formatNotificationTime(item.createdAt)}
                        </span>
                      </div>
                      {unread && <span className="notification-item__dot" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
