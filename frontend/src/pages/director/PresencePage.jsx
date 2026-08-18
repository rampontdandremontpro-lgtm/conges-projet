import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ManagerPresenceCalendar } from '@/components/manager/calendar/ManagerPresenceCalendar'
import { Icon } from '@/components/ui/Icon'
import {
  getDirectorGlobalPresenceCalendar,
  getDirectorPresenceServices,
} from '@/services/directorDashboard'
import { getCurrentMonthKey, shiftMonthKey } from '@/utils/managerCalendar'

import '@/styles/manager/presence/index.css'
import '@/styles/director/presence.css'

const ROLE_OPTIONS = [
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

export function DirectorPresencePage() {
  const [searchParams] = useSearchParams()
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonthKey())
  const [serviceFilter, setServiceFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, data: null })
  const [servicesState, setServicesState] = useState({ loading: true, data: [] })

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
    const source = servicesState.data.length > 0
      ? servicesState.data
      : uniqueCalendarServices(state.data)

    return source
      .map((service) => ({ id: String(service.id), name: service.name }))
      .filter((service) => service.id && service.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  }, [servicesState.data, state.data])

  const calendarData = useMemo(() => filteredCalendarData(state.data, {
    query,
    serviceId: serviceFilter,
    role: roleFilter,
  }), [query, roleFilter, serviceFilter, state.data])

  const changeCalendarMonth = (offset, exactMonth) => {
    setCalendarMonth((current) => exactMonth ?? shiftMonthKey(current, offset))
  }

  return (
    <div className="manager-presence-page manager-presence-page--calendar director-presence-page">
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
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
          </div>

          <ManagerPresenceCalendar
            key={calendarMonth}
            data={calendarData}
            month={calendarMonth}
            filter="all"
            onMonthChange={changeCalendarMonth}
          />
        </>
      )}
    </div>
  )
}
