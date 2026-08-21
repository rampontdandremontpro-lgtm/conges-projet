import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { getDashboardReminders } from '@/services/notifications'

import '@/styles/shared/dashboard-reminder-popup.css'

const ROUTES = {
  manager: (id) => `/app/requests/${id}`,
  rh: (id) => `/app/rh-all-requests/${id}`,
  director: (id) => `/app/director-all-requests/${id}`,
}

function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

function reminderLabel(days) {
  if (days === 1) return 'Départ demain'
  return `Départ dans ${days} jours`
}

export function DashboardReminderPopup({ role, onNavigate }) {
  const [items, setItems] = useState([])
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getDashboardReminders()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = () => load()
    window.addEventListener('gmes:data-changed', refresh)

    return () => {
      window.removeEventListener('gmes:data-changed', refresh)
    }
  }, [load])

  const urgentCount = useMemo(
    () => items.filter((item) => item.urgent).length,
    [items],
  )

  if (loading || dismissed || items.length === 0) return null

  const routeBuilder = ROUTES[role]

  const openRequest = (id) => {
    setDismissed(true)
    const route = routeBuilder?.(id)
    if (route) onNavigate(route)
  }

  return (
    <div className="dashboard-reminder-backdrop" role="presentation" onMouseDown={() => setDismissed(true)}>
      <section
        className="dashboard-reminder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-reminder-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dashboard-reminder-header">
          <span className={`dashboard-reminder-icon ${urgentCount > 0 ? 'is-urgent' : ''}`}>
            <Icon name={urgentCount > 0 ? 'alert' : 'bell'} size={22} />
          </span>
          <div>
            <h2 id="dashboard-reminder-title">
              {urgentCount > 0 ? 'Rappel urgent — demandes à traiter' : 'Rappel — demandes à traiter'}
            </h2>
            <p>
              {items.length} demande{items.length > 1 ? 's' : ''} approche{items.length > 1 ? 'nt' : ''} de la date de départ.
            </p>
          </div>
          <button
            type="button"
            className="dashboard-reminder-close"
            aria-label="Fermer le rappel"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </header>

        <div className="dashboard-reminder-list">
          {items.map((item) => (
            <article className={`dashboard-reminder-item ${item.urgent ? 'is-urgent' : ''}`} key={item.id}>
              <div className="dashboard-reminder-item__top">
                <span className={`dashboard-reminder-badge ${item.urgent ? 'is-urgent' : ''}`}>
                  J-{item.daysBeforeStart}
                </span>
                {item.finalization && (
                  <span className="dashboard-reminder-stage">Validation RH finale</span>
                )}
              </div>

              <div className="dashboard-reminder-item__body">
                <div>
                  <strong>{`${item.employee?.prenom ?? ''} ${item.employee?.nom ?? ''}`.trim() || 'Collaborateur'}</strong>
                  <span>{item.leaveType?.name ?? 'Demande de congé'} · {item.service?.name ?? 'Service'}</span>
                  <small>
                    Du {formatDate(item.startDate)} au {formatDate(item.endDate)} · {reminderLabel(item.daysBeforeStart)}
                  </small>
                </div>

                <button type="button" onClick={() => openRequest(item.id)}>
                  Traiter la demande
                  <Icon name="arrowRight" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer className="dashboard-reminder-footer">
          <span>Ce rappel réapparaîtra lors d&apos;une prochaine ouverture du tableau de bord tant que la demande reste à traiter.</span>
          <button type="button" onClick={() => setDismissed(true)}>Plus tard</button>
        </footer>
      </section>
    </div>
  )
}
