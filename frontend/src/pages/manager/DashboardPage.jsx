import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DashboardReminderPopup } from '@/components/shared/DashboardReminderPopup'
import { PageContainer } from '@/components/ui/PageContainer'
import { ManagerOverviewCard } from '@/components/manager/dashboard/ManagerOverviewCard'
import { ManagerPresenceCard } from '@/components/manager/dashboard/ManagerPresenceCard'
import { ManagerRecentRequestsCard } from '@/components/manager/dashboard/ManagerRecentRequestsCard'
import { ManagerTeamCard } from '@/components/manager/dashboard/ManagerTeamCard'
import {
  getManagerPendingRequests,
  getManagerServicePresence,
} from '@/services/manager/managerDashboard'

import '@/styles/manager/dashboard/index.css'

export function DashboardResponsable() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState({ loading: true, error: false, data: [] })
  const [presence, setPresence] = useState({ loading: true, error: false, data: null })

  const loadRequests = useCallback(async () => {
    try {
      const data = await getManagerPendingRequests()
      setRequests({ loading: false, error: false, data: Array.isArray(data) ? data : [] })
    } catch {
      setRequests({ loading: false, error: true, data: [] })
    }
  }, [])

  const loadPresence = useCallback(async () => {
    try {
      const data = await getManagerServicePresence()
      setPresence({ loading: false, error: false, data })
    } catch {
      setPresence({ loading: false, error: true, data: null })
    }
  }, [])

  const reload = useCallback(() => {
    loadRequests()
    loadPresence()
  }, [loadPresence, loadRequests])

  useEffect(() => {
    reload()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }

    window.addEventListener('focus', reload)
    window.addEventListener('gmes:data-changed', reload)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener('gmes:data-changed', reload)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [reload])

  return (
    <PageContainer className="manager-dashboard-page">
      <DashboardReminderPopup role="manager" onNavigate={navigate} />
      <div className="manager-dashboard-grid">
        <div className="manager-dashboard-column manager-dashboard-column--main">
          <ManagerOverviewCard
            requests={requests.data}
            loading={requests.loading}
            error={requests.error}
            onRetry={loadRequests}
            onViewRequests={() => navigate('/app/requests')}
          />
          <ManagerRecentRequestsCard
            requests={requests.data}
            loading={requests.loading}
            error={requests.error}
            onRetry={loadRequests}
            onViewAll={() => navigate('/app/requests')}
            onOpenRequest={(id) => navigate(`/app/requests/${id}`)}
          />
        </div>

        <div className="manager-dashboard-column manager-dashboard-column--side">
          <ManagerPresenceCard
            presence={presence.data}
            loading={presence.loading}
            error={presence.error}
            onRetry={loadPresence}
            onOpenPresence={() => navigate('/app/service-presence')}
          />
          <ManagerTeamCard
            presence={presence.data}
            loading={presence.loading}
            error={presence.error}
            onRetry={loadPresence}
            onOpenPresence={() => navigate('/app/service-presence')}
          />
        </div>
      </div>
    </PageContainer>
  )
}
