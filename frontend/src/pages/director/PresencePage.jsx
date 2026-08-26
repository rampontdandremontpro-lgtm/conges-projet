import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import { ManagerPresenceCalendar } from '@/components/manager/calendar/ManagerPresenceCalendar'
import { Icon } from '@/components/ui/Icon'
import {
  getDirectorGlobalPresenceCalendar,
  getDirectorPresenceServices,
} from '@/services/director/directorDashboard'
import { getDirectorRequest, getDirectorRequestAvailability, validateDirectorRequest } from '@/services/director/directorRequests'
import { getRhRequest, getRhRequestAvailability, validateRhRequest } from '@/services/rh/rhRequests'
import { getCurrentMonthKey, shiftMonthKey } from '@/utils/managerCalendar'

import '@/styles/manager/presence/index.css'
import '@/styles/director/presence.css'

const DIRECTOR_ROLE_OPTIONS = [
  { value: 'all', label: 'Tous les rôles' },
  { value: 'COLLABORATEUR', label: 'Collaborateur' },
  { value: 'RESPONSABLE_SERVICE', label: 'Responsable de service' },
  { value: 'RH', label: 'RH' },
  { value: 'DIRECTEUR', label: 'Directeur' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function uniqueCalendarServices(data) {
  const map = new Map()
  ;(data?.members ?? []).forEach((member) => {
    if (member?.serviceId && member?.serviceName) {
      map.set(String(member.serviceId), member.serviceName)
    }
  })

  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
}

function filteredCalendarData(data, { query, serviceId, role }) {
  if (!data) return null

  const normalizedQuery = normalize(query)
  const visibleMembers = (data.members ?? []).filter((member) => {
    if (serviceId !== 'all' && String(member.serviceId ?? '') !== serviceId) return false
    if (role !== 'all' && member.role !== role) return false

    if (!normalizedQuery) return true

    return normalize([
      member.prenom,
      member.nom,
      member.role,
      member.serviceName,
    ].join(' ')).includes(normalizedQuery)
  })

  const visibleIds = new Set(visibleMembers.map((member) => Number(member.id)))
  const days = (data.days ?? []).map((day) => {
    const members = (day.members ?? []).filter((member) => visibleIds.has(Number(member.id)))

    return {
      ...day,
      members,
      morningPresent: members.filter((member) => member.morningStatus === 'PRESENT').length,
      afternoonPresent: members.filter((member) => member.afternoonStatus === 'PRESENT').length,
    }
  })

  return {
    ...data,
    totalMembers: visibleMembers.length,
    members: visibleMembers,
    days,
  }
}

function requesterRoleLabel(role) {
  return ({
    COLLABORATEUR: 'Collaborateur',
    RESPONSABLE_SERVICE: 'Responsable de service',
    RH: 'RH',
    DIRECTEUR: 'Directeur',
  })[role] ?? 'Collaborateur'
}

function validationCopy(isRhView, request) {
  const requester = requesterRoleLabel(request?.employee?.role)
  if (isRhView) {
    return {
      title: `Valider la demande · ${requester}`,
      subtitle: request?.employee?.role === 'RESPONSABLE_SERVICE'
        ? 'La RH effectue la validation de la demande du Responsable de service.'
        : 'La RH effectue la validation finale de cette demande.',
      confirm: 'Valider la demande',
      success: 'Demande validée par la RH avec succès.',
    }
  }
  return {
    title: `Valider la demande · ${requester}`,
    subtitle: request?.employee?.role === 'RH'
      ? 'Le Directeur est le valideur de cette demande déposée par la RH.'
      : request?.employee?.role === 'RESPONSABLE_SERVICE'
        ? 'Le Directeur traite la demande du Responsable de service.'
        : 'Le Directeur traite cette demande selon le circuit de validation applicable.',
    confirm: 'Signer et valider',
    success: 'Demande validée par le Directeur avec succès.',
  }
}

export function DirectorPresencePage() {
  const { user: authenticatedUser } = useAuth()
  const isRhView = authenticatedUser?.role === 'RH'
  const roleOptions = isRhView
    ? DIRECTOR_ROLE_OPTIONS.filter((option) => ['all', 'COLLABORATEUR', 'RESPONSABLE_SERVICE'].includes(option.value))
    : DIRECTOR_ROLE_OPTIONS
  const [searchParams, setSearchParams] = useSearchParams()
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonthKey())
  const [serviceFilter, setServiceFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, data: null })
  const [servicesState, setServicesState] = useState({ loading: true, data: [] })
  const [calendarDecision, setCalendarDecision] = useState(null)
  const [decisionLoading, setDecisionLoading] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [decisionSubmitting, setDecisionSubmitting] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)

  const loadCalendar = useCallback(async (month) => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getDirectorGlobalPresenceCalendar(month)
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [])

  const loadServices = useCallback(async () => {
    setServicesState((current) => ({ ...current, loading: true }))
    try {
      const services = await getDirectorPresenceServices()
      setServicesState({ loading: false, data: Array.isArray(services) ? services : [] })
    } catch {
      setServicesState({ loading: false, data: [] })
    }
  }, [])

  useEffect(() => {
    loadCalendar(calendarMonth)

    const refresh = () => loadCalendar(calendarMonth)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [calendarMonth, loadCalendar])

  useEffect(() => {
    loadServices()

    const refresh = () => loadServices()
    window.addEventListener('gmes:data-changed', refresh)
    return () => window.removeEventListener('gmes:data-changed', refresh)
  }, [loadServices])

  const query = searchParams.get('q') ?? ''

  const services = useMemo(() => {
    const source = isRhView
      ? uniqueCalendarServices(state.data)
      : servicesState.data.length > 0
        ? servicesState.data
        : uniqueCalendarServices(state.data)

    return source
      .map((service) => ({ id: String(service.id), name: service.name }))
      .filter((service) => service.id && service.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  }, [isRhView, servicesState.data, state.data])

  const calendarData = useMemo(() => filteredCalendarData(state.data, {
    query,
    serviceId: serviceFilter,
    role: roleFilter,
  }), [query, roleFilter, serviceFilter, state.data])

  useEffect(() => {
    if (!actionFeedback) return undefined
    const timer = window.setTimeout(() => setActionFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionFeedback])

  const openCalendarValidation = useCallback(async (requestId) => {
    setDecisionLoading(true)
    setActionFeedback(null)
    try {
      const requestGetter = isRhView ? getRhRequest : getDirectorRequest
      const availabilityGetter = isRhView ? getRhRequestAvailability : getDirectorRequestAvailability
      const [request, availability] = await Promise.all([
        requestGetter(requestId),
        availabilityGetter(requestId),
      ])
      setCalendarDecision({ request, availability, justification: '', rhConfirmedDirectorAgreement: false })
    } catch (error) {
      setActionFeedback({
        error: true,
        text: error?.response?.data?.message ?? 'Cette demande ne peut pas être traitée depuis la présence globale.',
      })
    } finally {
      setDecisionLoading(false)
    }
  }, [isRhView])

  const confirmCalendarValidation = useCallback(async (signatureType, signatureData) => {
    if (!calendarDecision?.request?.id) return
    setDecisionSubmitting(true)
    try {
      const validator = isRhView ? validateRhRequest : validateDirectorRequest
      await validator(calendarDecision.request.id, {
        signatureType,
        signatureData,
        minimumPresenceJustification: calendarDecision.justification?.trim() || undefined,
        ...(isRhView && calendarDecision.request?.finalDeciderId == null
          ? { rhConfirmedDirectorAgreement: calendarDecision.rhConfirmedDirectorAgreement === true }
          : {}),
      })
      const copy = validationCopy(isRhView, calendarDecision.request)
      setSignatureOpen(false)
      setCalendarDecision(null)
      setActionFeedback({ error: false, text: copy.success })
      await loadCalendar(calendarMonth)
      window.dispatchEvent(new CustomEvent('gmes:data-changed'))
    } catch (error) {
      setActionFeedback({
        error: true,
        text: error?.response?.data?.message ?? 'La validation a échoué.',
      })
    } finally {
      setDecisionSubmitting(false)
    }
  }, [calendarDecision, calendarMonth, isRhView, loadCalendar])

  const decisionCopy = calendarDecision ? validationCopy(isRhView, calendarDecision.request) : null
  const rhAgreementRequired = Boolean(isRhView && calendarDecision?.request?.finalDeciderId == null)

  const changeCalendarMonth = (offset, exactMonth) => {
    setCalendarMonth((current) => exactMonth ?? shiftMonthKey(current, offset))
  }

  const filtersAreActive = serviceFilter !== 'all' || roleFilter !== 'all' || Boolean(query.trim())

  const resetFilters = () => {
    setServiceFilter('all')
    setRoleFilter('all')

    if (query.trim()) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('q')
      setSearchParams(nextParams, { replace: true })
    }
  }

  return (
    <div className="manager-presence-page manager-presence-page--calendar director-presence-page">
      {decisionLoading && <div className="manager-calendar-action-feedback">Chargement de la demande…</div>}
      {actionFeedback && !decisionLoading && (
        <div className={`manager-calendar-action-feedback${actionFeedback.error ? ' is-error' : ''}`}>{actionFeedback.text}</div>
      )}
      {state.loading && !state.data ? (
        <div className="manager-calendar-loading">
          <Icon name="calendar" size={24} />
          <span>Chargement de la présence globale…</span>
        </div>
      ) : state.error || !calendarData ? (
        <div className="manager-presence-state manager-presence-state--error">
          <span className="manager-presence-state__icon"><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger la présence globale.</strong>
          <button type="button" onClick={() => loadCalendar(calendarMonth)}>Réessayer</button>
        </div>
      ) : (
        <>
          <div className="director-presence-filters" aria-label="Filtres de la présence globale">
            <label>
              <span>Service</span>
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                disabled={servicesState.loading && services.length === 0}
              >
                <option value="all">Tous les services</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Rôle</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="director-presence-filters__reset"
              disabled={!filtersAreActive}
              onClick={resetFilters}
            >
              <Icon name="refresh" size={15} />
              <span>Réinitialiser</span>
            </button>
          </div>

          <ManagerPresenceCalendar
            key={calendarMonth}
            data={calendarData}
            month={calendarMonth}
            filter="all"
            onMonthChange={changeCalendarMonth}
            currentUserId={authenticatedUser?.id}
            onPendingRequestClick={openCalendarValidation}
          />
        </>
      )}

      {calendarDecision && !signatureOpen && (
        <div className="manager-calendar-decision-backdrop" role="presentation" onMouseDown={() => !decisionSubmitting && setCalendarDecision(null)}>
          <div className="manager-calendar-decision" role="dialog" aria-modal="true" aria-label="Validation depuis la présence globale" onMouseDown={(event) => event.stopPropagation()}>
            <div className="manager-calendar-decision__head">
              <div>
                <strong>{decisionCopy?.title}</strong>
                <small>{decisionCopy?.subtitle}</small>
              </div>
              <button type="button" className="manager-calendar-decision__close" onClick={() => setCalendarDecision(null)} aria-label="Fermer">×</button>
            </div>
            <div className="manager-calendar-decision__summary">
              <div><span>Demandeur</span><strong>{calendarDecision.request?.employee?.nom} {calendarDecision.request?.employee?.prenom}</strong></div>
              <div><span>Rôle</span><strong>{requesterRoleLabel(calendarDecision.request?.employee?.role)}</strong></div>
              <div><span>Type</span><strong>{calendarDecision.request?.leaveType?.name ?? 'Congé'}</strong></div>
              <div><span>Période</span><strong>{calendarDecision.request?.startDate} → {calendarDecision.request?.endDate}</strong></div>
            </div>
            {calendarDecision.availability?.minimumPresenceBreached && (
              <>
                <div className="manager-calendar-decision__warning">Le minimum de présence du service serait dépassé. Une justification est obligatoire pour poursuivre.</div>
                <label className="manager-calendar-decision__field">Justification
                  <textarea value={calendarDecision.justification} onChange={(event) => setCalendarDecision((current) => ({ ...current, justification: event.target.value }))} placeholder="Justifiez cette validation…" />
                </label>
              </>
            )}
            {rhAgreementRequired && (
              <label className="manager-calendar-decision__agreement">
                <input
                  type="checkbox"
                  checked={calendarDecision.rhConfirmedDirectorAgreement === true}
                  onChange={(event) => setCalendarDecision((current) => ({ ...current, rhConfirmedDirectorAgreement: event.target.checked }))}
                />
                <span>Je confirme avoir obtenu l’accord du Directeur pour cette validation.</span>
              </label>
            )}
            <div className="manager-calendar-decision__actions">
              <button type="button" onClick={() => setCalendarDecision(null)}>Annuler</button>
              <button
                type="button"
                className="is-primary"
                disabled={(calendarDecision.availability?.minimumPresenceBreached && !calendarDecision.justification?.trim()) || (rhAgreementRequired && !calendarDecision.rhConfirmedDirectorAgreement)}
                onClick={() => setSignatureOpen(true)}
              >{decisionCopy?.confirm}</button>
            </div>
          </div>
        </div>
      )}

      <SignatureModal
        open={signatureOpen}
        requestLabel={calendarDecision?.request ? `${calendarDecision.request.employee?.nom ?? ''} ${calendarDecision.request.employee?.prenom ?? ''} · ${calendarDecision.request.startDate} au ${calendarDecision.request.endDate}` : ''}
        submitting={decisionSubmitting}
        onClose={() => !decisionSubmitting && setSignatureOpen(false)}
        onConfirm={confirmCalendarValidation}
        title="Signer la validation"
        confirmLabel={decisionCopy?.confirm ?? 'Valider'}
        submittingLabel="Validation…"
        dialogLabel="Signer la validation de la demande"
      />
    </div>
  )
}
