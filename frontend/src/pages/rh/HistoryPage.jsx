import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { getRhHistoryLogs, getRhHistoryUsers } from '@/services/rh/rhHistory'
import '@/styles/rh/history.css'

const MARTINIQUE_TIME_ZONE = 'America/Martinique'

const ACTION_LABELS = {
  DEMANDE_VALIDEE: 'Validation de demande',
  DEMANDE_REFUSEE: 'Refus de demande',
  DEMANDE_ANNULEE: 'Annulation de demande',
  DEROGATION_DEMANDEE: 'Demande de dérogation',
  DEROGATION_PREVALIDEE_RH: 'Validation RH de dérogation',
  DEROGATION_ACCORDEE: 'Dérogation accordée',
  DEROGATION_REFUSEE: 'Dérogation refusée',
  DEROGATION_UTILISEE: 'Dérogation appliquée',
  HOLIDAY_WORK_STATUS_CHANGED: 'Jour férié chômé / travaillé',
  RH_BALANCE_CORRECTED: 'Correction de solde',
  SETTING_UPDATED: 'Modification du paramétrage',
  SUMMER_PERIOD_UPDATED: 'Modification de la période estivale',
  HTTP_POST: 'Création',
  HTTP_PATCH: 'Modification',
  HTTP_PUT: 'Modification',
  HTTP_DELETE: 'Suppression',
}

const RESOURCE_LABELS = {
  LEAVE_REQUESTS: 'Demande de congé',
  LEAVE_BALANCES: 'Solde collaborateur',
  ABSENCE_DECLARATIONS: 'Absence',
  DOCUMENTS: 'Justificatif / document',
  DEROGATIONS: 'Dérogation',
  HOLIDAYS: 'Jour férié / fermeture',
  HOLIDAY: 'Jour férié / fermeture',
  SETTINGS: 'Paramétrage',
  VALIDATORS: 'Valideur',
  VALIDATOR_REPLACEMENTS: 'Remplacement temporaire',
  SERVICE_BACKUP_VALIDATOR: 'Valideur de secours',
  LEAVE_TYPES: 'Type de congé / absence',
}

function fullName(user) {
  if (!user) return 'Système'
  return `${user.nom ?? ''} ${user.prenom ?? ''}`.trim() || user.email || 'Utilisateur'
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date)
}

function deepFindId(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key) && Number.isInteger(Number(child)) && Number(child) > 0) return Number(child)
  }
  for (const child of Object.values(value)) {
    const found = deepFindId(child, keys, depth + 1)
    if (found) return found
  }
  return null
}

function collaboratorId(log) {
  if (log?.collaborator?.id) return Number(log.collaborator.id)
  return deepFindId(log?.newValue, new Set(['employeeId', 'collaboratorId', 'userId']))
    ?? deepFindId(log?.oldValue, new Set(['employeeId', 'collaboratorId', 'userId']))
}

function actionLabel(log) {
  const action = String(log?.action ?? '')
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  const route = String(log?.newValue?.route ?? '').toLowerCase()
  if (route.includes('correct')) return 'Correction de solde'
  if (route.includes('absence')) return action.startsWith('HTTP_POST') ? 'Création / traitement d’absence' : 'Modification d’absence'
  if (route.includes('validator')) return 'Modification des valideurs'
  if (route.includes('settings')) return 'Modification du paramétrage'
  return action.replaceAll('_', ' ').toLocaleLowerCase('fr-FR').replace(/^./, (c) => c.toUpperCase())
}

function resourceLabel(log) {
  const key = String(log?.resourceType ?? '').toUpperCase()
  return RESOURCE_LABELS[key] ?? key.replaceAll('_', ' ').toLocaleLowerCase('fr-FR').replace(/^./, (c) => c.toUpperCase())
}

