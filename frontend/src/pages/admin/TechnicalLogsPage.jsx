import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import { getAdminAuditLogs } from '@/services/admin/adminAuditLogs'
import { getAdminUsersData } from '@/services/admin/adminUsers'

import '@/styles/admin/technical-logs.css'

const PAGE_SIZE = 8
const MARTINIQUE_TIME_ZONE = 'America/Martinique'

const ROLE_LABELS = {
  COLLABORATEUR: 'Collaborateur',
  RESPONSABLE_SERVICE: 'Responsable de service',
  RH: 'RH',
  DIRECTEUR: 'Directeur',
  ADMIN: 'Administrateur',
}

const RESOURCE_LABELS = {
  USERS: 'Utilisateur',
  USER: 'Utilisateur',
  SERVICES: 'Service',
  SERVICE: 'Service',
  VALIDATORS: 'Valideur',
  VALIDATOR: 'Valideur',
  SERVICE_BACKUP_VALIDATOR: 'Valideur de secours',
  VALIDATOR_REPLACEMENT: 'Remplacement temporaire',
  VALIDATOR_REPLACEMENTS: 'Remplacement temporaire',
  LEAVE_TYPES: 'Type de congé / absence',
  LEAVE_TYPE: 'Type de congé / absence',
  HOLIDAYS: 'Jour férié / fermeture',
  HOLIDAY: 'Jour férié / fermeture',
  HOLIDAY_SYNC: 'Calendrier des jours fériés',
  SETTINGS: 'Paramétrage',
  SETTING: 'Paramétrage',
  EXPORTS: 'Export',
  EXPORT: 'Export',
  REPORTS: 'Rapport',
  REPORT: 'Rapport',
  AUDIT_LOGS: 'Journal technique',
  APPLICATION: 'Application',
}

const ADMIN_RESOURCE_TYPES = new Set([
  'USERS', 'USER', 'SERVICES', 'SERVICE', 'VALIDATORS', 'VALIDATOR',
  'SERVICE_BACKUP_VALIDATOR', 'VALIDATOR_REPLACEMENT', 'VALIDATOR_REPLACEMENTS', 'LEAVE_TYPES', 'LEAVE_TYPE',
  'HOLIDAYS', 'HOLIDAY', 'HOLIDAY_SYNC', 'SETTINGS', 'SETTING',
  'EXPORTS', 'EXPORT', 'REPORTS', 'REPORT', 'AUDIT_LOGS', 'APPLICATION',
])

const ACTION_ORDER = [
  'CREATION', 'MODIFICATION', 'DESACTIVATION', 'REACTIVATION',
  'SUPPRESSION', 'CONFIGURATION', 'SYNCHRONISATION', 'EXPORT', 'AUTRE',
]

const ACTION_LABELS = {
  CREATION: 'Création',
  MODIFICATION: 'Modification',
  DESACTIVATION: 'Désactivation',
  REACTIVATION: 'Réactivation',
  SUPPRESSION: 'Suppression',
  CONFIGURATION: 'Configuration',
  SYNCHRONISATION: 'Synchronisation',
  EXPORT: 'Export',
  AUTRE: 'Autre',
}

const ACTION_TONES = {
  CREATION: 'green',
  MODIFICATION: 'blue',
  DESACTIVATION: 'red',
  REACTIVATION: 'teal',
  SUPPRESSION: 'red',
  CONFIGURATION: 'violet',
  SYNCHRONISATION: 'cyan',
  EXPORT: 'navy',
  AUTRE: 'neutral',
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Impossible de charger les journaux techniques.'
}

function actorName(log) {
  if (!log?.actor) return 'Système'
  return `${log.actor.nom ?? ''} ${log.actor.prenom ?? ''}`.trim() || log.actor.email || 'Utilisateur'
}

function actorRole(log) {
  if (!log?.actor) return 'Système'
  return ROLE_LABELS[log.actor.role] ?? log.actor.role ?? 'Utilisateur'
}

function classifyAction(actionValue) {
  const action = String(actionValue ?? '').toUpperCase()

  if (action.includes('EXPORT')) return 'EXPORT'
  if (action.includes('SYNC')) return 'SYNCHRONISATION'
  if (action.includes('REACTIV') || action.includes('ENABLED')) return 'REACTIVATION'
  if (action.includes('DISABLED') || action.includes('DEACTIV') || action.includes('DESACTIV')) return 'DESACTIVATION'
  if (action.includes('DELETE') || action.includes('DELETED') || action.includes('REMOVED') || action.includes('SUPPR')) return 'SUPPRESSION'
  if (action.includes('CONFIG') || action.includes('SETTING') || action.includes('PRESENCE_MIN')) return 'CONFIGURATION'
  if (
    action.includes('CREATED') || action.includes('CREATE') || action.includes('ASSIGNED') ||
    action.includes('AJOUT') || action === 'HTTP_POST'
  ) return 'CREATION'
  if (
    action.includes('UPDATED') || action.includes('UPDATE') || action.includes('MODIF') ||
    action === 'HTTP_PATCH' || action === 'HTTP_PUT'
  ) return 'MODIFICATION'

  return 'AUTRE'
}

