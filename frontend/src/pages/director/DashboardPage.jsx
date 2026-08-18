import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { getDirectorDashboardData } from '@/services/directorDashboard'

import '@/styles/collab/dashboard/index.css'
import '@/styles/director/dashboard.css'

const INITIAL_STATE = {
  loading: true,
  error: false,
  data: null,
}

const ROLE_LABELS = {
  RH: 'RH',
  RESPONSABLE_SERVICE: 'Responsable de service',
  COLLABORATEUR: 'Collaborateur',
}

function formatDateTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatPeriod(request) {
  if (!request?.startDate || !request?.endDate) return ''
  return `${request.startDate} → ${request.endDate}`
}

function initials(user) {
  return `${user?.prenom?.[0] ?? ''}${user?.nom?.[0] ?? ''}`.toUpperCase() || '?'
}

function DecisionsCard({ decisions, onNavigate }) {
  const total = decisions?.total ?? 0

  return (
    <section className="dash-card director-decisions-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Décisions à prendre</h2>
          <span className="dash-card__period">Votre file de décision</span>
        </div>
        <span className={`director-status-badge ${total > 0 ? 'is-warning' : 'is-ok'}`}>
          {total > 0 ? 'Action requise' : 'À jour'}
        </span>
      </header>

      <div className="director-decisions-hero">
        <strong>{total}</strong>
        <span>{total > 1 ? 'demandes à traiter' : 'demande à traiter'}</span>
      </div>

      <div className="director-decision-metrics">
        <div className="director-decision-metric director-decision-metric--blue">
          <span>Responsables</span>
          <strong>{decisions?.responsible ?? 0}</strong>
        </div>
        <div className="director-decision-metric director-decision-metric--cyan">
          <span>RH</span>
          <strong>{decisions?.rh ?? 0}</strong>
        </div>
        <div className="director-decision-metric director-decision-metric--orange">
          <span>Autres</span>
          <strong>{decisions?.others ?? 0}</strong>
        </div>
      </div>

      <button type="button" className="director-primary-action" onClick={() => onNavigate('/app/director-requests')}>
        <Icon name="list" size={17} />
        <span>Voir les demandes à traiter</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}

function GlobalPresenceCard({ presence, onNavigate }) {
  const summary = presence?.summary ?? {}
  const percentage = summary.percentage ?? 100
  const stable = (summary.servicesBelowMinimum ?? 0) === 0

  return (
    <section className="dash-card director-presence-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Présence globale aujourd&apos;hui</h2>
          <span className="dash-card__period">Vue de toute l&apos;organisation</span>
        </div>
        <span className={`director-status-badge ${stable ? 'is-ok' : 'is-warning'}`}>
          {stable ? 'Situation stable' : 'À surveiller'}
        </span>
      </header>

      <div className="director-presence-hero">
        <strong>{percentage}%</strong>
      </div>

      <div className="director-presence-progress" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
      </div>

      <div className="director-presence-metrics">
        <div>
          <span>Présents</span>
          <strong>{summary.present ?? 0}</strong>
        </div>
        <div>
          <span>En congés</span>
          <strong>{summary.onLeave ?? 0}</strong>
        </div>
        <div>
          <span>Absents</span>
          <strong>{summary.absent ?? 0}</strong>
        </div>
      </div>

      <button type="button" className="director-primary-action" onClick={() => onNavigate('/app/director-presence')}>
        <Icon name="users" size={17} />
        <span>Voir la présence globale</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}

function PrioritiesCard({ requests, onNavigate }) {
  const list = Array.isArray(requests) ? requests : []

  return (
    <section className="dash-card director-priorities-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title dash-card__title--lg">Demandes prioritaires</h2>
        <button type="button" className="dash-card__view-all" onClick={() => onNavigate('/app/director-requests')}>
          Voir tout <Icon name="arrowRight" size={14} />
        </button>
      </header>

      {list.length === 0 ? (
        <div className="director-empty">
          <span><Icon name="check" size={21} /></span>
          <strong>Aucune demande prioritaire</strong>
          <small>Les demandes relevant de votre décision apparaîtront ici.</small>
        </div>
      ) : (
        <div className="director-priority-list">
          {list.map((request) => (
            <button
              type="button"
              className="director-priority-row"
              key={request.id}
              onClick={() => onNavigate('/app/director-requests')}
            >
              <span className="director-priority-avatar">{initials(request.employee)}</span>
              <span className="director-priority-main">
                <span className="director-priority-top">
                  <strong>{`${request.employee?.prenom ?? ''} ${request.employee?.nom ?? ''}`.trim() || 'Collaborateur'}</strong>
                  <em>{ROLE_LABELS[request.employee?.role] ?? 'Collaborateur'}</em>
                </span>
                <span>{request.leaveType?.name ?? 'Demande de congé'}</span>
                <small>{request.service?.name ?? 'Service'} · {formatPeriod(request)}</small>
              </span>
              <span className="director-priority-date">
                {formatDateTime(request.submittedAt ?? request.createdAt)}
              </span>
              <Icon name="chevronRight" size={17} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function ServicesCard({ presence, onNavigate }) {
  const services = Array.isArray(presence?.services)
    ? presence.services.slice(0, 4)
    : []

  return (
    <section className="dash-card director-services-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title dash-card__title--lg">Services aujourd&apos;hui</h2>
          <span className="dash-card__period">{services.length} service{services.length > 1 ? 's' : ''} affiché{services.length > 1 ? 's' : ''}</span>
        </div>
        <button type="button" className="dash-card__view-all" onClick={() => onNavigate('/app/director-presence')}>
          Voir tout <Icon name="arrowRight" size={14} />
        </button>
      </header>

      {services.length === 0 ? (
        <div className="director-empty director-empty--compact">
          <strong>Aucune donnée de présence</strong>
          <small>Les services actifs apparaîtront ici.</small>
        </div>
      ) : (
        <div className="director-services-list">
          {services.map((service) => (
            <button type="button" key={service.id ?? service.name} className="director-service-row" onClick={() => onNavigate('/app/director-presence')}>
              <span className="director-service-main">
                <strong>{service.name}</strong>
                <small>
                  {service.onLeave > 0 ? `${service.onLeave} en congé` : 'Aucun congé'}
                  {service.absent > 0 ? ` · ${service.absent} absent${service.absent > 1 ? 's' : ''}` : ''}
                </small>
              </span>
              <span className="director-service-count">{service.present}/{service.total}</span>
              <span className={`director-service-state ${service.minimumRespected ? 'is-ok' : 'is-danger'}`}>
                {service.minimumRespected ? 'OK' : 'Sous seuil'}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function AttentionCard({ items, onNavigate }) {
  const list = Array.isArray(items) ? items : []

  return (
    <section className="dash-card director-attention-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Points d&apos;attention</h2>
      </header>

      {list.length === 0 ? (
        <div className="director-attention-ok">
          <Icon name="check" size={17} />
          <span>Aucun point critique aujourd&apos;hui.</span>
        </div>
      ) : (
        <div className="director-attention-list">
          {list.map((item) => (
            <button type="button" key={item.id} className={`director-attention-item director-attention-item--${item.tone}`} onClick={() => onNavigate(item.to)}>
              <Icon name="alert" size={16} />
              <span>{item.text}</span>
              <Icon name="chevronRight" size={15} />
            </button>
          ))}
        </div>
      )}

      <button type="button" className="director-availability-action" onClick={() => onNavigate('/app/director-availability')}>
        <Icon name="calendar" size={16} />
        Enregistrer mon indisponibilité
      </button>
    </section>
  )
}

export function DashboardDirecteur() {
  const navigate = useNavigate()
  const [state, setState] = useState(INITIAL_STATE)

  const load = useCallback(async () => {
    try {
      const data = await getDirectorDashboardData()
      setState({ loading: false, error: false, data })
    } catch {
      setState({ loading: false, error: true, data: null })
    }
  }, [])

  useEffect(() => {
    load()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    window.addEventListener('focus', load)
    window.addEventListener('gmes:data-changed', load)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', load)
      window.removeEventListener('gmes:data-changed', load)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load])

  if (state.loading) {
    return (
      <PageContainer className="director-dashboard-page">
        <div className="director-dashboard-grid" aria-hidden="true">
          <div className="director-dashboard-column">
            <section className="dash-card director-dashboard-skeleton" />
            <section className="dash-card director-dashboard-skeleton director-dashboard-skeleton--large" />
          </div>
          <div className="director-dashboard-column">
            <section className="dash-card director-dashboard-skeleton" />
            <section className="dash-card director-dashboard-skeleton" />
          </div>
        </div>
      </PageContainer>
    )
  }

  if (state.error || !state.data) {
    return (
      <PageContainer className="director-dashboard-page">
        <section className="dash-card director-dashboard-error">
          <span><Icon name="alert" size={24} /></span>
          <h2>Impossible de charger le tableau de bord Directeur</h2>
          <p>Vérifiez que le backend est démarré puis réessayez.</p>
          <button type="button" className="director-primary-action director-primary-action--fit" onClick={load}>
            Réessayer
          </button>
        </section>
      </PageContainer>
    )
  }

  const { data } = state

  return (
    <PageContainer className="director-dashboard-page">
      {data.partialErrors.length > 0 && (
        <div className="director-dashboard-warning" role="status">
          <Icon name="alert" size={17} />
          <span>Certaines données n&apos;ont pas pu être actualisées : {data.partialErrors.join(', ')}.</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      )}

      <div className="director-dashboard-grid">
        <div className="director-dashboard-column director-dashboard-column--main">
          <DecisionsCard decisions={data.decisions} onNavigate={navigate} />
          <PrioritiesCard requests={data.priorities} onNavigate={navigate} />
        </div>

        <div className="director-dashboard-column director-dashboard-column--side">
          <GlobalPresenceCard presence={data.presence} onNavigate={navigate} />
          <ServicesCard presence={data.presence} onNavigate={navigate} />
          <AttentionCard items={data.attention} onNavigate={navigate} />
        </div>
      </div>
    </PageContainer>
  )
}
