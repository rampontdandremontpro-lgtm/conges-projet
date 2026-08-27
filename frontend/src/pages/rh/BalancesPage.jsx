import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  correctRhBalance,
  getRhBalanceFilterOptions,
  getRhBalancesOverview,
  getRhEmployeeBalanceHistory,
  getRhEmployeeBalances,
  getRhEmployeePeriodSummaries,
  previewRhBalanceImport,
  confirmRhBalanceImport,
} from '@/services/rh/rhBalances'
import {
  adjacentReferencePeriodOptions,
  currentReferencePeriod,
  formatCounterReferencePeriod,
  counterReferencePeriod,
} from '@/utils/referencePeriods'

import '@/styles/rh/balances.css'

const PAGE_SIZE = 8

const MOVEMENT_META = {
  ACQUISITION: { label: 'Acquisition', tone: 'positive' },
  RESERVATION: { label: 'En attente', tone: 'negative' },
  LIBERATION_RESERVATION: { label: 'Libération attente', tone: 'positive' },
  DEDUCTION: { label: 'Déduction', tone: 'negative' },
  CORRECTION_POSITIVE: { label: 'Correction crédit', tone: 'positive' },
  CORRECTION_NEGATIVE: { label: 'Correction débit', tone: 'negative' },
  RECREDIT: { label: 'Recrédit', tone: 'positive' },
  REMISE_A_ZERO: { label: 'Remise à zéro', tone: 'neutral' },
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function fullName(employee) {
  return `${employee?.nom ?? ''} ${employee?.prenom ?? ''}`.trim() || '—'
}


function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatReferencePeriod(value) {
  return String(value ?? '').replace('-', '/') || '—'
}

function formatBalanceDays(value) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value ?? 0))
}