const VALUE_LABELS = {
  status: 'Statut',
  days: 'Nombre de jours',
  amount: 'Valeur',
  reason: 'Motif',
  comment: 'Commentaire',
  decisionComment: 'Commentaire',
  refusalComment: 'Motif du refus',
  justification: 'Justification',
  notifyEmployee: 'Notifier le collaborateur',
  startDate: 'Date de début',
  endDate: 'Date de fin',
  requestedStartDate: 'Date de début',
  requestedEndDate: 'Date de fin',
  referencePeriod: 'Période',
  counterType: 'Compteur',
  isChomed: 'Jour chômé',
  minimumPresence: 'Présence minimale',
  hasMinimumPresenceRule: 'Règle de présence minimale',
  settingValue: 'Valeur',
  availableDays: 'Disponible',
  reservedDays: 'En attente de validation',
  acquiredDays: 'En cours d’acquisition',
  balanceBefore: 'Solde avant',
  balanceAfter: 'Solde après',
  movementType: 'Type de mouvement',
  leaveRequestId: 'N° demande de congé',
  name: 'Libellé',
  isActive: 'Actif',
  employeeId: 'Collaborateur',
  serviceId: 'Service',
  validatorId: 'Valideur',
  replacementUserId: 'Remplaçant',
}

const VALUE_STATUS_LABELS = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE_VALIDATION: 'En attente',
  EN_COURS_TRAITEMENT: 'En cours de traitement',
  VALIDEE: 'Validée',
  REFUSEE: 'Refusée',
  ANNULEE: 'Annulée',
  ANNULEE_APRES_VALIDATION: 'Annulée après validation',
  ENREGISTREE: 'Enregistrée',
  JUSTIFICATIF_ATTENDU: 'Justificatif attendu',
  JUSTIFICATIF_EN_ATTENTE: 'Justificatif attendu',
  JUSTIFICATIF_REJETE: 'Justificatif attendu',
  A_VERIFIER_PAR_RH: 'À vérifier par la RH',
  DECLAREE: 'Déclarée',
  EN_ATTENTE_RH: 'En attente RH',
  ACCORDEE: 'Validée',
  UTILISEE: 'Appliquée',
  EXPIREE: 'Délai dépassé',
}

function humanValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  if (typeof value === 'string') {
    if (VALUE_STATUS_LABELS[value]) return VALUE_STATUS_LABELS[value]
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-')
      return `${day}/${month}/${year}`
    }
    if (/^\d{4}-\d{4}$/.test(value)) return value.replace('-', '/')
    return value.replaceAll('_', ' ')
  }
  if (typeof value === 'number') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
  if (Array.isArray(value)) return value.length ? value.map(humanValue).join(', ') : 'Aucun'
  return '—'
}

function valueLabel(key) {
  return VALUE_LABELS[key]
    ?? key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLocaleLowerCase('fr-FR').replace(/^./, (c) => c.toUpperCase())
}

function readableEntries(source, prefix = '', depth = 0) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 2) return []
  const ignored = new Set(['signatureData', 'password', 'method', 'route', 'statusCode', 'durationMs', 'metadata'])
  const result = []

  for (const [key, item] of Object.entries(source)) {
    if (ignored.has(key) || item === undefined) continue
    const label = prefix ? `${prefix} · ${valueLabel(key)}` : valueLabel(key)

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = readableEntries(item, label, depth + 1)
      if (nested.length) result.push(...nested)
      continue
    }

    result.push(`${label} : ${humanValue(item)}`)
  }

  return result
}

function valueSummary(value) {
  if (!value || typeof value !== 'object') return '—'
  const source = value?.body && typeof value.body === 'object' ? value.body : value
  const entries = readableEntries(source)
  if (!entries.length) return '—'
  const visible = entries.slice(0, 6)
  if (entries.length > visible.length) visible.push(`+ ${entries.length - visible.length} autre${entries.length - visible.length > 1 ? 's' : ''} modification${entries.length - visible.length > 1 ? 's' : ''}`)
  return visible.join('\n')
}

