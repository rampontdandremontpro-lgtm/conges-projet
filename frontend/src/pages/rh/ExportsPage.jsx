import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { downloadRhExport, getRhExportsOverview } from '@/services/rhExports'

import '@/styles/rh/exports.css'

function dateInputValue(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function defaultFilters() {
  const now = new Date()
  const year = now.getFullYear()
  return {
    startDate: dateInputValue(year, 1, 1),
    endDate: dateInputValue(year, 12, 31),
    serviceId: '',
    employeeId: '',
  }
}

function plural(value, singular, pluralValue) {
  return `${value} ${value === 1 ? singular : pluralValue}`
}

function FormatButton({ format, busy, disabled, onClick }) {
  const isExcel = format === 'xlsx'
  return (
    <button
      type="button"
      className={`rh-export-format rh-export-format--${isExcel ? 'excel' : 'csv'}`}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? (
        <span className="rh-export-spinner" aria-hidden="true" />
      ) : (
        <Icon name="download" size={15} />
      )}
      {busy ? 'Préparation…' : isExcel ? 'Excel' : 'CSV'}
    </button>
  )
}

function ExportCard({
  icon,
  tone,
  title,
  description,
  count,
  countLabel,
  children,
}) {
  return (
    <article className={`rh-export-card rh-export-card--${tone}`}>
      <div className="rh-export-card__top">
        <span className="rh-export-card__icon"><Icon name={icon} size={21} /></span>
        <div className="rh-export-card__count">
          <strong>{count}</strong>
          <span>{countLabel}</span>
        </div>
      </div>
      <div className="rh-export-card__copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="rh-export-card__actions">{children}</div>
    </article>
  )
}

