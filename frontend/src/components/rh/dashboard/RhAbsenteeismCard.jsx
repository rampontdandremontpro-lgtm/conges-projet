import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'

const getDonutColor = (index) => `hsl(${(210 + (index * 47)) % 360} 72% 52%)`

function formatRate(value) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: Number(value ?? 0) > 0 && Number(value ?? 0) < 1 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0))
}

function buildRows(items) {
  return Array.isArray(items) ? items : []
}

const PERIOD_OPTIONS = [
  { value: 'month', label: 'Ce mois' },
  { value: '3months', label: '3 derniers mois' },
  { value: '6months', label: '6 derniers mois' },
  { value: 'year', label: 'Cette année' },
]

export function RhAbsenteeismCard({ absenteeism, period = 'month', onPeriodChange }) {
  const rows = buildRows(absenteeism?.byType)
  const totalDays = rows.reduce((sum, item) => sum + Number(item.days ?? 0), 0)
  const globalRate = Number(absenteeism?.globalRate ?? 0)

  let cursor = 0
  const segments = rows.map((item, index) => {
    const start = totalDays > 0 ? (cursor / totalDays) * 360 : 0
    cursor += Number(item.days ?? 0)
    const end = totalDays > 0 ? (cursor / totalDays) * 360 : 0
    return `${getDonutColor(index)} ${start}deg ${end}deg`
  })

  return (
    <section className="dash-card rh-absenteeism-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <div className="rh-absenteeism-title-row">
            <h2 className="dash-card__title">Taux d&apos;absentéisme</h2>
            <StatisticInfoButton title="Taux d’absentéisme">
              <p><strong>Calcul :</strong> jours d’absence enregistrée ÷ jours ouvrables disponibles × 100.</p>
              <p>Les congés payés sont exclus. Le calcul porte sur les collaborateurs actifs concernés (hors Admin, RH et Directeur), tient compte de leur date d’entrée et exclut les week-ends ainsi que les jours fériés ou fermetures non décomptables.</p>
            </StatisticInfoButton>
          </div>
        </div>
        <label className="rh-absenteeism-period-filter">
          <span>Période</span>
          <select value={period} onChange={(event) => onPeriodChange?.(event.target.value)}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="rh-absenteeism-layout">
        <div className="rh-absenteeism-donut-wrap">
          <div
            className="rh-absenteeism-donut"
            style={{ background: totalDays > 0 ? `conic-gradient(${segments.join(', ')})` : '#edf3f9' }}
            role="img"
            aria-label={`Taux d'absentéisme global ${formatRate(globalRate)} %`}
          >
            <div className="rh-absenteeism-donut__center">
              <strong>{formatRate(globalRate)}%</strong>
              <span>global</span>
            </div>
          </div>
        </div>

        <div className="rh-absenteeism-legend">
          {rows.length === 0 ? (
            <div className="rh-absenteeism-empty">Aucune absence enregistrée sur la période.</div>
          ) : rows.map((item, index) => (
            <div className="rh-absenteeism-legend__row" key={`${item.label}-${index}`}>
              <span className="rh-absenteeism-legend__dot" style={{ backgroundColor: getDonutColor(index) }} />
              <span className="rh-absenteeism-legend__label">{item.label}</span>
              <strong>{formatRate(item.rate)}%</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
