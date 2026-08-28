import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageContainer } from '@/components/ui/PageContainer'
import { LeaveBalanceCard } from '@/components/collab/dashboard/LeaveBalanceCard'
import { NextLeaveCard } from '@/components/collab/dashboard/NextLeaveCard'
import { RecentRequestsCard } from '@/components/collab/dashboard/RecentRequestsCard'
import { PlanLeaveCard } from '@/components/collab/dashboard/PlanLeaveCard'
import { AlertsCard } from '@/components/collab/dashboard/AlertsCard'
import { getMyLeavePeriodSummaries, getMyLeaveRequests, getPublicSettings } from '@/services/collab/dashboard'
import { todayISO } from '@/utils/format'
import { adjacentReferencePeriodOptions, counterReferencePeriod, currentReferencePeriod, formatReferencePeriodRange } from '@/utils/referencePeriods'

import '@/styles/collab/dashboard/index.css'

function computeNextLeave(requests) {
  if (!requests || requests.length === 0) return null
  const today = todayISO()
  const upcoming = requests
    .filter((request) => request.status === 'VALIDEE' && request.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  return upcoming[0] ?? null
}

export function DashboardCollaborateur() {
  const navigate = useNavigate()
  const [balances, setBalances] = useState({ loading: true, error: false, data: [] })
  const [requests, setRequests] = useState({ loading: true, error: false, data: [] })
  const [settings, setSettings] = useState({ loading: true, error: false, data: null })
  const [selectedPeriod, setSelectedPeriod] = useState(() => counterReferencePeriod(currentReferencePeriod(), 'N-1'))

  const loadBalances = useCallback(async () => {
    try {
      const data = await getMyLeavePeriodSummaries()
      setBalances({ loading: false, error: false, data })
    } catch {
      setBalances({ loading: false, error: true, data: [] })
    }
  }, [])

  const retryBalances = useCallback(() => {
    setBalances({ loading: true, error: false, data: [] })
    loadBalances()
  }, [loadBalances])

  const loadRequests = useCallback(async () => {
    try {
      const data = await getMyLeaveRequests()
      setRequests({ loading: false, error: false, data })
    } catch {
      setRequests({ loading: false, error: true, data: [] })
    }
  }, [])

  const retryRequests = useCallback(() => {
    setRequests({ loading: true, error: false, data: [] })
    loadRequests()
  }, [loadRequests])

  useEffect(() => {
    loadBalances()
    loadRequests()

    const refresh = () => {
      loadBalances()
      loadRequests()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadBalances, loadRequests])

  useEffect(() => {
    if (balances.loading || balances.error) return
    const nMinus1 = counterReferencePeriod(currentReferencePeriod(), 'N-1')
    const hasSelectedPeriod = balances.data.some((item) => item.referencePeriod === selectedPeriod)
    const hasNMinus1 = balances.data.some((item) => item.referencePeriod === nMinus1)
    if (!hasSelectedPeriod && selectedPeriod === nMinus1 && !hasNMinus1) {
      setSelectedPeriod(currentReferencePeriod())
    }
  }, [balances.data, balances.error, balances.loading, selectedPeriod])

  useEffect(() => {
    let cancelled = false
    getPublicSettings()
      .then((data) => {
        if (!cancelled) setSettings({ loading: false, error: false, data })
      })
      .catch(() => {
        if (!cancelled) setSettings({ loading: false, error: true, data: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const periodOptions = adjacentReferencePeriodOptions()
  const selectedPeriodLabel = periodOptions.find((item) => item.value === selectedPeriod)?.label ?? formatReferencePeriodRange(selectedPeriod)
  const balanceSummary = balances.data.find((item) => item.referencePeriod === selectedPeriod) ?? {
    referencePeriod: selectedPeriod, acquiredDays: 0, takenDays: 0, balanceDays: 0, validatedDays: 0, pendingDays: 0,
  }
  const nextLeave = computeNextLeave(requests.data)
  const recent = requests.data.slice(0, 4)
  const availableDays = balanceSummary?.balanceDays ?? null

  return (
    <PageContainer className="dash-page">
      <div className="dash-grid">
        <div className="dash-col dash-col--main">
          <LeaveBalanceCard
            summary={balanceSummary}
            loading={balances.loading}
            error={balances.error}
            onRetry={retryBalances}
            periodOptions={periodOptions}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            actionLabel="Voir mon historique"
            actionIcon="clock"
            onAction={() => navigate('/app/history')}
          />
          <RecentRequestsCard
            requests={recent}
            loading={requests.loading}
            error={requests.error}
            onRetry={retryRequests}
            onViewAll={() => navigate('/app/my-requests')}
            onOpenRequest={(request) => {
              if (request.status === 'BROUILLON') {
                navigate(`/app/new-request/${request.id}`)
                return
              }

              navigate(`/app/my-requests/leave/${request.id}`)
            }}
          />
        </div>
        <div className="dash-col dash-col--side">
          <NextLeaveCard
            nextLeave={nextLeave}
            loading={requests.loading}
            error={requests.error}
            onRetry={retryRequests}
          />
          <PlanLeaveCard
            availableDays={availableDays}
            periodLabel={selectedPeriodLabel}
            onNewRequest={() => navigate('/app/new-request')}
          />
          <AlertsCard
            balances={balances}
            requests={requests}
            settings={settings}
            onRetryBalances={retryBalances}
            onRetryRequests={retryRequests}
          />
        </div>
      </div>
    </PageContainer>
  )
}
