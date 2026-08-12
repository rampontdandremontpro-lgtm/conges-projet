import { Icon } from '@/components/ui/Icon'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'
import {
  addDaysISO,
  formatDateNumericFR,
  todayISO,
  toISODate,
} from '@/utils/format'

function buildAlerts({ balance, requests, settings }) {
  const alerts = []
  const today = todayISO()

  for (const request of requests ?? []) {
    if (!request.decisionAt) continue
    const decisionIso = String(request.decisionAt).slice(0, 10)
    if (request.status === 'VALIDEE' && decisionIso >= addDaysISO(today, -14)) {
      alerts.push({
        tone: 'success',
        text: `Demande du ${formatDateNumericFR(request.startDate)} validée`,
      })
    }
  }

  if (balance) {
    const periodEndSetting = settings?.find(
      (setting) => setting.settingKey === 'REFERENCE_PERIOD_START',
    )
    if (periodEndSetting) {
      const [, endYear] = balance.referencePeriod.split('-').map(Number)
      const [month, day] = periodEndSetting.settingValue.split('-').map(Number)
      const periodEnd = toISODate(new Date(endYear, month - 1, day - 1))
      if (today <= periodEnd && (balance.availableDays || 0) > 0) {
        alerts.push({
          tone: 'warning',
          text: `Posez vos congés avant le ${formatDateNumericFR(periodEnd)}`,
        })
      }
    }
  }

  for (const request of requests ?? []) {
    if (request.status === 'EN_ATTENTE_VALIDATION') {
      alerts.push({
        tone: 'info',
        text: `Demande du ${formatDateNumericFR(request.startDate)} en attente de validation`,
      })
    }
  }

  return alerts
}

export function AlertsCard({ balances, requests, settings, onRetryBalances, onRetryRequests }) {
  let content

  const bothLoading = balances.loading && requests.loading
  const bothError = balances.error && requests.error

  if (bothLoading) {
    content = <CardSkeleton rows={2} />
  } else if (bothError) {
    content = (
      <CardError
        onRetry={() => {
          onRetryBalances()
          onRetryRequests()
        }}
      />
    )
  } else {
    const balance = balances.data?.find((item) => item.counterType === 'N') ?? balances.data?.[0] ?? null
    const alerts = buildAlerts({
      balance,
      requests: requests.error ? [] : (requests.data ?? []),
      settings: settings.error ? null : settings.data,
    })
    if (alerts.length === 0) {
      content = (
        <div className="dash-empty dash-empty--compact">
          <span className="dash-empty__icon">
            <Icon name="check" size={24} />
          </span>
          <p className="dash-empty__title">Aucune alerte pour le moment</p>
        </div>
      )
    } else {
      content = (
        <ul className="alert-list">
          {alerts.map((alert, index) => (
            <li key={index} className={`alert-pill alert-pill--${alert.tone}`}>
              {alert.text}
            </li>
          ))}
        </ul>
      )
    }
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Alertes</h2>
      </header>
      {content}
    </section>
  )
}
