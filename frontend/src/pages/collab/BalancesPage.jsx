import { useCallback, useEffect, useMemo, useState } from 'react'

import { BalanceOverview } from '@/components/collab/balances/BalanceOverview'
import { getBalanceSettings, getMyBalances } from '@/services/balances'
import { formatDateNumericFR, formatDays, toISODate } from '@/utils/format'
import { settingsMap } from '@/utils/newRequest'
import { buildBalanceSummary } from '@/utils/balanceSummary'

import '@/styles/balances.css'

function parseReferencePeriodDates(referencePeriod, startSetting = '06-01') {
  const [startYear, endYear] = String(referencePeriod ?? '').split('-').map(Number)
  const [month, day] = String(startSetting || '06-01').split('-').map(Number)

  if (!startYear || !endYear || !month || !day) {
    return null
  }

  const start = new Date(startYear, month - 1, day)
  const nextStart = new Date(endYear, month - 1, day)
  nextStart.setDate(nextStart.getDate() - 1)

  return {
    start: toISODate(start),
    end: toISODate(nextStart),
  }
}

function PageState({ title, text, onRetry }) {
  return (
    <div className="balances-state">
      <strong>{title}</strong>
      <span>{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  )
}

export function BalancesPage() {
  const [state, setState] = useState({ loading: true, error: false, balances: [], settings: [] })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))

    try {
      const [balancesResult, settingsResult] = await Promise.allSettled([
        getMyBalances(),
        getBalanceSettings(),
      ])

      if (balancesResult.status === 'rejected') {
        throw balancesResult.reason
      }

      setState({
        loading: false,
        error: false,
        balances: balancesResult.value ?? [],
        settings: settingsResult.status === 'fulfilled' ? settingsResult.value ?? [] : [],
      })
    } catch {
      setState({ loading: false, error: true, balances: [], settings: [] })
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

  const summary = useMemo(() => buildBalanceSummary(state.balances), [state.balances])
  const config = useMemo(() => settingsMap(state.settings), [state.settings])
  const periodDates = summary
    ? parseReferencePeriodDates(summary.referencePeriod, config.REFERENCE_PERIOD_START)
    : null

  if (state.loading) {
    return (
      <div className="balances-page">
        <div className="balances-page__skeleton balances-page__skeleton--period" />
        <div className="balances-page__skeleton balances-page__skeleton--overview" />
        <div className="balances-page__skeleton balances-page__skeleton--potential" />
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="balances-page">
        <PageState
          title="Impossible de charger vos soldes"
          text="Les informations de solde sont momentanément indisponibles."
          onRetry={load}
        />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="balances-page">
        <PageState
          title="Aucun solde disponible"
          text="Votre solde apparaîtra ici dès qu’il sera initialisé par la RH."
        />
      </div>
    )
  }

  const available = summary.availableDays
  const reserved = summary.reservedDays
  const acquisition = summary.currentAccrualDays
  const potential = summary.potentialDays
  const periodLabel = periodDates
    ? `${formatDateNumericFR(periodDates.start)} → ${formatDateNumericFR(periodDates.end)}`
    : summary.referencePeriod

  return (
    <div className="balances-page">
      <div className="balances-page__period">Période {periodLabel}</div>

      <BalanceOverview
        available={available}
        acquisition={acquisition}
        reserved={reserved}
        potential={potential}
        acquisitionSubtitle={periodDates ? `Acquis sur la période jusqu’au ${formatDateNumericFR(periodDates.end)}` : 'Acquis sur la période'}
      />

      <span className="balances-page__sr-only">Disponible après réservations : {formatDays(potential)} jours</span>
    </div>
  )
}
