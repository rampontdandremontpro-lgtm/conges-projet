import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageContainer } from '@/components/ui/PageContainer'
import { Icon } from '@/components/ui/Icon'
import { RhWorkloadCard } from '@/components/rh/dashboard/RhWorkloadCard'
import { RhPresenceCard } from '@/components/rh/dashboard/RhPresenceCard'
import { RhPriorityCard } from '@/components/rh/dashboard/RhPriorityCard'
import { RhAbsentsCard } from '@/components/rh/dashboard/RhAbsentsCard'
import { RhAlertsCard } from '@/components/rh/dashboard/RhAlertsCard'
import { getRhDashboardData } from '@/services/rhDashboard'

import '@/styles/dashboard.css'
import '@/styles/rh-dashboard.css'

const INITIAL_STATE = {
  loading: true,
  error: false,
  data: null,
}

export function DashboardRh() {
  const navigate = useNavigate()
  const [state, setState] = useState(INITIAL_STATE)

  const load = useCallback(async () => {
    try {
      const data = await getRhDashboardData()
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [])

  useEffect(() => {
    load()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    window.addEventListener('focus', load)
    window.addEventListener('gmes:data-changed', load)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', load)
      window.removeEventListener('gmes:data-changed', load)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load])

  if (state.loading) {
    return (
      <PageContainer className="rh-dashboard-page">
        <div className="rh-dashboard-grid" aria-hidden="true">
          <div className="rh-dashboard-column">
            <section className="dash-card rh-dashboard-skeleton">
              <div className="skeleton-line skeleton-line--title" />
              <div className="skeleton-line skeleton-line--big" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
            </section>
            <section className="dash-card rh-dashboard-skeleton rh-dashboard-skeleton--large">
              <div className="skeleton-line skeleton-line--title" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
            </section>
          </div>
          <div className="rh-dashboard-column">
            <section className="dash-card rh-dashboard-skeleton">
              <div className="skeleton-line skeleton-line--title" />
              <div className="skeleton-line skeleton-line--big" />
              <div className="skeleton-line" />
            </section>
          </div>
        </div>
      </PageContainer>
    )
  }

  if (state.error || !state.data) {
    return (
      <PageContainer className="rh-dashboard-page">
        <section className="dash-card rh-dashboard-full-error">
          <span className="dash-empty__icon dash-empty__icon--muted">
            <Icon name="alert" size={24} />
          </span>
          <h2>Impossible de charger le tableau de bord RH</h2>
          <p>Vérifiez que le backend est démarré puis réessayez.</p>
          <button type="button" className="rh-dashboard-primary-link rh-dashboard-primary-link--fit" onClick={load}>
            Réessayer
          </button>
        </section>
      </PageContainer>
    )
  }

  const { data } = state

  return (
    <PageContainer className="rh-dashboard-page">
      {data.partialErrors.length > 0 && (
        <div className="rh-dashboard-partial-warning" role="status">
          <Icon name="alert" size={17} />
          <span>
            Certaines données n&apos;ont pas pu être actualisées : {data.partialErrors.join(', ')}.
          </span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      )}

      <div className="rh-dashboard-grid">
        <div className="rh-dashboard-column rh-dashboard-column--main">
          <RhWorkloadCard workload={data.workload} onNavigate={navigate} />
          <RhPriorityCard items={data.priorities} onNavigate={navigate} />
        </div>

        <div className="rh-dashboard-column rh-dashboard-column--side">
          <RhPresenceCard presence={data.presence} onNavigate={navigate} />
          <RhAbsentsCard presence={data.presence} onNavigate={navigate} />
          <RhAlertsCard alerts={data.alerts} />
        </div>
      </div>
    </PageContainer>
  )
}
