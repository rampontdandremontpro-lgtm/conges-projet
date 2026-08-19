import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { getAdminDashboardData } from '@/services/adminDashboard'

import '@/styles/collab/dashboard/index.css'
import '@/styles/admin/dashboard.css'

const MARTINIQUE_TIME_ZONE = 'America/Martinique'

const ADMIN_ACTIVITY_RESOURCES = new Set([
  'USERS',
  'USER',
  'SERVICES',
  'SERVICE',
  'SERVICE_BACKUP_VALIDATOR',
  'VALIDATOR_REPLACEMENT',
  'VALIDATOR_REPLACEMENTS',
  'LEAVE_TYPES',
  'LEAVE_TYPE',
  'HOLIDAYS',
  'HOLIDAY',
  'HOLIDAY_SYNC',
  'SETTINGS',
  'SETTING',
  'AUDIT_LOGS',
  'APPLICATION',
])

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Impossible de charger le tableau de bord.'
}

function personName(user) {
  return `${user?.prenom ?? ''} ${user?.nom ?? ''}`.trim() || user?.email || 'Utilisateur'
}

function resourceType(log) {
  return String(log?.resourceType ?? 'APPLICATION').toUpperCase()
}

function classifyAction(log) {
  const action = String(log?.action ?? '').toUpperCase()
  const resource = resourceType(log)

  if (action.includes('REACTIV') || action.includes('ENABLED')) {
    return { label: 'Réactivation', tone: 'teal', icon: 'refresh' }
  }

  if (action.includes('DISABLED') || action.includes('DEACTIV') || action.includes('DESACTIV')) {
    return { label: 'Désactivation', tone: 'red', icon: 'ban' }
  }

  if (
    action.includes('CREATED') ||
    action.includes('CREATE') ||
    action.includes('ASSIGNED') ||
    action.includes('AJOUT') ||
    action === 'HTTP_POST'
  ) {
    return { label: 'Création', tone: 'green', icon: 'plus' }
  }

  if (
    action.includes('UPDATED') ||
    action.includes('UPDATE') ||
    action.includes('MODIF') ||
    action === 'HTTP_PATCH' ||
    action === 'HTTP_PUT'
  ) {
    return { label: 'Modification', tone: 'blue', icon: 'edit' }
  }

  if (action.includes('DELETE') || action.includes('REMOVED') || action.includes('SUPPR')) {
    return { label: 'Suppression', tone: 'red', icon: 'trash' }
  }

  if (resource.includes('SETTING') || action.includes('CONFIG') || action.includes('PRESENCE_MIN')) {
    return { label: 'Configuration', tone: 'violet', icon: 'settings' }
  }

  return { label: 'Action', tone: 'neutral', icon: 'settings' }
}

function resourceLabel(log) {
  const type = resourceType(log)
  if (type === 'USERS' || type === 'USER') return 'Utilisateur'
  if (type === 'SERVICES' || type === 'SERVICE') return 'Service'
  if (type.includes('VALIDATOR')) return 'Valideur'
  if (type === 'LEAVE_TYPES' || type === 'LEAVE_TYPE') return 'Type de congé / absence'
  if (type === 'HOLIDAYS' || type === 'HOLIDAY' || type === 'HOLIDAY_SYNC') return 'Jour férié / fermeture'
  if (type === 'SETTINGS' || type === 'SETTING') return 'Paramétrage'
  return type.replaceAll('_', ' ').toLocaleLowerCase('fr-FR').replace(/^./, (char) => char.toUpperCase())
}

function extractBody(log) {
  const value = log?.newValue
  if (!value || typeof value !== 'object') return {}
  if (value.body && typeof value.body === 'object') return value.body
  return value
}

function activityTitle(log) {
  const action = classifyAction(log)
  return `${resourceLabel(log)} · ${action.label.toLocaleLowerCase('fr-FR')}`
}

function activityDetail(log) {
  const body = extractBody(log)
  const resource = resourceLabel(log)

  if (resource === 'Utilisateur') {
    const fullName = `${body.prenom ?? ''} ${body.nom ?? ''}`.trim()
    if (fullName) return fullName
    if (body.email) return body.email
  }

  if (resource === 'Service' && body.name) return body.name
  if (resource === 'Jour férié / fermeture') return body.name || body.date || `Par ${personName(log?.actor)}`
  if (resource === 'Type de congé / absence' && body.name) return body.name
  if (log?.actor) return `Par ${personName(log.actor)}`
  return 'Action système'
}

function relativeDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (diffMinutes < 1) return 'À l’instant'
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `Il y a ${diffHours} h`

  const today = new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(new Date())

  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(yesterdayDate)

  const key = new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)

  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)

  if (key === today) return `Aujourd’hui à ${time}`
  if (key === yesterday) return `Hier à ${time}`

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)
}

