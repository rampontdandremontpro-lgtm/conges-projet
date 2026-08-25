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
} from '@/services/rh/rhBalances'
import { formatDays } from '@/utils/format'

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

function initials(employee) {
  return `${employee?.nom?.[0] ?? ''}${employee?.prenom?.[0] ?? ''}`.toUpperCase() || '—'
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

function currentReferencePeriod() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const start = Number(values.month) >= 6 ? year : year - 1
  return `${start}-${start + 1}`
}

function adjacentPeriods() {
  const current = currentReferencePeriod()
  const start = Number(current.slice(0, 4))
  return [
    { value: `${start - 1}-${start}`, label: `N-1 · ${start - 1}/${start}` },
    { value: current, label: `N · ${start}/${start + 1}` },
    { value: `${start + 1}-${start + 2}`, label: `N+1 · ${start + 1}/${start + 2}` },
  ]
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function latestPeriod(balances) {
  return [...new Set((balances ?? []).map((item) => item.referencePeriod).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))[0] ?? null
}

function scopedCurrentBalances(balances) {
  const period = latestPeriod(balances)
  return period ? balances.filter((item) => item.referencePeriod === period) : []
}

function movementChange(movement) {
  const before = Number(movement?.balanceBefore ?? 0)
  const after = Number(movement?.balanceAfter ?? 0)
  return Number.isFinite(before) && Number.isFinite(after) ? after - before : 0
}

function BalanceDetailDrawer({ row, onClose, onChanged }) {
  const [state, setState] = useState({ loading: true, error: false, balances: [], history: [] })
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
      const [balances, history] = await Promise.all([
        getRhEmployeeBalances(row.employee.id),
        getRhEmployeeBalanceHistory(row.employee.id),
      ])
      setState({ loading: false, error: false, balances, history })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [row.employee.id])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const currentBalances = useMemo(() => scopedCurrentBalances(state.balances), [state.balances])
  const correctionCounters = useMemo(
    () => currentBalances.filter((item) => item.counterType === 'N-1' || item.counterType === 'N'),
    [currentBalances],
  )
  const usable = currentBalances.find((item) => item.counterType === 'N-1') ?? null
  const acquisition = currentBalances.find((item) => item.counterType === 'N') ?? null
  const reserved = Number(usable?.reservedDays ?? 0)
  const usableDays = Number(usable?.availableDays ?? 0)
  const availableAfter = Number(usable?.potentialDays ?? usableDays - reserved)

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
            <span className="rh-balances-avatar">{initials(row.employee)}</span>
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
                  <p>Période {formatReferencePeriod(latestPeriod(state.balances))}</p>
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

              <div className="rh-balances-kpis">
                <div><small>Congés à utiliser</small><strong>{formatDays(usableDays)} j</strong><span>N-1</span></div>
                <div><small>En cours d’acquisition</small><strong>{formatBalanceDays(Number(acquisition?.acquiredDays ?? 0))} j</strong><span>N</span></div>
                <div><small>En attente</small><strong>{formatBalanceDays(reserved)} j</strong><span>Demandes en attente</span></div>
                <div className="rh-balances-kpis__available"><small>Disponible</small><strong>{formatBalanceDays(availableAfter)} j</strong><span>Après validation</span></div>
              </div>

              {correctionCounters.length === 0 && (
                <div className="rh-balances-info"><Icon name="info" size={16} /> Aucun compteur N-1 ou N n’est initialisé pour cette période.</div>
              )}

              {showCorrection && correctionCounters.length > 0 && (
                <form className="rh-balances-correction" onSubmit={submitCorrection}>
                  <div className="rh-balances-correction__head">
                    <div>
                      <h4>Nouvelle correction</h4>
                      <p>Chaque correction crée automatiquement un mouvement traçable.</p>
                    </div>
                    <button type="button" onClick={() => setShowCorrection(false)} aria-label="Fermer la correction">×</button>
                  </div>

                  <label>
                    <span>Compteur concerné</span>
                    <select value={counterId} onChange={(event) => setCounterId(event.target.value)}>
                      {correctionCounters.map((balance) => (
                        <option key={balance.id} value={balance.id}>
                          {balance.counterType === 'N-1' ? 'Congés à utiliser (N-1)' : 'En cours d’acquisition (N)'} — {formatReferencePeriod(balance.referencePeriod)}
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
                    <span>Notifier le collaborateur</span>
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
                        <span>{movement.leaveBalance?.counterType ?? '—'}<small>{formatReferencePeriod(movement.leaveBalance?.referencePeriod)}</small></span>
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
      .filter((user) => user?.role !== 'ADMIN' && user?.isActive !== false)
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
                {externalServiceIds.size > 0 && <option value="external">Services externes</option>}
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
                <span>Congés à utiliser</span>
                <span>En attente</span>
                <span>Disponible</span>
                <span>Période</span>
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
                    <span className="rh-balances-avatar">{initials(row.employee)}</span>
                    <span><strong>{fullName(row.employee)}</strong><small>{row.employee.service?.name ?? String(row.employee.role ?? '').replaceAll('_', ' ')}</small></span>
                  </span>
                  <strong>{formatBalanceDays(row.usableDays)} j</strong>
                  <span className={Number(row.reservedDays) > 0 ? 'rh-balances-reserved' : ''}>{formatBalanceDays(row.reservedDays)} j</span>
                  <strong className="rh-balances-available">{formatBalanceDays(row.availableAfterReservations)} j</strong>
                  <span>{row.referencePeriod ? formatReferencePeriod(row.referencePeriod) : 'Non initialisé'}</span>
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

      {selected && <BalanceDetailDrawer row={selected} onClose={() => setSelected(null)} onChanged={handleChanged} />}
    </PageContainer>
  )
}
