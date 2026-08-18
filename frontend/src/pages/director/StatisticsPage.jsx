import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  getDirectorStatistics,
  getDirectorStatisticsServices,
} from '@/services/directorStatistics'

import '@/styles/director/statistics.css'

const PERIOD_OPTIONS = [
  { value: 'month', label: 'Ce mois' },
  { value: '3months', label: '3 derniers mois' },
  { value: '6months', label: '6 derniers mois' },
  { value: 'year', label: 'Cette année' },
  { value: 'custom', label: 'Période personnalisée' },
]

const ROLE_OPTIONS = [
  { value: 'all', label: 'Tous les rôles' },
  { value: 'COLLABORATEUR', label: 'Collaborateur' },
  { value: 'RESPONSABLE_SERVICE', label: 'Responsable de service' },
  { value: 'RH', label: 'RH' },
  { value: 'DIRECTEUR', label: 'Directeur' },
]

const DATA_TYPE_OPTIONS = [
  { value: 'ALL', label: 'Congés et absences' },
  { value: 'LEAVE', label: 'Congés' },
  { value: 'ABSENCE', label: 'Absences' },
]

const DONUT_COLORS = ['#2f86ef', '#45b8e8', '#10b981', '#f97316', '#ef6c78', '#8f7ee7']

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function resolvePresetPeriod(preset) {
  const now = new Date()

  if (preset === 'month') {
    return { startDate: dateKey(monthStart(now)), endDate: dateKey(monthEnd(now)) }
  }

  if (preset === '3months' || preset === '6months') {
    const count = preset === '3months' ? 3 : 6
    const start = new Date(now.getFullYear(), now.getMonth() - (count - 1), 1)
    return { startDate: dateKey(start), endDate: dateKey(monthEnd(now)) }
  }

  return {
    startDate: `${now.getFullYear()}-01-01`,
    endDate: `${now.getFullYear()}-12-31`,
  }
}

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(Number(value ?? 0))
}

function serviceLabel(service) {
  if (!service) return ''
  return service.externalCompanyName
    ? `${service.externalCompanyName} — ${service.name ?? ''}`
    : String(service.name ?? '')
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number)
  if (!year || !month) return monthKey
  return new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(year, month - 1, 1)).replace('.', '')
}

function StatCard({ icon, value, label, detail, tone, delay = 0 }) {
  return (
    <section className={`director-stat-kpi director-stat-kpi--${tone}`} style={{ '--stat-delay': `${delay}ms` }}>
      <div className="director-stat-kpi__icon"><Icon name={icon} size={19} /></div>
      <div className="director-stat-kpi__content">
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </section>
  )
}