function AdminUsersOverview({ metrics, onNavigate }) {
  const stable = metrics.inactiveUsers === 0

  return (
    <section className="dash-card admin-dashboard-users-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Gestion des utilisateurs</h2>
          <span className="dash-card__period">Comptes et accès GMES</span>
        </div>
        <span className={`admin-dashboard-status ${stable ? 'is-ok' : 'is-warning'}`}>
          {stable ? 'Comptes actifs' : 'À surveiller'}
        </span>
      </header>

      <div className="admin-dashboard-main-hero">
        <strong>{metrics.activeUsers}</strong>
        <span>{metrics.activeUsers > 1 ? 'utilisateurs actifs' : 'utilisateur actif'}</span>
      </div>

      <div className="admin-dashboard-overview-pills">
        <div className="admin-dashboard-overview-pill is-blue">
          <span>Total</span>
          <strong>{metrics.totalUsers}</strong>
        </div>
        <div className="admin-dashboard-overview-pill is-green">
          <span>Actifs</span>
          <strong>{metrics.activeUsers}</strong>
        </div>
        <div className="admin-dashboard-overview-pill is-orange">
          <span>Inactifs</span>
          <strong>{metrics.inactiveUsers}</strong>
        </div>
      </div>

      <button type="button" className="admin-dashboard-primary-action" onClick={() => onNavigate('/app/admin-users')}>
        <Icon name="users" size={17} />
        <span>Gérer les utilisateurs</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}

function AdminServicesOverview({ metrics, onNavigate }) {
  const needsAction = metrics.servicesWithoutManager > 0

  return (
    <section className="dash-card admin-dashboard-services-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Services GMES</h2>
          <span className="dash-card__period">Organisation des services</span>
        </div>
        <span className={`admin-dashboard-status ${needsAction ? 'is-warning' : 'is-ok'}`}>
          {needsAction ? 'Action requise' : 'Configuration OK'}
        </span>
      </header>

      <div className="admin-dashboard-services-hero">
        <strong>{metrics.totalServices}</strong>
        <span>{metrics.totalServices > 1 ? 'services enregistrés' : 'service enregistré'}</span>
      </div>

      <div className="admin-dashboard-service-metrics">
        <div>
          <span>Internes</span>
          <strong>{metrics.activeInternalServices}</strong>
        </div>
        <div>
          <span>Externes</span>
          <strong>{metrics.activeExternalServices}</strong>
        </div>
        <div className={needsAction ? 'is-warning' : ''}>
          <span>Sans responsable</span>
          <strong>{metrics.servicesWithoutManager}</strong>
        </div>
      </div>

      <button type="button" className="admin-dashboard-primary-action" onClick={() => onNavigate('/app/admin-services')}>
        <Icon name="building" size={17} />
        <span>Gérer les services</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}

function AdminActivityCard({ items, onNavigate }) {
  return (
    <section className="dash-card admin-dashboard-activity-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title dash-card__title--lg">Activité récente</h2>
        <button type="button" className="dash-card__view-all" onClick={() => onNavigate('/app/admin-technical-logs')}>
          Voir tout <Icon name="arrowRight" size={14} />
        </button>
      </header>

      {items.length === 0 ? (
        <div className="admin-dashboard-empty-state">
          <span><Icon name="clock" size={20} /></span>
          <strong>Aucune activité récente</strong>
          <small>Les prochaines actions administratives apparaîtront ici.</small>
        </div>
      ) : (
        <div className="admin-dashboard-activity-list">
          {items.map((log) => {
            const action = classifyAction(log)
            return (
              <button key={log.id} type="button" className="admin-dashboard-activity-row" onClick={() => onNavigate('/app/admin-technical-logs')}>
                <span className={`admin-dashboard-activity-avatar is-${action.tone}`}>
                  <Icon name={action.icon} size={16} />
                </span>
                <div className="admin-dashboard-activity-main">
                  <strong>{activityTitle(log)}</strong>
                  <small>{activityDetail(log)}</small>
                </div>
                <time>{relativeDate(log.createdAt)}</time>
                <Icon name="chevronRight" size={15} />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AdminQuickActions({ onNavigate }) {
  const actions = [
    { icon: 'users', tone: 'blue', title: '+ Utilisateur', detail: 'Créer un nouveau compte', path: '/app/admin-users?action=create' },
    { icon: 'building', tone: 'cyan', title: '+ Service', detail: 'Ajouter un nouveau service', path: '/app/admin-services?action=create' },
    { icon: 'users', tone: 'violet', title: 'Configurer un Responsable', detail: 'Services sans Responsable principal', path: '/app/admin-services?manager=WITHOUT' },
    { icon: 'chart', tone: 'orange', title: 'Présence minimale', detail: 'Configurer les seuils par service', path: '/app/admin-minimum-presence' },
  ]

  return (
    <section className="dash-card admin-dashboard-quick-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title dash-card__title--lg">Actions rapides</h2>
      </header>
      <div className="admin-dashboard-quick-list">
        {actions.map((action) => (
          <button key={action.path} type="button" onClick={() => onNavigate(action.path)}>
            <span className={`is-${action.tone}`}><Icon name={action.icon} size={17} /></span>
            <div>
              <strong>{action.title}</strong>
              <small>{action.detail}</small>
            </div>
            <Icon name="chevronRight" size={15} />
          </button>
        ))}
      </div>
    </section>
  )
}

function AdminAttentionCard({ metrics, onNavigate }) {
  const items = [
    {
      icon: 'alert',
      tone: metrics.servicesWithoutManager > 0 ? 'warning' : 'ok',
      value: metrics.servicesWithoutManager,
      label: 'service(s) sans Responsable principal',
      path: '/app/admin-services?manager=WITHOUT',
    },
    {
      icon: 'chart',
      tone: metrics.servicesWithoutMinimum > 0 ? 'info' : 'ok',
      value: metrics.servicesWithoutMinimum,
      label: 'présence minimale non configurée',
      path: '/app/admin-minimum-presence',
    },
    {
      icon: 'users',
      tone: metrics.inactiveUsers > 0 ? 'neutral' : 'ok',
      value: metrics.inactiveUsers,
      label: 'utilisateur(s) inactif(s)',
      path: '/app/admin-users?status=INACTIVE',
    },
    {
      icon: 'building',
      tone: metrics.inactiveServices > 0 ? 'neutral' : 'ok',
      value: metrics.inactiveServices,
      label: 'service(s) inactif(s)',
      path: '/app/admin-services?status=INACTIVE',
    },
  ]

  return (
    <section className="dash-card admin-dashboard-attention-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Points d&apos;attention</h2>
      </header>
      <div className="admin-dashboard-attention-list">
        {items.map((item) => (
          <button key={item.path} type="button" className={`is-${item.tone}`} onClick={() => onNavigate(item.path)}>
            <span><Icon name={item.icon} size={15} /></span>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
            <Icon name="chevronRight" size={14} />
          </button>
        ))}
      </div>
    </section>
  )
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({
    loading: true,
    error: '',
    users: [],
    services: [],
    logs: [],
  })

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }))

    try {
      const data = await getAdminDashboardData()
      setState({ loading: false, error: '', users: data.users, services: data.services, logs: data.logs })
    } catch (error) {
      if (!silent) {
        setState((current) => ({ ...current, loading: false, error: errorMessage(error) }))
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    const refresh = () => load({ silent: true })
    window.addEventListener('gmes:data-changed', refresh)
    window.addEventListener('focus', refresh)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('gmes:data-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  const metrics = useMemo(() => {
    const activeUsers = state.users.filter((user) => user.isActive)
    const inactiveUsers = state.users.filter((user) => !user.isActive)
    const internalServices = state.services.filter((service) => service.serviceType === 'INTERNE')
    const externalServices = state.services.filter((service) => service.serviceType === 'EXTERNE')
    const activeInternalServices = internalServices.filter((service) => service.isActive)
    const activeExternalServices = externalServices.filter((service) => service.isActive)
    const servicesWithManager = activeInternalServices.filter((service) => Boolean(service.primaryManagerId))
    const servicesWithoutManager = activeInternalServices.filter((service) => !service.primaryManagerId)
    const inactiveServices = state.services.filter((service) => !service.isActive)
    const servicesWithoutMinimum = state.services.filter((service) => service.isActive && !service.hasMinimumPresenceRule)

    return {
      activeUsers: activeUsers.length,
      inactiveUsers: inactiveUsers.length,
      totalUsers: state.users.length,
      totalServices: state.services.length,
      activeInternalServices: activeInternalServices.length,
      activeExternalServices: activeExternalServices.length,
      servicesWithManager: servicesWithManager.length,
      servicesWithoutManager: servicesWithoutManager.length,
      inactiveServices: inactiveServices.length,
      servicesWithoutMinimum: servicesWithoutMinimum.length,
    }
  }, [state.services, state.users])

  const recentActivity = useMemo(() => state.logs
    .filter((log) => {
      const type = resourceType(log)
      return ADMIN_ACTIVITY_RESOURCES.has(type) || type.includes('VALIDATOR')
    })
    .slice(0, 4), [state.logs])

  if (state.loading) {
    return (
      <PageContainer className="admin-dashboard-page dash-page">
        <div className="admin-dashboard-state">
          <span className="admin-dashboard-spinner" />
          <strong>Chargement du tableau de bord…</strong>
        </div>
      </PageContainer>
    )
  }

  if (state.error) {
    return (
      <PageContainer className="admin-dashboard-page dash-page">
        <div className="admin-dashboard-state admin-dashboard-state--error">
          <Icon name="alert" size={23} />
          <strong>{state.error}</strong>
          <button type="button" onClick={() => load()}>Réessayer</button>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="admin-dashboard-page dash-page">
      <div className="admin-dashboard-grid">
        <div className="admin-dashboard-column admin-dashboard-column--main">
          <AdminUsersOverview metrics={metrics} onNavigate={navigate} />
          <AdminActivityCard items={recentActivity} onNavigate={navigate} />
        </div>

        <div className="admin-dashboard-column admin-dashboard-column--side">
          <AdminServicesOverview metrics={metrics} onNavigate={navigate} />
          <AdminQuickActions onNavigate={navigate} />
          <AdminAttentionCard metrics={metrics} onNavigate={navigate} />
        </div>
      </div>
    </PageContainer>
  )
}