function commentSummary(log) {
  const sources = [log?.newValue?.body, log?.newValue, log?.oldValue?.body, log?.oldValue]
  const keys = ['comment', 'reason', 'motif', 'decisionComment', 'refusalComment', 'justification']
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return '—'
}

export function RhHistoryPage() {
  const [logs, setLogs] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ start: '', end: '', actor: '', collaborator: '', action: '' })

  useEffect(() => {
    let active = true
    Promise.all([getRhHistoryLogs(), getRhHistoryUsers()])
      .then(([auditLogs, allUsers]) => {
        if (!active) return
        setLogs(auditLogs)
        setUsers(allUsers)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const rhUsers = useMemo(() => users.filter((user) => user.role === 'RH').sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr')), [users])
  const collaborators = useMemo(() => users.filter((user) => !['ADMIN', 'DIRECTEUR'].includes(user.role)).sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr')), [users])
  const actionOptions = useMemo(() => [...new Set(logs.map((log) => actionLabel(log)))].sort((a, b) => a.localeCompare(b, 'fr')), [logs])
  const usersById = useMemo(() => new Map(users.map((user) => [Number(user.id), user])), [users])

  const visible = useMemo(() => logs.filter((log) => {
    const dateKey = String(log.createdAt ?? '').slice(0, 10)
    if (filters.start && dateKey < filters.start) return false
    if (filters.end && dateKey > filters.end) return false
    if (filters.actor && String(log.actorId ?? '') !== filters.actor) return false
    if (filters.collaborator && String(collaboratorId(log) ?? '') !== filters.collaborator) return false
    if (filters.action && actionLabel(log) !== filters.action) return false
    return true
  }), [filters, logs])

  return (
    <PageContainer className="rh-history-page">
      <section className="rh-history-card">
        <div className="rh-history-filters">
          <label><span>Du</span><input type="date" value={filters.start} onChange={(e) => setFilters((f) => ({ ...f, start: e.target.value }))} /></label>
          <label><span>Au</span><input type="date" value={filters.end} onChange={(e) => setFilters((f) => ({ ...f, end: e.target.value }))} /></label>
          <label><span>Utilisateur RH</span><select value={filters.actor} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}><option value="">Tous</option>{rhUsers.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}</select></label>
          <label><span>Collaborateur</span><select value={filters.collaborator} onChange={(e) => setFilters((f) => ({ ...f, collaborator: e.target.value }))}><option value="">Tous</option>{collaborators.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}</select></label>
          <label><span>Type d’action</span><select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}><option value="">Tous</option>{actionOptions.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <button type="button" onClick={() => setFilters({ start: '', end: '', actor: '', collaborator: '', action: '' })}><Icon name="refresh" size={15} /> Réinitialiser</button>
        </div>

        <div className="rh-history-table-wrap">
          <table className="rh-history-table">
            <thead><tr><th>Date et heure</th><th>Utilisateur RH</th><th>Collaborateur</th><th>Action</th><th>Élément</th><th>Ancienne valeur</th><th>Nouvelle valeur</th><th>Commentaire / motif</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="8" className="rh-history-empty">Chargement…</td></tr> : visible.length === 0 ? <tr><td colSpan="8" className="rh-history-empty">Aucune action RH ne correspond aux filtres.</td></tr> : visible.map((log) => {
                const employee = log.collaborator ?? usersById.get(collaboratorId(log))
                return <tr key={log.id}><td>{formatDateTime(log.createdAt)}</td><td><strong>{fullName(log.actor)}</strong></td><td>{employee ? fullName(employee) : '—'}</td><td><span className="rh-history-action">{actionLabel(log)}</span></td><td>{resourceLabel(log)}</td><td><span className="rh-history-value">{valueSummary(log.oldValue)}</span></td><td><span className="rh-history-value">{valueSummary(log.newValue)}</span></td><td>{commentSummary(log)}</td></tr>
              })}
            </tbody>
          </table>
        </div>
        <div className="rh-history-footer">{visible.length} action{visible.length > 1 ? 's' : ''}</div>
      </section>
    </PageContainer>
  )
}
