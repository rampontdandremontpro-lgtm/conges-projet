import { useCallback, useEffect, useMemo, useState } from 'react'

import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
import { Icon } from '@/components/ui/Icon'
import {
  getDirectorStatistics,
  getDirectorStatisticsServices,
  getDirectorStatisticsLeaveTypes,
} from '@/services/director/directorStatistics'

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

function resolveAxisScale(values) {
  const rawMax = Math.max(1, ...values.map((value) => Number(value ?? 0)))
  const targetIntervals = 4
  const roughStep = rawMax / targetIntervals
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)))
  const normalized = roughStep / magnitude
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = Math.max(1, niceFactor * magnitude)
  const max = Math.max(step, Math.ceil(rawMax / step) * step)
  const ticks = []
  for (let value = 0; value <= max + Number.EPSILON; value += step) ticks.push(value)
  return { max, ticks }
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

function StatCard({ icon, value, label, tone, delay = 0, info }) {
  return (
    <section className={`director-stat-kpi director-stat-kpi--${tone}`} style={{ '--stat-delay': `${delay}ms` }}>
      <div className="director-stat-kpi__icon"><Icon name={icon} size={19} /></div>
      <div className="director-stat-kpi__content">
        <strong>{value}</strong>
        <div className="director-stat-kpi__label">
          {label}
          {info}
        </div>
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
  const values = rows.flatMap((row) => [row.leaveDays ?? 0, row.absenceDays ?? 0])
  const axis = resolveAxisScale(values)
  const stepX = rows.length > 1 ? plotWidth / (rows.length - 1) : plotWidth

  const pointString = (key) => rows
    .map((row, index) => {
      const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
      const y = top + plotHeight - ((Number(row[key] ?? 0) / axis.max) * plotHeight)
      return `${x},${y}`
    })
    .join(' ')

  if (rows.length === 0) {
    return <div className="director-stat-empty">Aucune donnée sur cette période.</div>
  }

  return (
    <div className="director-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Évolution des congés et absences">
        {axis.ticks.map((tick) => {
          const y = top + plotHeight - (tick / axis.max) * plotHeight
          return (
            <g key={tick}>
              <line className="director-line-chart__grid" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="director-line-chart__axis" x={left - 10} y={y + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          )
        })}

        {dataType !== 'ABSENCE' && (
          <>
            <polyline className="director-line-chart__line director-line-chart__line--leave" points={pointString('leaveDays')} />
            {rows.map((row, index) => {
              const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
              const y = top + plotHeight - ((Number(row.leaveDays ?? 0) / axis.max) * plotHeight)
              return (
                <g key={`leave-${row.monthKey}`}>
                  <title>{`${monthLabel(row.monthKey)} : ${formatNumber(row.leaveDays ?? 0)} jour(s) de congé`}</title>
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
            <polyline className="director-line-chart__line director-line-chart__line--absence" points={pointString('absenceDays')} />
            {rows.map((row, index) => {
              const x = left + (rows.length === 1 ? plotWidth / 2 : index * stepX)
              const y = top + plotHeight - ((Number(row.absenceDays ?? 0) / axis.max) * plotHeight)
              return (
                <g key={`absence-${row.monthKey}`}>
                  <title>{`${monthLabel(row.monthKey)} : ${formatNumber(row.absenceDays ?? 0)} jour(s) d’absence`}</title>
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
            <span>jours</span>
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
  const visible = rows

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

export function DirectorStatisticsPage({
  getStatistics = getDirectorStatistics,
  getStatisticsServices = getDirectorStatisticsServices,
  getStatisticsLeaveTypes = getDirectorStatisticsLeaveTypes,
} = {}) {
  const defaultPeriod = resolvePresetPeriod('month')
  const [periodPreset, setPeriodPreset] = useState('month')
  const [customStartDate, setCustomStartDate] = useState(defaultPeriod.startDate)
  const [customEndDate, setCustomEndDate] = useState(defaultPeriod.endDate)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [serviceScope, setServiceScope] = useState('INTERNE')
  const [services, setServices] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
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
    ...(serviceFilter === 'external' ? { serviceScope: 'EXTERNE' } : serviceFilter !== 'all' ? { serviceId: Number(serviceFilter) } : {}),
    ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
    ...(typeFilter.startsWith('leave:') ? { leaveTypeId: Number(typeFilter.slice(6)), dataType: 'LEAVE' } : {}),
    ...(typeFilter.startsWith('absence:') ? { leaveTypeId: Number(typeFilter.slice(8)), dataType: 'ABSENCE' } : {}),
    ...(typeFilter === 'ABSENCE' ? { dataType: 'ABSENCE' } : typeFilter === 'ALL' ? { dataType: 'ALL' } : {}),
  }), [period.endDate, period.startDate, roleFilter, serviceFilter, typeFilter])

  const load = useCallback(async () => {
    if (!period.startDate || !period.endDate || period.startDate > period.endDate) return

    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getStatistics(params)
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [getStatistics, params, period.endDate, period.startDate])

  useEffect(() => {
    getStatisticsServices()
      .then((result) => setServices(result.filter((service) => service?.isActive !== false)))
      .catch(() => setServices([]))
  }, [getStatisticsServices])


  useEffect(() => {
    getStatisticsLeaveTypes()
      .then((result) => setLeaveTypes(Array.isArray(result) ? result : []))
      .catch(() => setLeaveTypes([]))
  }, [getStatisticsLeaveTypes])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const refresh = () => load()
    window.addEventListener('gmes:data-changed', refresh)
    return () => window.removeEventListener('gmes:data-changed', refresh)
  }, [load])

  useEffect(() => {
    if (serviceFilter === 'all') return

    if (serviceFilter === 'external') {
      setServiceScope('EXTERNE')
      return
    }
    const selectedService = services.find((service) => String(service.id) === serviceFilter)
    if (!selectedService) return

    setServiceScope(
      selectedService.serviceType === 'EXTERNE' || selectedService.externalCompanyName
        ? 'EXTERNE'
        : 'INTERNE',
    )
  }, [serviceFilter, services])

  const dataType = typeFilter === 'ABSENCE' || typeFilter.startsWith('absence:') ? 'ABSENCE' : typeFilter.startsWith('leave:') ? 'LEAVE' : 'ALL'
  const totals = state.data?.totals ?? {}
  const byService = state.data?.byService ?? []
  const byLeaveType = state.data?.byLeaveType ?? []
  const byMonth = state.data?.byMonth ?? []
  const visibleServiceRows = useMemo(() => {
    if (serviceFilter !== 'all') return byService

    const typeByServiceId = new Map(
      services.map((service) => [
        String(service.id),
        service.serviceType === 'EXTERNE' || service.externalCompanyName ? 'EXTERNE' : 'INTERNE',
      ]),
    )

    return byService.filter((row) => {
      const type = typeByServiceId.get(String(row.serviceId))
        ?? (String(row.serviceName ?? '').includes(' — ') ? 'EXTERNE' : 'INTERNE')
      return type === serviceScope
    })
  }, [byService, serviceFilter, serviceScope, services])

  const changeServiceScope = (scope) => {
    setServiceScope(scope)
    if (serviceFilter !== 'all') setServiceFilter('all')
  }

  const periodInvalid = periodPreset === 'custom' && (!customStartDate || !customEndDate || customStartDate > customEndDate)
  const resultsKey = `${periodPreset}-${customStartDate}-${customEndDate}-${serviceFilter}-${roleFilter}-${typeFilter}`

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

        <label className="director-stat-filter director-stat-filter--select director-stat-filter--service">
          <span>Service</span>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
            <option value="all">Tous les services</option>
            {services
              .filter((service) => service.serviceType !== 'EXTERNE' && !service.externalCompanyName)
              .slice()
              .sort((left, right) => serviceLabel(left).localeCompare(serviceLabel(right), 'fr'))
              .map((service) => <option key={service.id} value={String(service.id)}>{serviceLabel(service)}</option>)}
            {services.some((service) => service.serviceType === 'EXTERNE' || service.externalCompanyName) && <option value="external">Mis à disposition</option>}
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
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="ALL">Tous les types</option>
            {leaveTypes.slice().sort((a, b) => {
              const categoryCompare = String(a.category).localeCompare(String(b.category), 'fr')
              return categoryCompare || String(a.name).localeCompare(String(b.name), 'fr')
            }).map((type) => (
              <option
                key={type.id}
                value={`${type.category === 'DECLARATION_ABSENCE' ? 'absence' : 'leave'}:${type.id}`}
              >
                {type.name}
              </option>
            ))}
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
            <StatCard
              icon="users"
              tone="green"
              delay={0}
              value={`${formatNumber(totals.presenceRate)} %`}
              label="Taux de présence"
              info={(
                <StatisticInfoButton title="Taux de présence">
                  <p><strong>Calcul :</strong> (jours ouvrés disponibles − jours d’indisponibilité) ÷ jours ouvrés disponibles × 100.</p>
                  <p>Les jours ouvrés disponibles tiennent compte des collaborateurs actifs concernés, de leur date d’entrée, des week-ends et des jours fériés/fermetures non décomptables. Les rôles Admin, RH et Directeur sont exclus.</p>
                  <p>Les congés validés et les absences enregistrées sont comptés sur la période, sans doubler une même journée pour un même collaborateur. Les filtres sélectionnés sont appliqués.</p>
                </StatisticInfoButton>
              )}
            />
            <StatCard icon="calendar" tone="blue" delay={70} value={`${formatNumber(totals.leaveDays)} j`} label="Jours de congés pris" />
            <StatCard icon="alert" tone="red" delay={140} value={`${formatNumber(totals.absenceDays)} j`} label="Jours d’absence" />
            {dataType === 'ABSENCE' ? (
              <StatCard icon="check" tone="orange" delay={210} value={formatNumber(totals.recordedAbsences, 0)} label="Absences enregistrées" />
            ) : (
              <StatCard icon="check" tone="orange" delay={210} value={formatNumber(totals.processedRequests, 0)} label="Demandes traitées" />
            )}
          </div>

          <div className="director-stat-grid director-stat-grid--overview">
            <section className="director-stat-card director-stat-card--services">
              <header className="director-stat-card__header">
                <div>
                  <div className="director-stat-card__title-row">
                    <h2>Présence par service</h2>
                    <StatisticInfoButton title="Présence par service">
                      <p><strong>Calcul :</strong> le taux de présence est calculé service par service avec la même formule que le taux global.</p>
                      <p>Il compare les jours ouvrés disponibles des collaborateurs actifs du service aux jours de congé validé et d’absence enregistrée compris dans la période, en tenant compte des jours non travaillés.</p>
                    </StatisticInfoButton>
                  </div>
                  <p>Taux de présence sur la période sélectionnée</p>
                </div>
                {serviceFilter === 'all' && <div className="director-stat-service-toggle" role="group" aria-label="Type de services">
                  <button
                    type="button"
                    className={serviceScope === 'INTERNE' ? 'is-active' : ''}
                    onClick={() => changeServiceScope('INTERNE')}
                  >
                    <Icon name="building" size={15} />
                    Service interne
                  </button>
                  <button
                    type="button"
                    className={serviceScope === 'EXTERNE' ? 'is-active' : ''}
                    onClick={() => changeServiceScope('EXTERNE')}
                  >
                    <Icon name="users" size={15} />
                    Service externe
                  </button>
                </div>}
              </header>
              <ServiceBars rows={visibleServiceRows} />
            </section>

            <section className="director-stat-card director-stat-card--donut">
              <header className="director-stat-card__header">
                <div>
                  <div className="director-stat-card__title-row">
                    <h2>Répartition par type</h2>
                    <StatisticInfoButton title="Répartition par type">
                      <p>Le graphique additionne les jours de congés validés et les jours d’absences enregistrées, puis les regroupe par type.</p>
                      <p>Seule la partie réellement comprise dans la période sélectionnée est comptabilisée. Les filtres de service, rôle et type sont appliqués.</p>
                    </StatisticInfoButton>
                  </div>
                  <p>Nombre de jours par type</p>
                </div>
              </header>
              <DonutChart rows={byLeaveType} />
            </section>
          </div>

          <section className="director-stat-card director-stat-card--evolution">
            <header className="director-stat-card__header">
              <div>
                <div className="director-stat-card__title-row">
                  <h2>Évolution des congés et absences</h2>
                  <StatisticInfoButton title="Évolution des congés et absences">
                    <p>Chaque point représente le nombre de jours de congés validés ou d’absences enregistrées rattachés au mois concerné.</p>
                    <p>Une période qui chevauche plusieurs mois est ventilée entre les mois concernés au lieu d’être entièrement attribuée au mois de départ.</p>
                  </StatisticInfoButton>
                </div>
                <p>Évolution mensuelle sur la période sélectionnée</p>
              </div>
              <div className="director-stat-legend">
                {dataType !== 'ABSENCE' && <span className="director-stat-legend__leave">Congés</span>}
                {dataType !== 'LEAVE' && <span className="director-stat-legend__absence">Absences</span>}
              </div>
            </header>
            <LineChart rows={byMonth} dataType={dataType} />
          </section>

        </div>
      ))}
    </div>
  )
}
