import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { useClickOutside } from '@/hooks/useClickOutside'

const DEMO_NOTIFICATIONS = [
  { id: 1, text: 'Votre demande de congé a été validée.', time: 'Il y a 5 min', read: false },
  { id: 2, text: 'Un justificatif est en attente de vérification.', time: 'Il y a 2 h', read: false },
  { id: 3, text: 'Votre solde de congés a été mis à jour.', time: 'Hier', read: true },
  { id: 4, text: 'Une réponse a été apportée à votre dérogation.', time: 'Il y a 3 jours', read: true },
]

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(DEMO_NOTIFICATIONS)
  const ref = useClickOutside(() => setOpen(false), open)

  const unreadCount = items.filter((item) => !item.read).length

  function markAllRead() {
    setItems((current) => current.map((item) => ({ ...item, read: true })))
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
              onClick={markAllRead}
              disabled={unreadCount === 0}
            >
              Tout lire
            </button>
          </div>
          <ul className="notifications__list">
            {items.map((item) => (
              <li
                key={item.id}
                className={`notification-item${item.read ? '' : ' notification-item--unread'}`}
              >
                <div className="notification-item__body">
                  <p className="notification-item__text">{item.text}</p>
                  <span className="notification-item__time">{item.time}</span>
                </div>
                {!item.read && <span className="notification-item__dot" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
