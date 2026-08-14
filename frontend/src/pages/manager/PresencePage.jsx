import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ManagerPresenceMemberCard } from '@/components/manager/presence/ManagerPresenceMemberCard'
import { Icon } from '@/components/ui/Icon'
import { getManagerServicePresence } from '@/services/managerDashboard'

import '@/styles/manager-presence.css'

const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'PRESENT', label: 'Présents' },
  { id: 'EN_VACANCES', label: 'En vacances' },
  { id: 'ABSENT', label: 'Absents' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function formatDateFR(value) {
  if (!value) return 'Aujourd’hui'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function countSlotPresent(members, slotName) {
  return members.filter((member) => member.dailyAvailability?.[slotName]?.status === 'PRESENT').length
}

function LoadingState() {
  return (
    <div className="manager-presence-members" aria-label="Chargement de la présence du service">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="manager-presence-member-skeleton" key={index} aria-hidden="true">
          <span className="manager-presence-member-skeleton__avatar" />
          <span className="manager-presence-member-skeleton__body">
            <span className="manager-presence-member-skeleton__line manager-presence-member-skeleton__line--title" />
            <span className="manager-presence-member-skeleton__line" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ManagerPresencePage() {
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, data: null })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getManagerServicePresence()
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = () => load()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('gmes:data-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gmes:data-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load])

  const members = state.data?.members ?? []
  const summary = state.data?.summary ?? { total: 0, present: 0, onLeave: 0, absent: 0 }
  const service = state.data?.service
  const threshold = service?.hasMinimumPresenceRule ? service.minimumPresence : null
  const thresholdOk = threshold == null || summary.present >= threshold
  const margin = threshold == null ? null : summary.present - threshold
  const query = searchParams.get('q') ?? ''

  const counts = useMemo(() => ({
    all: members.length,
    PRESENT: members.filter((member) => member.presenceStatus === 'PRESENT').length,
    EN_VACANCES: members.filter((member) => member.presenceStatus === 'EN_VACANCES').length,
    ABSENT: members.filter((member) => member.presenceStatus === 'ABSENT').length,
  }), [members])

  const visibleMembers = useMemo(() => {
    const normalizedQuery = normalize(query)

    return members.filter((member) => {
      if (filter !== 'all' && member.presenceStatus !== filter) return false
      if (!normalizedQuery) return true

      const searchable = normalize([
        member.prenom,
        member.nom,
        member.role,
        member.presenceStatus,
        service?.name,
      ].join(' '))

      return normalizedQuery.split(/\s+/).every((token) => searchable.includes(token))
    })
  }, [filter, members, query, service?.name])

  const morningPresent = countSlotPresent(members, 'morning')
  const afternoonPresent = countSlotPresent(members, 'afternoon')
  const total = summary.total ?? members.length
  const percentage = total > 0 ? Math.round(((summary.present ?? 0) / total) * 100) : 0

  return (
    <div className="manager-presence-page">
      {state.loading && !state.data ? (
        <>
          <div className="manager-presence-summary-skeleton" aria-hidden="true" />
          <LoadingState />
        </>
      ) : state.error && !state.data ? (
        <div className="manager-presence-state manager-presence-state--error">
          <span className="manager-presence-state__icon"><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger la présence du service.</strong>
          <span>Vérifiez la connexion au backend puis réessayez.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : (
        <>
          <section className="manager-presence-summary-card">
            <div className="manager-presence-summary-card__header">
              <div>
                <span className="manager-presence-eyebrow">Présence aujourd’hui</span>
                <strong>{service?.name ?? 'Votre service'}</strong>
                <small>{formatDateFR(state.data?.date)}</small>
              </div>
              <span className={`manager-presence-threshold-badge ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
                {threshold == null ? 'Aucun seuil configuré' : thresholdOk ? 'Seuil respecté' : 'Seuil non respecté'}
              </span>
            </div>

            <div className="manager-presence-summary-card__main">
              <div className="manager-presence-summary-card__hero">
                <strong>{percentage}%</strong>
                <span><b>{summary.present ?? 0}</b> présent{(summary.present ?? 0) > 1 ? 's' : ''} sur {total}</span>
              </div>

              <div className="manager-presence-summary-card__metrics">
                <div className="is-present"><span>Présents</span><strong>{summary.present ?? 0}</strong></div>
                <div className="is-leave"><span>En vacances</span><strong>{summary.onLeave ?? 0}</strong></div>
                <div className="is-absent"><span>Absents</span><strong>{summary.absent ?? 0}</strong></div>
                <div className="is-threshold"><span>Minimum requis</span><strong>{threshold ?? '—'}</strong></div>
              </div>
            </div>

            <div className="manager-presence-summary-card__progress" aria-hidden="true">
              <span style={{ width: `${Math.min(percentage, 100)}%` }} />
            </div>

            {threshold != null && (
              <div className={`manager-presence-threshold-note ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
                <Icon name={thresholdOk ? 'check' : 'alert'} size={16} />
                <span>
                  {thresholdOk
                    ? `La présence minimale est respectée${margin > 0 ? ` avec une marge de ${margin} personne${margin > 1 ? 's' : ''}` : ''}.`
                    : `Il manque ${Math.abs(margin)} personne${Math.abs(margin) > 1 ? 's' : ''} pour respecter le seuil minimum du service.`}
                </span>
              </div>
            )}
          </section>

          <section className="manager-presence-day-card">
            <div className="manager-presence-day-card__header">
              <span className="manager-presence-day-card__icon"><Icon name="clock" size={18} /></span>
              <div>
                <strong>Couverture de la journée</strong>
                <small>Les demi-journées sont prises en compte automatiquement.</small>
              </div>
            </div>
            <div className="manager-presence-day-card__slots">
              <div className={state.data?.currentPeriod === 'MATIN' ? 'is-current' : ''}>
                <span>Matin</span>
                <strong>{morningPresent} / {total}</strong>
                <small>{threshold == null ? 'présents' : `minimum ${threshold}`}</small>
              </div>
              <div className={state.data?.currentPeriod === 'APRES_MIDI' ? 'is-current' : ''}>
                <span>Après-midi</span>
                <strong>{afternoonPresent} / {total}</strong>
                <small>{threshold == null ? 'présents' : `minimum ${threshold}`}</small>
              </div>
            </div>
          </section>

          <div className="manager-presence-toolbar">
            <div className="manager-presence-filters" role="tablist" aria-label="Filtres de présence">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  className={`manager-presence-filter${filter === item.id ? ' is-active' : ''}`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span>{counts[item.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="manager-presence-toolbar__label">
              <Icon name="users" size={16} />
              <span>{visibleMembers.length} membre{visibleMembers.length > 1 ? 's' : ''} affiché{visibleMembers.length > 1 ? 's' : ''}</span>
            </div>
          </div>

          {visibleMembers.length === 0 ? (
            <div className="manager-presence-state">
              <span className="manager-presence-state__icon"><Icon name="users" size={25} /></span>
              <strong>{query ? 'Aucun membre ne correspond à votre recherche.' : 'Aucun membre dans cette catégorie.'}</strong>
            </div>
          ) : (
            <div className="manager-presence-members">
              {visibleMembers.map((member) => (
                <ManagerPresenceMemberCard
                  key={member.id}
                  member={member}
                  currentPeriod={state.data?.currentPeriod}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