function resourceType(log) {
  return String(log?.resourceType ?? 'APPLICATION').toUpperCase()
}

function resourceLabel(log) {
  const type = resourceType(log)
  return RESOURCE_LABELS[type] ?? type.replaceAll('_', ' ').toLocaleLowerCase('fr-FR').replace(/^./, (c) => c.toUpperCase())
}

function resourceIdentifier(log) {
  if (log?.resourceId) {
    const prefix = resourceType(log).replace(/[^A-Z]/g, '').slice(0, 3) || 'RES'
    return `${prefix}-${String(log.resourceId).padStart(4, '0')}`
  }
  return '—'
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const day = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)

  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)

  return `${day} • ${time}`
}

function martiniqueDateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: MARTINIQUE_TIME_ZONE,
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function todayMartiniqueKey() {
  return martiniqueDateKey(new Date())
}

function dateMinusDaysKey(days) {
  const now = new Date()
  now.setUTCDate(now.getUTCDate() - days)
  return martiniqueDateKey(now)
}

function extractDisplayName(log) {
  const candidates = [
    log?.newValue?.name,
    log?.newValue?.nom,
    log?.newValue?.body?.name,
    log?.newValue?.body?.nom,
    log?.oldValue?.name,
    log?.oldValue?.nom,
  ]
  const direct = candidates.find((value) => typeof value === 'string' && value.trim())
  if (direct) return direct.trim()

  const prenom = log?.newValue?.body?.prenom ?? log?.newValue?.prenom
  const nom = log?.newValue?.body?.nom ?? log?.newValue?.nom
  const full = `${nom ?? ''} ${prenom ?? ''}`.trim()
  return full || ''
}

function describeAction(log) {
  const category = classifyAction(log?.action)
  const resource = resourceLabel(log)
  const name = extractDisplayName(log)
  const suffix = name ? ` — ${name}` : ''
  return `${ACTION_LABELS[category]} · ${resource}${suffix}`
}

function sanitizeForDisplay(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitizeForDisplay)

  const hidden = new Set([
    'password', 'passwordHash', 'token', 'signatureData',
    'employeeSignatureData', 'validatorSignatureData', 'file',
  ])
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !hidden.has(key))
      .map(([key, child]) => [key, sanitizeForDisplay(child)]),
  )
}

function prettyJson(value) {
  if (!value) return 'Aucune donnée.'
  try {
    return JSON.stringify(sanitizeForDisplay(value), null, 2)
  } catch {
    return String(value)
  }
}

function isAdminTechnicalLog(log) {
  const type = resourceType(log)
  if (ADMIN_RESOURCE_TYPES.has(type)) return true

  const action = String(log?.action ?? '').toUpperCase()
  return (
    action.includes('SERVICE_BACKUP_VALIDATOR') ||
    action.includes('VALIDATOR_REPLACEMENT') ||
    action.includes('HOLIDAY')
  )
}