function adjacentPeriods() {
  return adjacentReferencePeriodOptions()
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function movementChange(movement) {
  const before = Number(movement?.balanceBefore ?? 0)
  const after = Number(movement?.balanceAfter ?? 0)
  return Number.isFinite(before) && Number.isFinite(after) ? after - before : 0
}

function BalanceDetailDrawer({ row, onClose, onChanged }) {
  const [state, setState] = useState({ loading: true, error: false, balances: [], summaries: [], history: [] })
  const [showCorrection, setShowCorrection] = useState(false)
  const [counterId, setCounterId] = useState('')
  const [direction, setDirection] = useState('credit')
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [notifyEmployee, setNotifyEmployee] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useAutoDismiss(feedback, setFeedback, { clearValue: '' })

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const [balances, summaries, history] = await Promise.all([
        getRhEmployeeBalances(row.employee.id),
        getRhEmployeePeriodSummaries(row.employee.id),
        getRhEmployeeBalanceHistory(row.employee.id),
      ])
      setState({ loading: false, error: false, balances, summaries, history })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [row.employee.id])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const periodSummary = state.summaries.find((item) => item.referencePeriod === row.referencePeriod) ?? row
  const correctionCounters = useMemo(
    () => state.balances
      .filter((item) => counterReferencePeriod(item.referencePeriod, item.counterType) === row.referencePeriod)
      .sort((a, b) => b.referencePeriod.localeCompare(a.referencePeriod)),
    [row.referencePeriod, state.balances],
  )

  useEffect(() => {
    if (!counterId && correctionCounters[0]) setCounterId(String(correctionCounters[0].id))
  }, [counterId, correctionCounters])

  const submitCorrection = async (event) => {
    event.preventDefault()
    if (busy) return
    const amount = Number(days)
    if (!counterId || !Number.isFinite(amount) || amount <= 0) {
      setFeedback('Indiquez un compteur et un nombre de jours supérieur à zéro.')
      return
    }
    if (reason.trim().length < 3) {
      setFeedback('Le motif de la correction est obligatoire.')
      return
    }

    setBusy(true)
    setFeedback('')
    try {
      const signedDays = direction === 'debit' ? -amount : amount
      await correctRhBalance(Number(counterId), signedDays, reason.trim(), notifyEmployee)
      await load({ silent: true })
      setDays('')
      setReason('')
      setNotifyEmployee(false)
      setShowCorrection(false)
      onChanged(`Correction enregistrée pour ${fullName(row.employee)}.`)
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rh-balances-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="rh-balances-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Solde de ${fullName(row.employee)}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rh-balances-drawer__head">
          <div className="rh-balances-drawer__identity">
            <ProfileAvatar user={row.employee} className="rh-balances-avatar" />
            <div>
              <small>SOLDE COLLABORATEUR</small>
              <h2>{fullName(row.employee)}</h2>
              <p>{row.employee.service?.name ?? String(row.employee.role ?? '').replaceAll('_', ' ')}</p>
            </div>
          </div>
          <button type="button" className="rh-balances-close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        {state.loading ? (
          <div className="rh-balances-drawer__state">Chargement du solde…</div>
        ) : state.error ? (
          <div className="rh-balances-drawer__state rh-balances-drawer__state--error">
            <Icon name="alert" size={22} />
            <strong>Impossible de charger le détail du solde.</strong>
            <button type="button" onClick={() => load()}>Réessayer</button>
          </div>
        ) : (
          <div className="rh-balances-drawer__body">
            <section className="rh-balances-summary-card">
              <div className="rh-balances-summary-card__title">
                <div>
                  <h3>Situation actuelle</h3>
                  <p>Période {formatReferencePeriod(row.referencePeriod)}</p>
                </div>
                <button
                  type="button"
                  className="rh-balances-correction-btn"
                  disabled={correctionCounters.length === 0}
                  onClick={() => setShowCorrection((value) => !value)}
                >
                  <Icon name="plus" size={16} /> Effectuer une correction
                </button>
              </div>

              <div className="rh-balances-kpis rh-balances-kpis--five">
                <div><small>Acquis</small><strong>{formatBalanceDays(periodSummary.acquiredDays)} j</strong><span>Droits acquis</span></div>
                <div><small>Pris</small><strong>{formatBalanceDays(periodSummary.takenDays)} j</strong><span>Congés consommés</span></div>
                <div className={Number(periodSummary.balanceDays) < 0 ? 'rh-balances-kpis__negative' : 'rh-balances-kpis__available'}><small>Solde</small><strong>{formatBalanceDays(periodSummary.balanceDays)} j</strong><span>Acquis − Pris</span></div>
                <div><small>Validées</small><strong>{formatBalanceDays(periodSummary.validatedDays)} j</strong><span>Congés accordés</span></div>
                <div><small>En attente</small><strong>{formatBalanceDays(periodSummary.pendingDays)} j</strong><span>Décision en cours</span></div>
              </div>

              {correctionCounters.length === 0 && (
                <div className="rh-balances-info"><Icon name="info" size={16} /> Aucun compteur N-1 ou N n’est initialisé pour cette période.</div>
              )}

              {showCorrection && correctionCounters.length > 0 && (
                <form className="rh-balances-correction" onSubmit={submitCorrection}>
                  <div className="rh-balances-correction__head">
                    <div>
                      <div className="rh-balances-correction__title-row">
                        <h4>Nouvelle correction</h4>
                        <StatisticInfoButton title="Correction de solde">
                          <p><strong>Crédit :</strong> ajoute des jours au compteur sélectionné.</p>
                          <p><strong>Débit :</strong> retire des jours du compteur sélectionné.</p>
                          <p>Choisissez le compteur correspondant à la période affichée, puis indiquez le nombre de jours. Un débit peut rendre le solde négatif. Le motif est obligatoire.</p>
                          <p>Chaque correction crée un mouvement traçable dans l’historique. Activez <strong>Notifier le collaborateur</strong> si vous souhaitez qu’il reçoive une notification.</p>
                        </StatisticInfoButton>
                      </div>
                    </div>
                    <button type="button" onClick={() => setShowCorrection(false)} aria-label="Fermer la correction">×</button>
                  </div>

                  <label>
                    <span>Compteur concerné</span>
                    <select value={counterId} onChange={(event) => setCounterId(event.target.value)}>
                      {correctionCounters.map((balance) => (
                        <option key={balance.id} value={balance.id}>
                          Période {formatCounterReferencePeriod(balance.referencePeriod, balance.counterType)} · compteur {balance.counterType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="rh-balances-correction__grid">
                    <div>
                      <span className="rh-balances-field-label">Nature</span>
                      <div className="rh-balances-segmented">
                        <button type="button" className={direction === 'credit' ? 'is-active' : ''} onClick={() => setDirection('credit')}>Crédit</button>
                        <button type="button" className={direction === 'debit' ? 'is-active' : ''} onClick={() => setDirection('debit')}>Débit</button>
                      </div>
                    </div>
                    <label>
                      <span>Nombre de jours</span>
                      <input type="number" min="0.01" step="0.01" value={days} onChange={(event) => setDays(event.target.value)} placeholder="Ex. 1,5" />
                    </label>
                  </div>

                  <label>
                    <span>Motif de la correction <b>*</b></span>
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows="3" placeholder="Expliquez précisément la raison de cette correction…" />
                  </label>

                  <label className="rh-balances-notify">
                    <input type="checkbox" checked={notifyEmployee} onChange={(event) => setNotifyEmployee(event.target.checked)} />
                    <span className="rh-balances-notify__switch" aria-hidden="true"><i /></span>
                    <span className="rh-balances-notify__copy">
                      <strong>Notifier le collaborateur</strong>
                      <small>{notifyEmployee ? 'Le collaborateur recevra une notification.' : 'Aucune notification ne sera envoyée.'}</small>
                    </span>
                  </label>

                  {feedback && <div className="rh-balances-correction__error">{feedback}</div>}

                  <div className="rh-balances-correction__actions">
                    <button type="button" onClick={() => setShowCorrection(false)}>Annuler</button>
                    <button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Confirmer la correction'}</button>
                  </div>
                </form>
              )}
            </section>

            <section className="rh-balances-history-card">
              <div className="rh-balances-history-card__title">
                <div>
                  <h3>Historique des mouvements</h3>
                  <p>{state.history.length} mouvement{state.history.length > 1 ? 's' : ''} enregistré{state.history.length > 1 ? 's' : ''}</p>
                </div>
              </div>

              {state.history.length === 0 ? (
                <div className="rh-balances-history-empty">Aucun mouvement enregistré pour ce collaborateur.</div>
              ) : (
                <div className="rh-balances-history-wrap">
                  <div className="rh-balances-history rh-balances-history--head">
                    <span>Date</span><span>Mouvement</span><span>Compteur</span><span>Montant</span><span>Motif</span><span>Effectué par</span>
                  </div>
                  {state.history.map((movement) => {
                    const meta = MOVEMENT_META[movement.movementType] ?? { label: movement.movementType, tone: 'neutral' }
                    const change = movementChange(movement)
                    return (
                      <div className="rh-balances-history rh-balances-history--row" key={movement.id}>
                        <span>{formatDateTime(movement.createdAt)}</span>
                        <span className={`rh-balances-movement rh-balances-movement--${meta.tone}`}>{meta.label}</span>
                        <span>{movement.leaveBalance?.counterType ?? '—'}<small>{formatCounterReferencePeriod(movement.leaveBalance?.referencePeriod, movement.leaveBalance?.counterType)}</small></span>
                        <strong className={change > 0 ? 'is-positive' : change < 0 ? 'is-negative' : ''}>{change > 0 ? '+' : ''}{formatBalanceDays(change)} j</strong>
                        <span title={movement.reason ?? ''}>{movement.reason || '—'}</span>
                        <span>{movement.actor ? fullName(movement.actor) : 'Système'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}

export function RhBalancesPage() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const [state, setState] = useState({ loading: true, error: false, rows: [] })
  const [filterState, setFilterState] = useState({ services: [], users: [] })
  const [serviceFilter, setServiceFilter] = useState('all')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState(currentReferencePeriod())
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(1)
  const [feedback, setFeedback] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importState, setImportState] = useState({ busy: false, rows: [], preview: null, error: '' })

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const rows = await getRhBalancesOverview(periodFilter)
      setState({ loading: false, error: false, rows })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [periodFilter])

  const loadFilters = useCallback(async () => {
    try {
      const options = await getRhBalanceFilterOptions()
      setFilterState({
        services: Array.isArray(options.services) ? options.services : [],
        users: Array.isArray(options.users) ? options.users : [],
      })
    } catch {
      setFilterState({ services: [], users: [] })
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load()
      loadFilters()
    }, 0)
    const refresh = () => {
      load({ silent: true })
      loadFilters()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
    }
  }, [load, loadFilters])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(''), 4500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const externalServiceIds = useMemo(() => new Set(
    filterState.services
      .filter((service) => service?.serviceType === 'EXTERNE' || service?.externalCompanyName)
      .map((service) => String(service.id)),
  ), [filterState.services])

  const services = useMemo(() => (
    filterState.services
      .filter((service) => service?.id && service?.name && service?.serviceType !== 'EXTERNE' && !service?.externalCompanyName)
      .map((service) => ({ id: String(service.id), name: service.name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  ), [filterState.services])

  const employees = useMemo(() => (
    filterState.users
      .filter((user) => user?.role !== 'ADMIN' && user?.role !== 'DIRECTEUR' && user?.isActive !== false)
      .filter((user) => {
        const serviceId = String(user?.service?.id ?? user?.serviceId ?? '')
        if (serviceFilter === 'external') return externalServiceIds.has(serviceId)
        return serviceFilter === 'all' || serviceId === serviceFilter
      })
      .sort((left, right) => (`${left.nom ?? ''} ${left.prenom ?? ''}`).localeCompare(`${right.nom ?? ''} ${right.prenom ?? ''}`, 'fr'))
  ), [externalServiceIds, filterState.users, serviceFilter])

  const filtered = useMemo(() => {
    const needle = normalize(search)
    return state.rows.filter((row) => {
      if (serviceFilter === 'external' && !externalServiceIds.has(String(row.employee?.service?.id ?? ''))) return false
      if (serviceFilter !== 'all' && serviceFilter !== 'external' && String(row.employee?.service?.id ?? '') !== serviceFilter) return false
      if (employeeFilter !== 'all' && String(row.employee?.id ?? '') !== employeeFilter) return false
      if (!needle) return true
      const haystack = normalize([
        row.employee?.prenom,
        row.employee?.nom,
        row.employee?.email,
        row.employee?.service?.name,
        row.referencePeriod,
      ].join(' '))
      return needle.split(/\s+/).every((token) => haystack.includes(token))
    })
  }, [employeeFilter, externalServiceIds, search, serviceFilter, state.rows])

  useEffect(() => setPage(1), [search, serviceFilter, employeeFilter, periodFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleChanged = async (message) => {
    setFeedback(message)
    await load({ silent: true })
  }

  const downloadImportTemplate = () => {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const lines = [
      ['Identifiant', 'NOM', 'Prénom', 'E-mail', 'Acquis', 'Pris', 'Solde'].join(';'),
      ...state.rows.map((row) => [
        row.employee.id,
        escape(row.employee.nom),
        escape(row.employee.prenom),
        escape(row.employee.email),
        String(row.acquiredDays ?? 0).replace('.', ','),
        String(row.takenDays ?? 0).replace('.', ','),
        String(row.balanceDays ?? 0).replace('.', ','),
      ].join(';')),
    ]
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `modele-soldes-${periodFilter}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const parseImportFile = async (file) => {
    if (!file) return
    setImportState({ busy: true, rows: [], preview: null, error: '' })
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '')
      const lines = text.split(/\r?\n/).filter((line) => line.trim())
      if (lines.length < 2) throw new Error('Le fichier ne contient aucune donnée à importer.')
      const splitLine = (line) => {
        const cells = []
        let current = ''
        let quoted = false
        for (let i = 0; i < line.length; i += 1) {
          const char = line[i]
          if (char === '"') {
            if (quoted && line[i + 1] === '"') { current += '"'; i += 1 } else quoted = !quoted
          } else if (char === ';' && !quoted) { cells.push(current); current = '' } else current += char
        }
        cells.push(current)
        return cells.map((cell) => cell.trim())
      }
      const header = splitLine(lines[0]).map((value) => normalize(value))
      const indexOf = (...labels) => header.findIndex((value) => labels.includes(value))
      const idIndex = indexOf('identifiant', 'id')
      const acquiredIndex = indexOf('acquis', 'jours acquis')
      const takenIndex = indexOf('pris', 'jours pris')
      const balanceIndex = indexOf('solde')
      if ([idIndex, acquiredIndex, takenIndex, balanceIndex].some((index) => index < 0)) {
        throw new Error('Format invalide : les colonnes Identifiant, Acquis, Pris et Solde sont obligatoires.')
      }
      const numeric = (value) => Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
      const rows = lines.slice(1).map((line) => {
        const cells = splitLine(line)
        return {
          employeeId: numeric(cells[idIndex]),
          acquiredDays: numeric(cells[acquiredIndex]),
          takenDays: numeric(cells[takenIndex]),
          balanceDays: numeric(cells[balanceIndex]),
        }
      })
      const preview = await previewRhBalanceImport(periodFilter, rows)
      setImportState({ busy: false, rows, preview, error: '' })
    } catch (error) {
      setImportState({ busy: false, rows: [], preview: null, error: errorMessage(error) })
    }
  }

  const confirmImport = async () => {
    if (!importState.preview?.canImport || importState.busy) return
    setImportState((current) => ({ ...current, busy: true, error: '' }))
    try {
      await confirmRhBalanceImport(periodFilter, importState.rows)
      setImportOpen(false)
      setImportState({ busy: false, rows: [], preview: null, error: '' })
      setFeedback(`Import terminé pour la période ${formatReferencePeriod(periodFilter)}.`)
      await load({ silent: true })
    } catch (error) {
      setImportState((current) => ({ ...current, busy: false, error: errorMessage(error) }))
    }
  }

  return (
    <PageContainer className="rh-balances-page">
      {feedback && <div className="rh-balances-flash"><Icon name="check" size={17} /> {feedback}</div>}

      <section className="rh-balances-card">
        <div className="rh-balances-toolbar">
          <div className="rh-balances-filters">
            <label>
              <span>Service</span>
              <select
                value={serviceFilter}
                onChange={(event) => {
                  setServiceFilter(event.target.value)
                  setEmployeeFilter('all')
                }}
              >
                <option value="all">Tous les services</option>
                {services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}
                {externalServiceIds.size > 0 && <option value="external">Mis à disposition</option>}
              </select>
            </label>
            <label>
              <span>Collaborateur</span>
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                <option value="all">Tous les collaborateurs</option>
                {employees.map((user) => (
                  <option value={user.id} key={user.id}>{user.nom} {user.prenom}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Période</span>
              <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
                {adjacentPeriods().map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="rh-balances-reset"
              onClick={() => {
                setServiceFilter('all')
                setEmployeeFilter('all')
                setPeriodFilter(currentReferencePeriod())
                setPage(1)
              }}
            >
              <Icon name="refresh" size={15} /> Réinitialiser
            </button>
          </div>
          <div className="rh-balances-import-actions">
            <button type="button" onClick={downloadImportTemplate}><Icon name="download" size={15} /> Télécharger le modèle</button>
            <button type="button" className="is-primary" onClick={() => { setImportOpen(true); setImportState({ busy: false, rows: [], preview: null, error: '' }) }}><Icon name="upload" size={15} /> Importer</button>
          </div>
        </div>

        {state.loading ? (
          <div className="rh-balances-state">Chargement des soldes…</div>
        ) : state.error ? (
          <div className="rh-balances-state rh-balances-state--error">
            <Icon name="alert" size={23} />
            <strong>Impossible de charger les soldes collaborateurs.</strong>
            <button type="button" onClick={() => load()}>Réessayer</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rh-balances-state">
            <Icon name="wallet" size={26} />
            <strong>Aucun solde à afficher</strong>
            <span>Aucun collaborateur ne correspond aux filtres actuels.</span>
          </div>
        ) : (
          <>
            <div className="rh-balances-table-wrap">
              <div className="rh-balances-row rh-balances-row--head">
                <span>Collaborateur</span>
                <span>Acquis</span>
                <span>Pris</span>
                <span>Solde</span>
                <span>Validées</span>
                <span>En attente</span>
                <span aria-hidden="true" />
              </div>
              {pageRows.map((row) => (
                <button
                  type="button"
                  className="rh-balances-row rh-balances-row--body"
                  key={row.employee.id}
                  onClick={() => setSelected(row)}
                >
                  <span className="rh-balances-person">
                    <ProfileAvatar user={row.employee} className="rh-balances-avatar" />
                    <span><strong>{fullName(row.employee)}</strong><small>{row.employee.service?.name ?? String(row.employee.role ?? '').replaceAll('_', ' ')}</small></span>
                  </span>
                  <strong>{formatBalanceDays(row.acquiredDays)} j</strong>
                  <span>{formatBalanceDays(row.takenDays)} j</span>
                  <strong className={Number(row.balanceDays) < 0 ? 'rh-balances-negative' : 'rh-balances-available'}>{formatBalanceDays(row.balanceDays)} j</strong>
                  <span>{formatBalanceDays(row.validatedDays)} j</span>
                  <span>{formatBalanceDays(row.pendingDays)} j</span>
                  <span className="rh-balances-eye"><Icon name="eye" size={17} /></span>
                </button>
              ))}
            </div>

            <div className="rh-balances-footer">
              <span>{filtered.length} collaborateur{filtered.length > 1 ? 's' : ''}</span>
              <PaginationBar
                page={safePage}
                pageSize={PAGE_SIZE}
                totalItems={filtered.length}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </section>

      {importOpen && (
        <div className="rh-balances-import-backdrop" role="presentation" onMouseDown={() => !importState.busy && setImportOpen(false)}>
          <section className="rh-balances-import-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>Importer les soldes</h2><p>Période sélectionnée : <strong>{formatReferencePeriod(periodFilter)}</strong></p></div><button type="button" onClick={() => setImportOpen(false)} disabled={importState.busy}>×</button></header>
            <div className="rh-balances-import-body">
              <p>Utilisez le modèle CSV. Le solde doit respecter <strong>Acquis − Pris</strong> et peut être négatif.</p>
              <label className="rh-balances-import-file">
                <Icon name="upload" size={20} />
                <span>Choisir le fichier CSV</span>
                <input type="file" accept=".csv,text/csv" onChange={(event) => parseImportFile(event.target.files?.[0])} disabled={importState.busy} />
              </label>
              {importState.busy && <div className="rh-balances-import-status">Contrôle du fichier…</div>}
              {importState.error && <div className="rh-balances-import-error"><Icon name="alert" size={16} /> {importState.error}</div>}
              {importState.preview && (
                <>
                  <div className="rh-balances-import-summary"><strong>{importState.preview.validCount} ligne(s) valide(s)</strong><span>{importState.preview.errorCount} erreur(s)</span></div>
                  <div className="rh-balances-import-preview">
                    <div className="is-head"><span>Collaborateur</span><span>Acquis</span><span>Pris</span><span>Solde</span><span>Contrôle</span></div>
                    {importState.preview.rows.map((item) => (
                      <div key={`${item.line}-${item.employeeId}`} className={!item.valid ? 'is-error' : ''}>
                        <span>{item.employee ? `${item.employee.nom} ${item.employee.prenom}` : `Ligne ${item.line}`}</span>
                        <span>{formatBalanceDays(item.acquiredDays)}</span><span>{formatBalanceDays(item.takenDays)}</span><span>{formatBalanceDays(item.balanceDays)}</span>
                        <span>{item.valid ? 'OK' : item.error}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <footer><button type="button" onClick={() => setImportOpen(false)} disabled={importState.busy}>Annuler</button><button type="button" className="is-primary" onClick={confirmImport} disabled={!importState.preview?.canImport || importState.busy}>{importState.busy ? 'Import…' : 'Confirmer l’import'}</button></footer>
          </section>
        </div>
      )}
      {selected && <BalanceDetailDrawer row={selected} onClose={() => setSelected(null)} onChanged={handleChanged} />}
    </PageContainer>
  )
}
