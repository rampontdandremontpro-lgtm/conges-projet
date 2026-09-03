import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { getRhHistoryLogs, getRhHistoryUsers } from '@/services/rh/rhHistory'
import { formatCounterReferencePeriod, formatReferencePeriodRange } from '@/utils/referencePeriods'
import '@/styles/rh/history.css'

const MARTINIQUE_TIME_ZONE = 'America/Martinique'
const PAGE_SIZE = 8

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
  HOLIDAY_CREATED: 'Jour férié créé',
  VALIDATOR_REPLACEMENT_CREATED: 'Remplacement de valideur créé',
  VALIDATOR_REPLACEMENT_DISABLED: 'Remplacement de valideur désactivé',
  VALIDATOR_REPLACEMENT_DISEBLED: 'Remplacement de valideur désactivé',
  RH_BALANCE_CORRECTED: 'Correction de solde',
  RH_STATISTICS_VIEWED: 'Consultation des statistiques',
  RH_LEAVE_REQUESTS_EXPORTED: 'Export des demandes de congé',
  RH_ABSENCE_DECLARATIONS_EXPORTED: 'Export des absences',
  RH_LEAVE_BALANCES_EXPORTED: 'Export des soldes',
  RH_BALANCE_MOVEMENTS_EXPORTED: 'Export des mouvements de solde',
  RH_DEROGATIONS_EXPORTED: 'Export des dérogations',
  SETTING_UPDATED: 'Modification du paramétrage',
  SUMMER_PERIOD_UPDATED: 'Modification de la période estivale',
  HTTP_POST: 'Création',
  HTTP_PATCH: 'Modification',
  HTTP_PUT: 'Modification',
  HTTP_DELETE: 'Suppression',
}

const HIDDEN_HISTORY_ACTIONS = new Set([
  'Export des absences',
  'Export des demandes de congé',
  'Export des dérogations',
  'Export des mouvements de solde',
  'Export des soldes',
  'Export des solde',
  'Modification du paramétrage',
  'Consultation des statistiques',
])

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
  REPORT: 'Statistiques',
  EXPORT: 'Export',
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

function isHiddenHistoryLog(log) {
  const action = String(log?.action ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  const resource = String(log?.resourceType ?? '').toUpperCase()
  const route = String(log?.newValue?.route ?? '').toLowerCase()

  if (resource === 'SETTINGS' || resource === 'NOTIFICATION' || resource === 'NOTIFICATIONS') return true
  if (route.includes('/settings') || route.includes('/notifications')) return true
  if (['PRACTICAL_LINK_CREATED', 'PRACTICAL_LINK_DELETED', 'PRACTICAL_LINK_UPDATED'].includes(action)) return true
  return HIDDEN_HISTORY_ACTIONS.has(actionLabel(log))
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
  role: 'Rôle',
  format: 'Format',
  rowCount: 'Nombre de lignes',
  dataType: 'Type de données',
  service: 'Service',
  collaborator: 'Collaborateur',
  leaveTypeId: 'Type de congé / absence',
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
  JUSTIFICATIF_EN_ATTENTE: 'Justificatif attendu',
  JUSTIFICATIF_REJETE: 'Nouveau justificatif attendu',
  JUSTIFICATIF_ATTENDU: 'Nouveau justificatif attendu',
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
    if (/^\d{4}-\d{4}$/.test(value)) return formatReferencePeriodRange(value)
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

const ESSENTIAL_HISTORY_KEYS = new Set([
  'status', 'name', 'nom', 'prenom', 'email', 'role', 'isActive',
  'startDate', 'endDate', 'startPeriod', 'endPeriod', 'date',
  'days', 'deductedDays', 'requestedDays', 'amount', 'balance',
  'balanceBefore', 'balanceAfter', 'availableDays', 'reservedDays', 'acquiredDays',
  'reason', 'motif', 'comment', 'decisionComment', 'refusalComment', 'justification',
  'leaveType', 'leaveTypeName', 'absenceType', 'absenceTypeName', 'movementType',
  'referencePeriod', 'counterType', 'minimumPresence', 'hasMinimumPresenceRule',
  'service', 'serviceName', 'externalCompanyName', 'employmentType',
  'settingValue', 'value', 'holidayType', 'format', 'rowCount', 'dataType',
])

const TECHNICAL_HISTORY_KEYS = new Set([
  'signatureData', 'password', 'passwordHash', 'method', 'route', 'statusCode', 'durationMs',
  'metadata', 'token', 'accessToken', 'refreshToken', 'ip', 'userAgent',
  'employeeId', 'serviceId', 'validatorId', 'replacementUserId', 'updatedById',
  'createdAt', 'updatedAt', 'deletedAt', 'id',
])

function readableEntries(source, prefix = '', depth = 0) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 2) return []
  const result = []

  for (const [key, item] of Object.entries(source)) {
    if (TECHNICAL_HISTORY_KEYS.has(key) || item === undefined) continue
    const isContainer = item && typeof item === 'object' && !Array.isArray(item)
    if (!ESSENTIAL_HISTORY_KEYS.has(key) && !isContainer) continue

    const label = prefix ? `${prefix} · ${valueLabel(key)}` : valueLabel(key)
    if (isContainer) {
      const nested = readableEntries(item, ESSENTIAL_HISTORY_KEYS.has(key) ? label : prefix, depth + 1)
      if (nested.length) result.push(...nested)
      continue
    }
    const displayValue = key === 'referencePeriod' && typeof source?.counterType === 'string'
      ? formatCounterReferencePeriod(item, source.counterType)
      : humanValue(item)
    result.push(`${label} : ${displayValue}`)
  }

  return result
}

