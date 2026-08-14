import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { LeaveBalanceCard } from '@/components/collab/dashboard/LeaveBalanceCard'
import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { getMyLeaveBalances } from '@/services/dashboard'
import { buildBalanceSummary } from '@/utils/balanceSummary'
import { formatDays, formatPeriod } from '@/utils/format'

import '@/styles/dashboard.css'
import '@/styles/manager-my-balance.css'

function BalanceHistoryCard({ summary, onHistory }) {
  const real = Number(summary?.availableDays ?? 0)
  const reserved = Number(summary?.reservedDays ?? 0)
  const potential = Number(summary?.potentialDays ?? 0)
  const acquisition = Number(summary?.currentAccrualDays ?? 0)

  return (
    <section className="manager-my-balance__history-card">
      <div className="manager-my-balance__history-icon" aria-hidden="true">
        <Icon name="clock" size={24} />
      </div>

      <div className="manager-my-balance__history-copy">
        <span className="manager-my-balance__eyebrow">Historique des soldes</span>
        <h2>Retrouvez tous vos mouvements</h2>
        <p>
          Consultez les acquisitions mensuelles, congés débités, recrédits et éventuelles
          corrections enregistrées sur votre compte.
        </p>
      </div>

      {summary && (
        <div className="manager-my-balance__mini-stats" aria-label="Résumé du solde">
          <div>
            <span>Solde réel</span>
            <strong>{formatDays(real)} j</strong>
          </div>
          <div>
            <span>Réservé</span>
            <strong>{formatDays(reserved)} j</strong>
          </div>
          <div>
            <span>Disponible</span>
            <strong>{formatDays(potential)} j</strong>
          </div>
          <div>
            <span>Acquisition</span>
            <strong>{formatDays(acquisition)} j</strong>
          </div>
        </div>
      )}

      <button type="button" className="manager-my-balance__history-button" onClick={onHistory}>
        <Icon name="clock" size={16} />
        Voir mon historique
        <Icon name="chevronRight" size={16} />
      </button>
    </section>
  )
}

export function ManagerMyBalancePage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: false, data: [] })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getMyLeaveBalances()
      setState({ loading: false, error: false, data: Array.isArray(data) ? data : [] })
    } catch {
      setState({ loading: false, error: true, data: [] })
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

  const summary = useMemo(() => buildBalanceSummary(state.data), [state.data])

  return (
    <PageContainer className="manager-my-balance">
      <div className="manager-my-balance__content">
        <LeaveBalanceCard
          summary={summary}
          loading={state.loading}
          error={state.error}
          onRetry={load}
        />

        {!state.loading && !state.error && summary && (
          <div className="manager-my-balance__period-note">
            <Icon name="info" size={16} />
            <span>
              Période de référence <strong>{formatPeriod(summary.referencePeriod)}</strong>.
              Les demandes de congés payés en attente réservent des jours sans diminuer
              le solde réel avant leur validation.
            </span>
          </div>
        )}

        <BalanceHistoryCard
          summary={!state.loading && !state.error ? summary : null}
          onHistory={() => navigate('/app/history')}
        />
      </div>
    </PageContainer>
  )
}