export function RhExportsPage() {
  const [filters, setFilters] = useState(defaultFilters)
  const [overview, setOverview] = useState({
    filters: { services: [], employees: [] },
    counts: {
      leaveRequests: 0,
      absenceDeclarations: 0,
      leaveBalances: 0,
      balanceMovements: 0,
      derogations: 0,
    },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [downloading, setDownloading] = useState('')

  const loadOverview = useCallback(async (nextFilters = filters, { silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')

    try {
      const data = await getRhExportsOverview(nextFilters)
      setOverview(data)
    } catch (requestError) {
      const message = requestError.response?.data?.message
      setError(Array.isArray(message) ? message.join(' ') : message || 'Impossible de charger les données d’export.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    const timer = window.setTimeout(() => loadOverview(filters), 180)
    return () => window.clearTimeout(timer)
  }, [filters, loadOverview])

  useEffect(() => {
    const onFocus = () => loadOverview(filters, { silent: true })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [filters, loadOverview])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const employees = useMemo(() => {
    const list = overview.filters?.employees ?? []
    if (!filters.serviceId) return list
    return list.filter((employee) => String(employee.serviceId ?? '') === String(filters.serviceId))
  }, [filters.serviceId, overview.filters?.employees])

  const changeFilter = (name, value) => {
    setFilters((current) => {
      const next = { ...current, [name]: value }
      if (name === 'serviceId') {
        const selectedEmployee = overview.filters?.employees?.find(
          (employee) => String(employee.id) === String(current.employeeId),
        )
        if (selectedEmployee && value && String(selectedEmployee.serviceId ?? '') !== String(value)) {
          next.employeeId = ''
        }
      }
      return next
    })
  }

  const resetFilters = () => setFilters(defaultFilters())

  const handleExport = async (kind, format) => {
    const key = `${kind}:${format}`
    setDownloading(key)
    setFeedback(null)

    try {
      const filename = await downloadRhExport(kind, format, filters)
      setFeedback({ kind: 'success', message: `${filename} téléchargé.` })
    } catch (requestError) {
      let message = requestError.response?.data?.message
      if (requestError.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await requestError.response.data.text())
          message = payload?.message
        } catch {
          message = null
        }
      }
      setFeedback({
        kind: 'error',
        message: Array.isArray(message) ? message.join(' ') : message || 'L’export n’a pas pu être généré.',
      })
    } finally {
      setDownloading('')
    }
  }

  const counts = overview.counts ?? {}
  const invalidPeriod = Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate)

  return (
    <PageContainer className="rh-exports-page">
      {feedback && (
        <div className={`rh-export-feedback rh-export-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="rh-export-filters-card">
        <div className="rh-export-section-heading">
          <span className="rh-export-section-heading__icon"><Icon name="filter" size={19} /></span>
          <div>
            <h2>Critères d’export</h2>
            <p>Définissez le périmètre avant de choisir les données à télécharger.</p>
          </div>
          <button type="button" className="rh-export-reset" onClick={resetFilters}>
            <Icon name="refresh" size={15} /> Réinitialiser
          </button>
        </div>

        <div className="rh-export-filters-grid">
          <label>
            <span>Date de début</span>
            <input
              type="date"
              value={filters.startDate}
              max={filters.endDate || undefined}
              onChange={(event) => changeFilter('startDate', event.target.value)}
            />
          </label>
          <label>
            <span>Date de fin</span>
            <input
              type="date"
              value={filters.endDate}
              min={filters.startDate || undefined}
              onChange={(event) => changeFilter('endDate', event.target.value)}
            />
          </label>
          <label>
            <span>Service</span>
            <select value={filters.serviceId} onChange={(event) => changeFilter('serviceId', event.target.value)}>
              <option value="">Tous les services</option>
              {(overview.filters?.services ?? []).map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Collaborateur</span>
            <select value={filters.employeeId} onChange={(event) => changeFilter('employeeId', event.target.value)}>
              <option value="">Tous les collaborateurs</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.prenom} {employee.nom}{employee.serviceName ? ` — ${employee.serviceName}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rh-export-filter-note">
          <Icon name="info" size={15} />
          <span>La période s’applique aux congés, absences, dérogations et mouvements. Les soldes correspondent à la situation actuelle.</span>
        </div>
        {invalidPeriod && <div className="rh-export-period-error">La date de début doit être antérieure à la date de fin.</div>}
      </section>

      {error ? (
        <section className="rh-export-error-card">
          <Icon name="alert" size={22} />
          <div><strong>Impossible de charger les exports</strong><p>{error}</p></div>
          <button type="button" onClick={() => loadOverview(filters)}>Réessayer</button>
        </section>
      ) : (
        <section className={`rh-export-grid ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
          <ExportCard
            icon="calendar"
            tone="blue"
            title="Demandes de congés"
            description="Demandes soumises sur la période sélectionnée, avec type, durée, statut et décision."
            count={counts.leaveRequests ?? 0}
            countLabel={plural(counts.leaveRequests ?? 0, 'demande', 'demandes').replace(/^\d+\s/, '')}
          >
            <div className="rh-export-format-group">
              <FormatButton format="csv" disabled={invalidPeriod} busy={downloading === 'leaves:csv'} onClick={() => handleExport('leaves', 'csv')} />
              <FormatButton format="xlsx" disabled={invalidPeriod} busy={downloading === 'leaves:xlsx'} onClick={() => handleExport('leaves', 'xlsx')} />
            </div>
          </ExportCard>

          <ExportCard
            icon="file"
            tone="orange"
            title="Absences"
            description="Déclarations d’absence, durées, statuts et informations de vérification RH."
            count={counts.absenceDeclarations ?? 0}
            countLabel={plural(counts.absenceDeclarations ?? 0, 'absence', 'absences').replace(/^\d+\s/, '')}
          >
            <div className="rh-export-format-group">
              <FormatButton format="csv" disabled={invalidPeriod} busy={downloading === 'absences:csv'} onClick={() => handleExport('absences', 'csv')} />
              <FormatButton format="xlsx" disabled={invalidPeriod} busy={downloading === 'absences:xlsx'} onClick={() => handleExport('absences', 'xlsx')} />
            </div>
          </ExportCard>

          <ExportCard
            icon="wallet"
            tone="green"
            title="Soldes collaborateurs"
            description="Situation actuelle des compteurs et historique traçable des mouvements de soldes."
            count={counts.leaveBalances ?? 0}
            countLabel={plural(counts.leaveBalances ?? 0, 'collaborateur', 'collaborateurs').replace(/^\d+\s/, '')}
          >
            <div className="rh-export-split-actions">
              <div>
                <span>Soldes actuels</span>
                <div className="rh-export-format-group">
                  <FormatButton format="csv" disabled={invalidPeriod} busy={downloading === 'balances:csv'} onClick={() => handleExport('balances', 'csv')} />
                  <FormatButton format="xlsx" disabled={invalidPeriod} busy={downloading === 'balances:xlsx'} onClick={() => handleExport('balances', 'xlsx')} />
                </div>
              </div>
              <div>
                <span>{counts.balanceMovements ?? 0} mouvements sur la période</span>
                <div className="rh-export-format-group">
                  <FormatButton format="csv" disabled={invalidPeriod} busy={downloading === 'movements:csv'} onClick={() => handleExport('movements', 'csv')} />
                  <FormatButton format="xlsx" disabled={invalidPeriod} busy={downloading === 'movements:xlsx'} onClick={() => handleExport('movements', 'xlsx')} />
                </div>
              </div>
            </div>
          </ExportCard>

          <ExportCard
            icon="shield"
            tone="violet"
            title="Dérogations"
            description="Demandes de dérogation, motif, statut, décision RH et utilisation éventuelle."
            count={counts.derogations ?? 0}
            countLabel={plural(counts.derogations ?? 0, 'dérogation', 'dérogations').replace(/^\d+\s/, '')}
          >
            <div className="rh-export-format-group">
              <FormatButton format="csv" disabled={invalidPeriod} busy={downloading === 'derogations:csv'} onClick={() => handleExport('derogations', 'csv')} />
              <FormatButton format="xlsx" disabled={invalidPeriod} busy={downloading === 'derogations:xlsx'} onClick={() => handleExport('derogations', 'xlsx')} />
            </div>
          </ExportCard>
        </section>
      )}
    </PageContainer>
  )
}