function valueSummary(value) {
  if (!value || typeof value !== 'object') return '—'
  const source = value?.body && typeof value.body === 'object' ? value.body : value
  const entries = readableEntries(source)
  if (!entries.length) return '—'
  return entries.slice(0, 4).join('\n')
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
  const [page, setPage] = useState(1)
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

  const rhUsers = useMemo(
    () => users.filter((user) => user.role === 'RH').sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr')),
    [users],
  )
  const collaborators = useMemo(
    () => users.filter((user) => !['ADMIN', 'DIRECTEUR'].includes(user.role)).sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr')),
    [users],
  )
  const actionOptions = useMemo(
    () => [...new Set(logs.filter((log) => !isHiddenHistoryLog(log)).map((log) => actionLabel(log)))].sort((a, b) => a.localeCompare(b, 'fr')),
    [logs],
  )
  const usersById = useMemo(() => new Map(users.map((user) => [Number(user.id), user])), [users])

  const visible = useMemo(() => logs.filter((log) => {
    const label = actionLabel(log)
    if (isHiddenHistoryLog(log)) return false
    const dateKey = String(log.createdAt ?? '').slice(0, 10)
    if (filters.start && dateKey < filters.start) return false
    if (filters.end && dateKey > filters.end) return false
    if (filters.actor && String(log.actorId ?? '') !== filters.actor) return false
    if (filters.collaborator && String(collaboratorId(log) ?? '') !== filters.collaborator) return false
    if (filters.action && label !== filters.action) return false
    return true
  }), [filters, logs])

  useEffect(() => setPage(1), [filters])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const resetFilters = () => {
    setFilters({ start: '', end: '', actor: '', collaborator: '', action: '' })
    setPage(1)
  }

  return (
    <PageContainer className="rh-history-page">
      <section className="rh-history-card">
        <div className="rh-history-toolbar">
          <div className="rh-history-filters">
            <label>
              <span>Du</span>
              <input type="date" value={filters.start} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} />
            </label>
            <label>
              <span>Au</span>
              <input type="date" value={filters.end} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} />
            </label>
            <label>
              <span>Utilisateur RH</span>
              <select value={filters.actor} onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))}>
                <option value="">Tous</option>
                {rhUsers.map((user) => <option key={user.id} value={user.id}>{fullName(user)}</option>)}
              </select>
            </label>
            <label>
              <span>Collaborateur</span>
              <select value={filters.collaborator} onChange={(event) => setFilters((current) => ({ ...current, collaborator: event.target.value }))}>
                <option value="">Tous</option>
                {collaborators.map((user) => <option key={user.id} value={user.id}>{fullName(user)}</option>)}
              </select>
            </label>
            <label>
              <span>Type d’action</span>
              <select value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}>
                <option value="">Tous</option>
                {actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}
              </select>
            </label>
            <button type="button" className="rh-history-reset" onClick={resetFilters}>
              <Icon name="refresh" size={15} /> Réinitialiser
            </button>
          </div>
        </div>

        <div className="rh-history-table-wrap">
          <div className="rh-history-table">
            <div className="rh-history-row rh-history-row--head" role="row">
              <span>Date et heure</span>
              <span>Utilisateur RH</span>
              <span>Collaborateur</span>
              <span>Action</span>
              <span>Élément</span>
              <span>Ancienne valeur</span>
              <span>Nouvelle valeur</span>
            </div>

            {loading ? (
              <div className="rh-history-state"><span className="rh-history-spinner" /><strong>Chargement de l’historique…</strong></div>
            ) : visible.length === 0 ? (
              <div className="rh-history-state"><Icon name="clock" size={26} /><strong>Aucune action RH</strong><span>Aucune action ne correspond aux filtres actuels.</span></div>
            ) : pageRows.map((log) => {
              const employee = log.collaborator ?? usersById.get(collaboratorId(log))
              const comment = commentSummary(log)
              return (
                <div className="rh-history-row rh-history-row--body" role="row" key={log.id}>
                  <span className="rh-history-date" data-label="Date et heure">{formatDateTime(log.createdAt)}</span>
                  <span className="rh-history-user" data-label="Utilisateur RH"><strong>{fullName(log.actor)}</strong></span>
                  <span className="rh-history-collaborator" data-label="Collaborateur">{employee ? fullName(employee) : '—'}</span>
                  <span className="rh-history-action-cell" data-label="Action">
                    <span className="rh-history-action">{actionLabel(log)}</span>
                    {comment !== '—' && <small className="rh-history-action-comment">{comment}</small>}
                  </span>
                  <span className="rh-history-resource" data-label="Élément">{resourceLabel(log)}</span>
                  <span data-label="Ancienne valeur"><span className="rh-history-value">{valueSummary(log.oldValue)}</span></span>
                  <span data-label="Nouvelle valeur"><span className="rh-history-value rh-history-value--new">{valueSummary(log.newValue)}</span></span>
                </div>
              )
            })}
          </div>
        </div>

        {!loading && visible.length > 0 && (
          <div className="rh-history-footer">
            <span>{visible.length} action{visible.length > 1 ? 's' : ''}</span>
            <PaginationBar
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={visible.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </section>
    </PageContainer>
  )
}
