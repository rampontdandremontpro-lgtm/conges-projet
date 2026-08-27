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

function reminderLabel(item) {
  if (item.kind === 'derogation') {
    return 'À traiter avant le début du congé'
  }
  if (item.validationLate) {
    return `Validation en retard depuis ${item.pendingDays} jour${item.pendingDays > 1 ? 's' : ''}`
  }
  if (item.daysBeforeStart === 1) return 'Départ demain'
  return `Départ dans ${item.daysBeforeStart} jours`
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

  const openRequest = (item) => {
    setDismissed(true)
    const route = item.kind === 'derogation'
      ? `/app/rh-derogations?filter=pending&derogation=${item.id}`
      : routeBuilder?.(item.id)
    if (route) onNavigate(route)
  }

  return (
    <div className="dashboard-reminder-backdrop" role="presentation" onMouseDown={() => setDismissed(true)}>
      <section
        className={`dashboard-reminder-modal ${urgentCount > 0 ? 'is-urgent' : ''}`}
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
              {urgentCount > 0 ? 'RAPPEL URGENT' : 'Rappel'}
            </h2>
            <p>
              {items.length} demande{items.length > 1 ? 's' : ''} nécessite{items.length > 1 ? 'nt' : ''} votre attention.
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
            <article className={`dashboard-reminder-item ${item.urgent ? 'is-urgent' : ''}`} key={`${item.kind}-${item.id}`}>
              <div className="dashboard-reminder-item__top">
                <span className={`dashboard-reminder-badge ${item.urgent ? 'is-urgent' : ''}`}>
                  J-{item.daysBeforeStart}
                </span>
                {item.stage === 'leave-finalization' && (
                  <span className="dashboard-reminder-stage">Validation RH finale</span>
                )}
                {item.stage === 'derogation-rh' && (
                  <span className="dashboard-reminder-stage">Validation RH</span>
                )}
                {item.stage === 'derogation-director' && (
                  <span className="dashboard-reminder-stage">Validation Directeur finale</span>
                )}
                {item.stage === 'leave-validation' && item.validationLate && (
                  <span className="dashboard-reminder-stage is-late">Validation en retard</span>
                )}
              </div>

              <div className="dashboard-reminder-item__body">
                <div>
                  <strong>{`${item.employee?.nom ?? ''} ${item.employee?.prenom ?? ''}`.trim() || 'Collaborateur'}</strong>
                  <span>{item.leaveType?.name ?? (item.kind === 'derogation' ? 'Dérogation' : 'Demande de congé')} · {item.service?.name ?? 'Service'}</span>
                  <small>
                    Du {formatDate(item.startDate)} au {formatDate(item.endDate)} · {reminderLabel(item)}
                  </small>
                </div>

                <button type="button" onClick={() => openRequest(item)}>
                  {item.kind === 'derogation' ? 'Traiter la dérogation' : 'Traiter la demande'}
                  <Icon name="arrowRight" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer className="dashboard-reminder-footer">
          <span>Les demandes encore à traiter réapparaîtront à la prochaine ouverture du tableau de bord.</span>
          <button type="button" onClick={() => setDismissed(true)}>Plus tard</button>
        </footer>
      </section>
    </div>
  )
}
