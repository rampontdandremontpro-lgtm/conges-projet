import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageContainer } from '@/components/ui/PageContainer'
import { LeaveBalanceCard } from '@/components/dashboard/LeaveBalanceCard'
import { NextLeaveCard } from '@/components/dashboard/NextLeaveCard'
import { RecentRequestsCard } from '@/components/dashboard/RecentRequestsCard'
import { PlanLeaveCard } from '@/components/dashboard/PlanLeaveCard'
import { AlertsCard } from '@/components/dashboard/AlertsCard'
import { getMyLeaveBalances, getMyLeaveRequests, getPublicSettings } from '@/services/dashboard'
import { todayISO } from '@/utils/format'

import '@/styles/dashboard.css'

function selectPrimaryBalance(balances) {
  if (!balances || balances.length === 0) return null
  const current = balances.find((balance) => balance.counterType === 'N')
  if (current) return current
  return [...balances].sort((a, b) =>
    b.referencePeriod.localeCompare(a.referencePeriod),
  )[0]
}

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

  const loadBalances = useCallback(async () => {
    try {
      const data = await getMyLeaveBalances()
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
    let cancelled = false
    getMyLeaveBalances()
      .then((data) => {
        if (!cancelled) setBalances({ loading: false, error: false, data })
      })
      .catch(() => {
        if (!cancelled) setBalances({ loading: false, error: true, data: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getMyLeaveRequests()
      .then((data) => {
        if (!cancelled) setRequests({ loading: false, error: false, data })
      })
      .catch(() => {
        if (!cancelled) setRequests({ loading: false, error: true, data: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const balance = selectPrimaryBalance(balances.data)
  const nextLeave = computeNextLeave(requests.data)
  const recent = requests.data.slice(0, 4)
  const availableDays = balance ? balance.availableDays : null

  return (
    <PageContainer className="dash-page">
      <div className="dash-grid">
        <div className="dash-col dash-col--main">
          <LeaveBalanceCard
            balance={balance}
            loading={balances.loading}
            error={balances.error}
            onRetry={retryBalances}
          />
          <RecentRequestsCard
            requests={recent}
            loading={requests.loading}
            error={requests.error}
            onRetry={retryRequests}
            onViewAll={() => navigate('/app/my-requests')}
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
