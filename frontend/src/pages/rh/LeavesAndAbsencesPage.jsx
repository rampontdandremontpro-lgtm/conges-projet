import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import { DetailDrawer } from '@/pages/rh/AbsencesPage'
import { RhLeaveAbsenceDeclarationDrawer } from '@/components/rh/RhLeaveAbsenceDeclarationDrawer'
import {
  cancelRhAbsence,
  deleteRhAbsenceDraft,
  registerRhAbsence,
} from '@/services/rh/rhAbsences'
import { getRhLeavesAndAbsencesData } from '@/services/rh/rhLeavesAndAbsences'
import { formatDateNumericFR, formatDays } from '@/utils/format'
import { normalizeRhEventSearch, normalizeRhLeaveAndAbsenceRows } from '@/utils/rhLeavesAndAbsences'
import { buildGroupedServiceOptions, isExternalService, isReservedDirectorLeaveType, matchesGroupedServiceFilter } from '@/utils/filterOptions'

import '@/styles/rh/leaves-and-absences.css'

const PAGE_SIZE = 8

function fullName(user) {
  return `${user?.nom ?? ''} ${user?.prenom ?? ''}`.trim() || '—'
}

function formatEventDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date)
}

export function RhLeavesAndAbsencesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const globalSearch = searchParams.get('q') ?? ''
  const [state, setState] = useState({ loading: true, error: false, leaves: [], absences: [], employees: [], absenceTypes: [], leaveTypes: [], services: [] })
  const [filters, setFilters] = useState({ nature: 'ALL', status: 'ALL', type: 'ALL', employee: 'ALL', service: 'ALL' })
  const [page, setPage] = useState(1)
  const [declarationOpen, setDeclarationOpen] = useState(false)
  const [selectedAbsence, setSelectedAbsence] = useState(null)
  const [editingAbsence, setEditingAbsence] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getRhLeavesAndAbsencesData()
      setState({ loading: false, error: false, ...data })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    load()
    const refresh = () => load({ silent: true })
    window.addEventListener('gmes:data-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('gmes:data-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  useEffect(() => setPage(1), [filters, globalSearch])
  useEffect(() => {
    const flash = location.state?.flash
    if (!flash?.message) return
    setFeedback({ kind: flash.kind === 'error' ? 'error' : 'success', message: flash.message })
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const rows = useMemo(() => normalizeRhLeaveAndAbsenceRows({
    leaves: state.leaves.filter((item) => item.employee?.role !== 'DIRECTEUR'),
    absences: state.absences.filter((item) => item.status !== 'BROUILLON' || item.createdBy?.role === 'RH'),
  }), [state.absences, state.leaves])

  const statusOptions = useMemo(() => {
    const values = new Map()
    rows.filter((row) => filters.nature === 'ALL' || row.nature === filters.nature)
      .forEach((row) => values.set(row.status, row.statusLabel))
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [filters.nature, rows])

  const typeOptions = useMemo(() => {
    const values = new Map()

    if (filters.nature === 'ALL' || filters.nature === 'CONGE') {
      state.leaveTypes
        .filter((type) => type?.isActive !== false && type?.id && type?.name && !isReservedDirectorLeaveType(type))
        .forEach((type) => values.set(`CONGE:${type.id}`, type.name))
    }

    if (filters.nature === 'ALL' || filters.nature === 'ABSENCE') {
      state.absenceTypes
        .filter((type) => type?.isActive !== false && type?.id && type?.name)
        .forEach((type) => values.set(`ABSENCE:${type.id}`, type.name))
    }

    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [filters.nature, state.absenceTypes, state.leaveTypes])

  const employeeOptions = useMemo(() => {
    const values = new Map()
    rows.forEach((row) => { if (row.employee?.id) values.set(String(row.employee.id), fullName(row.employee)) })
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [rows])

  const serviceRecords = useMemo(() => {
    const values = new Map()
    state.services.forEach((service) => {
      if (service?.id && service?.name) values.set(String(service.id), service)
    })
    state.employees.forEach((employee) => {
      if (employee.service?.id && employee.service?.name && !values.has(String(employee.service.id))) {
        values.set(String(employee.service.id), employee.service)
      }
    })
    rows.forEach((row) => {
      if (row.service?.id && row.service?.name && !values.has(String(row.service.id))) values.set(String(row.service.id), row.service)
    })
    return [...values.values()]
  }, [rows, state.employees, state.services])

  const serviceOptions = useMemo(() => buildGroupedServiceOptions(serviceRecords), [serviceRecords])
  const externalServiceIds = useMemo(() => new Set(
    serviceRecords.filter(isExternalService).map((service) => String(service.id)),
  ), [serviceRecords])

  const filtered = useMemo(() => {
    const query = normalizeRhEventSearch(globalSearch)
    return rows.filter((row) => {
      if (filters.nature !== 'ALL' && row.nature !== filters.nature) return false
      if (filters.status !== 'ALL' && row.status !== filters.status) return false
      if (filters.type !== 'ALL' && `${row.nature}:${row.type?.id ?? ''}` !== filters.type) return false
      if (filters.employee !== 'ALL' && String(row.employee?.id ?? '') !== filters.employee) return false
      if (!matchesGroupedServiceFilter(row.service?.id, filters.service, externalServiceIds)) return false
      if (!query) return true
      const haystack = normalizeRhEventSearch([
        row.id, row.natureLabel, fullName(row.employee), row.employee?.email, row.type?.name,
        row.service?.name, row.startDate, row.endDate, row.statusLabel,
      ].join(' '))
      return query.split(/\s+/).every((token) => haystack.includes(token))
    }).sort((a, b) => {
      const start = String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''))
      if (start !== 0) return start
      return String(b.eventDate ?? '').localeCompare(String(a.eventDate ?? ''))
    })
  }, [externalServiceIds, filters, globalSearch, rows])

  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const resetDependentFilters = (nature) => setFilters((current) => ({ ...current, nature, status: 'ALL', type: 'ALL' }))
  const showFeedback = (kind, message) => setFeedback({ kind, message })

  const handleDeclarationSaved = async (message) => {
    setDeclarationOpen(false)
    showFeedback('success', message)
    await load()
  }

  const handleRegister = async (declaration) => {
    if (busy) return
    setBusy(true)
    try {
      await registerRhAbsence(declaration.id)
      setSelectedAbsence(null)
      showFeedback('success', `L’absence de ${fullName(declaration.employee)} a été autorisée.`)
      await load()
    } catch (error) {
      showFeedback('error', error?.response?.data?.message || 'Impossible d’autoriser cette absence.')
    } finally { setBusy(false) }
  }

  const handleCancel = async (declaration) => {
    if (busy || !window.confirm(`Annuler l’absence de ${fullName(declaration.employee)} ?`)) return
    setBusy(true)
    try {
      await cancelRhAbsence(declaration.id)
      setSelectedAbsence(null)
      showFeedback('success', 'L’absence a été annulée.')
      await load()
    } catch (error) {
      showFeedback('error', error?.response?.data?.message || 'Impossible d’annuler cette absence.')
    } finally { setBusy(false) }
  }

  const handleDeleteDraft = async (declaration) => {
    if (busy || !window.confirm('Supprimer définitivement ce brouillon RH ?')) return
    setBusy(true)
    try {
      await deleteRhAbsenceDraft(declaration.id)
      setSelectedAbsence(null)
      showFeedback('success', 'Le brouillon RH a été supprimé.')
      await load()
    } catch (error) {
      showFeedback('error', error?.response?.data?.message || 'Impossible de supprimer ce brouillon.')
    } finally { setBusy(false) }
  }

  return (
    <PageContainer className="rh-events-page">
      {feedback && <div className={`rh-events-feedback rh-events-feedback--${feedback.kind}`}><Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />{feedback.message}</div>}

      <div className="rh-events-actions">
        <button type="button" className="rh-events-create" onClick={() => setDeclarationOpen(true)}><Icon name="plus" size={17} /> Déclarer congé/absence</button>
      </div>

      <section className="rh-events-filters" aria-label="Filtres congés et absences">
        <label><span>CATÉGORIE</span><select value={filters.nature} onChange={(event) => resetDependentFilters(event.target.value)}><option value="ALL">Tous</option><option value="CONGE">Congés</option><option value="ABSENCE">Absences</option></select></label>
        <label><span>STATUT</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="ALL">Tous les statuts</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>TYPE</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="ALL">Tous les types</option>{typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>COLLABORATEUR</span><select value={filters.employee} onChange={(event) => setFilters((current) => ({ ...current, employee: event.target.value }))}><option value="ALL">Tous les collaborateurs</option>{employeeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>SERVICE</span><select value={filters.service} onChange={(event) => setFilters((current) => ({ ...current, service: event.target.value }))}><option value="ALL">Tous les services</option>{serviceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </section>

      <section className="rh-events-card">
        {state.loading ? <div className="rh-events-state">Chargement…</div> : state.error ? <div className="rh-events-state is-error"><Icon name="alert" size={22} /> Impossible de charger les données.<button type="button" onClick={() => load()}>Réessayer</button></div> : (
          <>
            <div className="rh-events-table-wrap">
              <div className="rh-events-table">
                <div className="rh-events-row rh-events-row--head"><span>Collaborateur</span><span>Catégorie</span><span>Type</span><span>Début</span><span>Fin</span><span>Durée</span><span>Statut</span><span>Déclaré</span><span /></div>
                {visible.length === 0 ? <div className="rh-events-empty">Aucun congé ou absence ne correspond aux filtres.</div> : visible.map((row) => (
                  <button key={row.key} type="button" className="rh-events-row rh-events-row--data" onClick={() => row.nature === 'CONGE' ? navigate(`/app/rh-all-requests/${row.id}`) : setSelectedAbsence(row.source)}>
                    <span className="rh-events-person"><ProfileAvatar user={row.employee} className="rh-events-avatar" /><span><strong>{fullName(row.employee)}</strong><small>{row.service?.name ?? 'Service non renseigné'}</small></span></span>
                    <span><b className={`rh-events-nature rh-events-nature--${row.nature.toLowerCase()}`}>{row.natureLabel}</b></span>
                    <span className="rh-events-type"><span>{row.type?.name ?? '—'}</span>{row.nature === 'CONGE' && row.source?.isAnticipatedLeave && <b className="rh-events-anticipated">Congé anticipé</b>}</span>
                    <span>{formatDateNumericFR(row.startDate)}</span>
                    <span>{formatDateNumericFR(row.endDate)}</span>
                    <span>{row.duration == null ? '—' : `${formatDays(row.duration)} ${row.durationUnit}`}</span>
                    <span><b className={`rh-events-status rh-events-status--${row.statusTone}`}>{row.statusLabel}</b></span>
                    <span>{formatEventDate(row.eventDate)}</span>
                    <span className="rh-events-eye"><Icon name="eye" size={17} /></span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rh-events-footer"><span>{filtered.length} élément{filtered.length > 1 ? 's' : ''}</span><PaginationBar page={safePage} pageSize={PAGE_SIZE} totalItems={filtered.length} onPageChange={setPage} /></div>
          </>
        )}
      </section>

      {declarationOpen && (
        <RhLeaveAbsenceDeclarationDrawer
          employees={state.employees}
          leaveTypes={state.leaveTypes}
          absenceTypes={state.absenceTypes}
          onClose={() => setDeclarationOpen(false)}
          onSaved={handleDeclarationSaved}
        />
      )}
      {selectedAbsence && !editingAbsence && <DetailDrawer declaration={selectedAbsence} busy={busy} onClose={() => setSelectedAbsence(null)} onRegister={handleRegister} onCancel={handleCancel} onDeleteDraft={handleDeleteDraft} onEdit={(decl) => { setSelectedAbsence(null); setEditingAbsence(decl) }} onDeclarationChanged={async (declaration) => { setSelectedAbsence(declaration); await load({ silent: true }) }} onFeedback={showFeedback} />}
      {editingAbsence && (
        <RhLeaveAbsenceDeclarationDrawer
          employees={state.employees}
          leaveTypes={state.leaveTypes}
          absenceTypes={state.absenceTypes}
          editingDeclaration={editingAbsence}
          onClose={() => setEditingAbsence(null)}
          onSaved={async (message) => { setEditingAbsence(null); setSelectedAbsence(null); showFeedback('success', message); await load() }}
        />
      )}
    </PageContainer>
  )
}