function LineChart({ rows, dataType }) {
  const width = 900
  const height = 260
  const left = 44
  const right = 18
  const top = 18
  const bottom = 42
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const values = rows.flatMap((row) => [row.leaveRequests ?? 0, row.absenceDeclarations ?? 0])
  const maxValue = Math.max(1, ...values)
  const stepX = rows.length > 1 ? plotWidth / (rows.length - 1) : plotWidth

  const pointString = (key) => rows
    .map((row, index) => {
      const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
      const y = top + plotHeight - ((Number(row[key] ?? 0) / maxValue) * plotHeight)
      return `${x},${y}`
    })
    .join(' ')

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  if (rows.length === 0) {
    return <div className="director-stat-empty">Aucune donnée sur cette période.</div>
  }

  return (
    <div className="director-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Évolution des congés et absences">
        {ticks.map((ratio) => {
          const y = top + plotHeight - ratio * plotHeight
          return (
            <g key={ratio}>
              <line className="director-line-chart__grid" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="director-line-chart__axis" x={left - 10} y={y + 4} textAnchor="end">
                {Math.round(maxValue * ratio)}
              </text>
            </g>
          )
        })}

        {dataType !== 'ABSENCE' && (
          <>
            <polyline className="director-line-chart__line director-line-chart__line--leave" points={pointString('leaveRequests')} />
            {rows.map((row, index) => {
              const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
              const y = top + plotHeight - ((Number(row.leaveRequests ?? 0) / maxValue) * plotHeight)
              return (
                <g key={`leave-${row.monthKey}`}>
                  <title>{`${monthLabel(row.monthKey)} : ${row.leaveRequests ?? 0} congé(s)`}</title>
                  <circle
                    className="director-line-chart__dot director-line-chart__dot--leave"
                    cx={x}
                    cy={y}
                    r="4.5"
                    style={{ animationDelay: `${220 + index * 55}ms` }}
                  />
                </g>
              )
            })}
          </>
        )}

        {dataType !== 'LEAVE' && (
          <>
            <polyline className="director-line-chart__line director-line-chart__line--absence" points={pointString('absenceDeclarations')} />
            {rows.map((row, index) => {
              const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
              const y = top + plotHeight - ((Number(row.absenceDeclarations ?? 0) / maxValue) * plotHeight)
              return (
                <g key={`absence-${row.monthKey}`}>
                  <title>{`${monthLabel(row.monthKey)} : ${row.absenceDeclarations ?? 0} absence(s)`}</title>
                  <circle
                    className="director-line-chart__dot director-line-chart__dot--absence"
                    cx={x}
                    cy={y}
                    r="4.5"
                    style={{ animationDelay: `${300 + index * 55}ms` }}
                  />
                </g>
              )
            })}
          </>
        )}

        {rows.map((row, index) => {
          const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
          return (
            <text key={row.monthKey} className="director-line-chart__month" x={x} y={height - 12} textAnchor="middle">
              {monthLabel(row.monthKey)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function DonutChart({ rows }) {
  const visibleRows = rows.slice(0, 6)
  const remaining = rows.slice(6).reduce((sum, row) => sum + Number(row.total ?? 0), 0)
  const chartRows = remaining > 0
    ? [...visibleRows.slice(0, 5), { label: 'Autres', category: 'AUTRES', total: remaining }]
    : visibleRows
  const total = chartRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0)

  let cursor = 0
  const segments = chartRows.map((row, index) => {
    const start = total > 0 ? (cursor / total) * 360 : 0
    cursor += Number(row.total ?? 0)
    const end = total > 0 ? (cursor / total) * 360 : 0
    return `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start}deg ${end}deg`
  })

  return (
    <div className="director-donut-layout">
      <div className="director-donut-shell">
        <div className="director-donut" style={{ background: total > 0 ? `conic-gradient(${segments.join(', ')})` : '#edf3f9' }}>
          <div className="director-donut__center">
            <strong>{formatNumber(total, 0)}</strong>
            <span>dossiers</span>
          </div>
        </div>
      </div>
      <div className="director-donut-legend">
        {chartRows.length === 0 ? (
          <div className="director-stat-empty director-stat-empty--compact">Aucune donnée.</div>
        ) : chartRows.map((row, index) => (
          <div key={`${row.category}-${row.label}`} className="director-donut-legend__item" style={{ '--legend-delay': `${180 + index * 60}ms` }}>
            <span className="director-donut-legend__dot" style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }} />
            <span>{row.label}</span>
            <strong>{formatNumber(row.total, 0)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function ServiceBars({ rows }) {
  const visible = rows.filter((row) => Number(row.activeEmployees ?? 0) > 0)

  if (visible.length === 0) {
    return <div className="director-stat-empty">Aucun service ne correspond aux filtres.</div>
  }

  return (
    <div className="director-service-chart">
      {visible.map((row, index) => {
        const rate = Math.max(0, Math.min(100, Number(row.presenceRate ?? 0)))
        return (
          <div className="director-service-chart__item" key={row.serviceId} style={{ '--bar-delay': `${120 + index * 70}ms` }}>
            <div className="director-service-chart__plot">
              <strong>{formatNumber(rate)} %</strong>
              <div className="director-service-chart__track">
                <span style={{ height: `${Math.max(4, rate)}%` }} />
              </div>
              <div className="director-service-chart__tooltip">
                <b>{row.serviceName}</b>
                <span>{row.activeEmployees} personne{row.activeEmployees > 1 ? 's' : ''}</span>
                <span>{formatNumber(row.leaveDays)} j de congés</span>
                <span>{formatNumber(row.absenceDays)} j d’absence</span>
              </div>
            </div>
            <span className="director-service-chart__label">{row.serviceName}</span>
          </div>
        )
      })}
    </div>
  )
}

function MonthlyBars({ rows, dataType }) {
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.leaveRequests ?? 0, row.absenceDeclarations ?? 0]))

  if (rows.length === 0) {
    return <div className="director-stat-empty">Aucune donnée sur cette période.</div>
  }

  return (
    <div className="director-monthly-bars">
      {rows.map((row, index) => (
        <div className="director-monthly-bars__item" key={row.monthKey} style={{ '--month-delay': `${100 + index * 55}ms` }}>
          <div className="director-monthly-bars__columns">
            {dataType !== 'ABSENCE' && (
              <span
                className="director-monthly-bars__bar director-monthly-bars__bar--leave"
                style={{ height: `${Math.max(4, (Number(row.leaveRequests ?? 0) / maxValue) * 100)}%` }}
                title={`${row.leaveRequests ?? 0} congé(s)`}
              />
            )}
            {dataType !== 'LEAVE' && (
              <span
                className="director-monthly-bars__bar director-monthly-bars__bar--absence"
                style={{ height: `${Math.max(4, (Number(row.absenceDeclarations ?? 0) / maxValue) * 100)}%` }}
                title={`${row.absenceDeclarations ?? 0} absence(s)`}
              />
            )}
          </div>
          <strong>{monthLabel(row.monthKey)}</strong>
        </div>
      ))}
    </div>
  )
}

export function DirectorStatisticsPage() {
  const defaultPeriod = resolvePresetPeriod('year')
  const [periodPreset, setPeriodPreset] = useState('year')
  const [customStartDate, setCustomStartDate] = useState(defaultPeriod.startDate)
  const [customEndDate, setCustomEndDate] = useState(defaultPeriod.endDate)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [dataType, setDataType] = useState('ALL')
  const [services, setServices] = useState([])
  const [state, setState] = useState({ loading: true, error: false, data: null })

  const period = useMemo(() => {
    if (periodPreset === 'custom') {
      return { startDate: customStartDate, endDate: customEndDate }
    }
    return resolvePresetPeriod(periodPreset)
  }, [customEndDate, customStartDate, periodPreset])

  const params = useMemo(() => ({
    startDate: period.startDate,
    endDate: period.endDate,
    ...(serviceFilter !== 'all' ? { serviceId: Number(serviceFilter) } : {}),
    ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
    dataType,
  }), [dataType, period.endDate, period.startDate, roleFilter, serviceFilter])

  const load = useCallback(async () => {
    if (!period.startDate || !period.endDate || period.startDate > period.endDate) return

    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getDirectorStatistics(params)
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [params, period.endDate, period.startDate])

  useEffect(() => {
    getDirectorStatisticsServices()
      .then((result) => setServices(result.filter((service) => service?.isActive !== false)))
      .catch(() => setServices([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const refresh = () => load()
    window.addEventListener('gmes:data-changed', refresh)
    return () => window.removeEventListener('gmes:data-changed', refresh)
  }, [load])

  const totals = state.data?.totals ?? {}
  const byService = state.data?.byService ?? []
  const byLeaveType = state.data?.byLeaveType ?? []
  const byMonth = state.data?.byMonth ?? []
  const periodInvalid = periodPreset === 'custom' && (!customStartDate || !customEndDate || customStartDate > customEndDate)
  const resultsKey = `${periodPreset}-${customStartDate}-${customEndDate}-${serviceFilter}-${roleFilter}-${dataType}`

  return (
    <div className="director-statistics-page">
      <section className="director-stat-filters" aria-label="Filtres statistiques">
        <label className="director-stat-filter director-stat-filter--select">
          <span>Période</span>
          <select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value)}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {periodPreset === 'custom' && (
          <>
            <label className="director-stat-filter director-stat-filter--date">
              <span>Du</span>
              <input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} />
            </label>
            <label className="director-stat-filter director-stat-filter--date">
              <span>Au</span>
              <input type="date" value={customEndDate} min={customStartDate || undefined} onChange={(event) => setCustomEndDate(event.target.value)} />
            </label>
          </>
        )}

        <label className="director-stat-filter director-stat-filter--select">
          <span>Service</span>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
            <option value="all">Tous les services</option>
            {services
              .slice()
              .sort((left, right) => serviceLabel(left).localeCompare(serviceLabel(right), 'fr'))
              .map((service) => <option key={service.id} value={String(service.id)}>{serviceLabel(service)}</option>)}
          </select>
        </label>

        <label className="director-stat-filter director-stat-filter--select">
          <span>Rôle</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="director-stat-filter director-stat-filter--select">
          <span>Type</span>
          <select value={dataType} onChange={(event) => setDataType(event.target.value)}>
            {DATA_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </section>

      {periodInvalid && (
        <div className="director-stat-message director-stat-message--warning">
          La date de début doit être antérieure ou égale à la date de fin.
        </div>
      )}

      {!periodInvalid && (state.loading && !state.data ? (
        <div className="director-stat-state">
          <Icon name="chart" size={26} />
          <span>Chargement des statistiques…</span>
        </div>
      ) : state.error || !state.data ? (
        <div className="director-stat-state director-stat-state--error">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger les statistiques.</strong>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : (
        <div className="director-stat-results" key={resultsKey}>
          <div className="director-stat-kpis">
            <StatCard icon="users" tone="green" delay={0} value={`${formatNumber(totals.presenceRate)} %`} label="Taux de présence" detail="sur les jours ouvrés disponibles" />
            <StatCard icon="calendar" tone="blue" delay={70} value={`${formatNumber(totals.leaveDays)} j`} label="Jours de congés pris" detail={`${totals.validatedRequests ?? 0} demande${Number(totals.validatedRequests ?? 0) > 1 ? 's' : ''} validée${Number(totals.validatedRequests ?? 0) > 1 ? 's' : ''}`} />
            <StatCard icon="alert" tone="red" delay={140} value={`${formatNumber(totals.absenceDays)} j`} label="Jours d’absence" detail={`${totals.recordedAbsences ?? 0} absence${Number(totals.recordedAbsences ?? 0) > 1 ? 's' : ''} enregistrée${Number(totals.recordedAbsences ?? 0) > 1 ? 's' : ''}`} />
            {dataType === 'ABSENCE' ? (
              <StatCard icon="check" tone="orange" delay={210} value={formatNumber(totals.recordedAbsences, 0)} label="Absences enregistrées" detail={`${totals.absenceDeclarations ?? 0} déclaration${Number(totals.absenceDeclarations ?? 0) > 1 ? 's' : ''}`} />
            ) : (
              <StatCard icon="check" tone="orange" delay={210} value={formatNumber(totals.processedRequests, 0)} label="Demandes traitées" detail={`${totals.pendingRequests ?? 0} encore en attente`} />
            )}
          </div>

          <div className="director-stat-grid director-stat-grid--overview">
            <section className="director-stat-card director-stat-card--services">
              <header className="director-stat-card__header">
                <div>
                  <h2>Présence par service</h2>
                  <p>Taux de présence sur la période sélectionnée</p>
                </div>
                <span className="director-stat-card__badge">Données réelles</span>
              </header>
              <ServiceBars rows={byService} />
            </section>

            <section className="director-stat-card director-stat-card--donut">
              <header className="director-stat-card__header">
                <div>
                  <h2>Répartition par type</h2>
                  <p>Congés et absences enregistrés</p>
                </div>
              </header>
              <DonutChart rows={byLeaveType} />
            </section>
          </div>

          <section className="director-stat-card director-stat-card--evolution">
            <header className="director-stat-card__header">
              <div>
                <h2>Évolution des congés et absences</h2>
                <p>Évolution mensuelle sur la période sélectionnée</p>
              </div>
              <div className="director-stat-legend">
                {dataType !== 'ABSENCE' && <span className="director-stat-legend__leave">Congés</span>}
                {dataType !== 'LEAVE' && <span className="director-stat-legend__absence">Absences</span>}
              </div>
            </header>
            <LineChart rows={byMonth} dataType={dataType} />
          </section>

          <section className="director-stat-card director-stat-card--monthly">
            <header className="director-stat-card__header">
              <div>
                <h2>Congés et absences par mois</h2>
                <p>Volume mensuel des dossiers</p>
              </div>
              <div className="director-stat-legend">
                {dataType !== 'ABSENCE' && <span className="director-stat-legend__leave">Congés</span>}
                {dataType !== 'LEAVE' && <span className="director-stat-legend__absence">Absences</span>}
              </div>
            </header>
            <MonthlyBars rows={byMonth} dataType={dataType} />
          </section>
        </div>
      ))}
    </div>
  )
}