function exportCsv(logs) {
  const rows = [
    ['Date / heure', 'Utilisateur', 'Rôle', 'Action', 'Ressource', 'Identifiant'],
    ...logs.map((log) => [
      formatDateTime(log.createdAt),
      actorName(log),
      actorRole(log),
      ACTION_LABELS[classifyAction(log.action)],
      resourceLabel(log),
      resourceIdentifier(log),
    ]),
  ]

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';'))
    .join('\n')

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `journaux-techniques-${todayMartiniqueKey()}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function LogDrawer({ log, onClose }) {
  if (!log) return null
  const actionCategory = classifyAction(log.action)

  return (
    <div className="admin-logs-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="admin-logs-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-logs-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-logs-drawer__head">
          <div>
            <span>ÉVÉNEMENT D’AUDIT</span>
            <h2 id="admin-logs-drawer-title">Détail du journal</h2>
            <p>{formatDateTime(log.createdAt)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <div className="admin-logs-drawer__body">
          <section className="admin-logs-detail-card">
            <div className="admin-logs-detail-title"><span>1</span><div><strong>Informations de l’action</strong><small>Traçabilité de l’événement enregistré.</small></div></div>
            <div className="admin-logs-detail-grid">
              <div><span>UTILISATEUR</span><strong>{actorName(log)}</strong></div>
              <div><span>RÔLE</span><strong>{actorRole(log)}</strong></div>
              <div><span>ACTION</span><strong className={`admin-logs-badge admin-logs-badge--${ACTION_TONES[actionCategory]}`}>{ACTION_LABELS[actionCategory]}</strong></div>
              <div><span>ACTION TECHNIQUE</span><strong>{String(log.action ?? '—').replaceAll('_', ' ')}</strong></div>
            </div>
          </section>

          <section className="admin-logs-detail-card">
            <div className="admin-logs-detail-title"><span>2</span><div><strong>Ressource concernée</strong><small>Élément administratif associé à l’action.</small></div></div>
            <div className="admin-logs-detail-grid">
              <div><span>RESSOURCE</span><strong>{resourceLabel(log)}</strong></div>
              <div><span>IDENTIFIANT</span><strong>{resourceIdentifier(log)}</strong></div>
              <div className="admin-logs-detail-wide"><span>RÉSUMÉ</span><strong>{describeAction(log)}</strong></div>
            </div>
          </section>

          <section className="admin-logs-detail-card">
            <div className="admin-logs-detail-title"><span>3</span><div><strong>Détails</strong><small>Valeurs réellement enregistrées dans le journal d’audit.</small></div></div>
            <div className="admin-logs-json-grid">
              <div><span>AVANT</span><pre>{prettyJson(log.oldValue)}</pre></div>
              <div><span>APRÈS</span><pre>{prettyJson(log.newValue)}</pre></div>
            </div>
          </section>
        </div>

        <footer className="admin-logs-drawer__footer">
          <button type="button" onClick={onClose}>Fermer</button>
        </footer>
      </aside>
    </div>
  )
}

export function AdminTechnicalLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''

  const [logs, setLogs] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [resourceFilter, setResourceFilter] = useState('ALL')
  const [actorFilter, setActorFilter] = useState('ALL')
  const [periodFilter, setPeriodFilter] = useState('ALL')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [page, setPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    Promise.all([getAdminAuditLogs(), getAdminUsersData()])
      .then(([auditLogs, adminUsersData]) => {
        if (cancelled) return
        setLogs(auditLogs.filter(isAdminTechnicalLog))
        setUsers(adminUsersData.users)
      })
      .catch((fetchError) => {
        if (!cancelled) setError(errorMessage(fetchError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const actors = useMemo(() => {
    const map = new Map()

    for (const user of users) {
      const id = String(user.id)
      const name = `${user.nom ?? ''} ${user.prenom ?? ''}`.trim() || user.email || `Utilisateur ${id}`
      map.set(id, { id, name })
    }

    for (const log of logs) {
      if (!log.actorId) continue
      const id = String(log.actorId)
      if (!map.has(id)) map.set(id, { id, name: actorName(log) })
    }

    const allUsers = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return [...allUsers, { id: 'SYSTEM', name: 'Système' }]
  }, [users, logs])

  const resources = useMemo(() => {
    const map = new Map()
    for (const log of logs) {
      const key = resourceType(log)
      if (!map.has(key)) map.set(key, resourceLabel(log))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [logs])

  const availableActions = useMemo(() => {
    const found = new Set(logs.map((log) => classifyAction(log.action)))
    return ACTION_ORDER.filter((action) => found.has(action))
  }, [logs])

  const filteredLogs = useMemo(() => {
    const query = normalize(search)
    const today = todayMartiniqueKey()
    const sevenDaysAgo = dateMinusDaysKey(6)
    const thirtyDaysAgo = dateMinusDaysKey(29)

    return logs.filter((log) => {
      const actionCategory = classifyAction(log.action)
      const type = resourceType(log)
      const actorId = log.actorId ? String(log.actorId) : 'SYSTEM'
      const dateKey = martiniqueDateKey(log.createdAt)

      if (actionFilter !== 'ALL' && actionCategory !== actionFilter) return false
      if (resourceFilter !== 'ALL' && type !== resourceFilter) return false
      if (actorFilter !== 'ALL' && actorId !== actorFilter) return false

      if (periodFilter === 'TODAY' && dateKey !== today) return false
      if (periodFilter === '7D' && (dateKey < sevenDaysAgo || dateKey > today)) return false
      if (periodFilter === '30D' && (dateKey < thirtyDaysAgo || dateKey > today)) return false
      if (periodFilter === 'CUSTOM') {
        if (customStart && dateKey < customStart) return false
        if (customEnd && dateKey > customEnd) return false
      }

      if (!query) return true

      return normalize([
        actorName(log), actorRole(log), ACTION_LABELS[actionCategory], log.action,
        resourceLabel(log), resourceIdentifier(log), extractDisplayName(log),
      ].join(' ')).includes(query)
    })
  }, [logs, search, actionFilter, resourceFilter, actorFilter, periodFilter, customStart, customEnd])

  useEffect(() => {
    setPage(1)
  }, [search, actionFilter, resourceFilter, actorFilter, periodFilter, customStart, customEnd])

  const visibleLogs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredLogs.slice(start, start + PAGE_SIZE)
  }, [filteredLogs, page])

  const resetFilters = () => {
    setActionFilter('ALL')
    setResourceFilter('ALL')
    setActorFilter('ALL')
    setPeriodFilter('ALL')
    setCustomStart('')
    setCustomEnd('')
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
  }

  return (
    <PageContainer className="admin-logs-page">
      <div className="admin-logs-heading">
        <div>
          <p>{filteredLogs.length} événement{filteredLogs.length > 1 ? 's' : ''} affiché{filteredLogs.length > 1 ? 's' : ''}</p>
          <span>Historique des actions administratives et techniques de G Congés & Absences.</span>
        </div>
        <button
          type="button"
          className="admin-logs-export"
          onClick={() => exportCsv(filteredLogs)}
          disabled={filteredLogs.length === 0}
        >
          <Icon name="download" size={17} />
          Exporter
        </button>
      </div>

      <section className="admin-logs-filters" aria-label="Filtres des journaux techniques">
        <label>
          <span>ACTION</span>
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="ALL">Toutes les actions</option>
            {availableActions.map((action) => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
          </select>
        </label>

        <label>
          <span>RESSOURCE</span>
          <select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)}>
            <option value="ALL">Toutes les ressources</option>
            {resources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label>
          <span>UTILISATEUR</span>
          <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
            <option value="ALL">Tous les utilisateurs</option>
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </select>
        </label>

        <label>
          <span>PÉRIODE</span>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            <option value="ALL">Toutes les périodes</option>
            <option value="TODAY">Aujourd’hui</option>
            <option value="7D">7 derniers jours</option>
            <option value="30D">30 derniers jours</option>
            <option value="CUSTOM">Personnalisée</option>
          </select>
        </label>

        <button type="button" className="admin-logs-reset" onClick={resetFilters}>
          <Icon name="refresh" size={15} />
          Réinitialiser
        </button>

        {periodFilter === 'CUSTOM' && (
          <div className="admin-logs-custom-dates">
            <label><span>DU</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label><span>AU</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </div>
        )}
      </section>

      <section className="admin-logs-card">
        {loading ? (
          <div className="admin-logs-state"><span className="admin-logs-spinner" /><strong>Chargement des journaux…</strong></div>
        ) : error ? (
          <div className="admin-logs-state admin-logs-state--error"><strong>{error}</strong><span>Actualisez la page pour réessayer.</span></div>
        ) : filteredLogs.length === 0 ? (
          <div className="admin-logs-state"><Icon name="cpu" size={30} /><strong>Aucun journal trouvé</strong><span>Modifiez les filtres ou la recherche.</span></div>
        ) : (
          <>
            <div className="admin-logs-table-wrap">
              <div className="admin-logs-table" role="table" aria-label="Journaux techniques">
                <div className="admin-logs-row admin-logs-row--head" role="row">
                  <span>Date / heure</span>
                  <span>Utilisateur</span>
                  <span>Rôle</span>
                  <span>Action</span>
                  <span>Ressource</span>
                  <span>Identifiant</span>
                </div>

                {visibleLogs.map((log) => {
                  const category = classifyAction(log.action)
                  return (
                    <button
                      key={log.id}
                      type="button"
                      className="admin-logs-row admin-logs-row--body"
                      onClick={() => setSelectedLog(log)}
                      role="row"
                    >
                      <span className="admin-logs-date">{formatDateTime(log.createdAt)}</span>
                      <span className="admin-logs-actor">{actorName(log)}</span>
                      <span className="admin-logs-role">{actorRole(log)}</span>
                      <span><strong className={`admin-logs-badge admin-logs-badge--${ACTION_TONES[category]}`}>{ACTION_LABELS[category]}</strong></span>
                      <span className="admin-logs-resource">{resourceLabel(log)}</span>
                      <span className="admin-logs-identifier">{resourceIdentifier(log)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <footer className="admin-logs-footer">
              <span>{filteredLogs.length} journal{filteredLogs.length > 1 ? 'x' : ''} technique{filteredLogs.length > 1 ? 's' : ''}</span>
              <PaginationBar page={page} pageSize={PAGE_SIZE} totalItems={filteredLogs.length} onPageChange={setPage} />
            </footer>
          </>
        )}
      </section>

      <LogDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
    </PageContainer>
  )
}
