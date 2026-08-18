import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  addRhBackupValidator,
  createRhValidatorReplacement,
  disableRhBackupValidator,
  disableRhValidatorReplacement,
  enableRhBackupValidator,
  getRhServiceValidators,
  getRhValidatorReplacements,
  getRhValidatorServices,
  getRhValidatorUsers,
} from '@/services/rhValidators'

import '@/styles/rh/validators.css'

const PAGE_SIZE = 8
const ELIGIBLE_VALIDATOR_ROLES = ['RESPONSABLE_SERVICE', 'RH', 'DIRECTEUR']
const SUPPORTED_VALIDATION_MODE = 'RESPONSABLE_PUIS_RELAIS'
const MARTINIQUE_TIME_ZONE = 'America/Martinique'

const VALIDATION_MODE_META = {
  RESPONSABLE_PUIS_RELAIS: { label: 'Responsable + relais', tone: 'blue' },
  DIRECTEUR_ET_RH: { label: 'Directeur / RH', tone: 'neutral' },
  DIRECTEUR_SEUL: { label: 'Directeur seul', tone: 'neutral' },
  SANS_VALIDATION: { label: 'Sans validation', tone: 'neutral' },
}

const ROLE_LABELS = {
  COLLABORATEUR: 'Collaborateur',
  RESPONSABLE_SERVICE: 'Responsable de service',
  RH: 'RH',
  DIRECTEUR: 'Directeur',
  ADMIN: 'Administrateur',
}

const REPLACEMENT_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'current', label: 'En cours' },
  { id: 'planned', label: 'Planifiés' },
  { id: 'finished', label: 'Terminés' },
  { id: 'disabled', label: 'Désactivés' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function fullName(user) {
  if (!user) return '—'
  return `${user.prenom ?? ''} ${user.nom ?? ''}`.trim() || '—'
}

function initials(user) {
  return `${user?.prenom?.[0] ?? ''}${user?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? String(role ?? '—').replaceAll('_', ' ')
}

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: MARTINIQUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function formatDateLong(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: MARTINIQUE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function validationModeMeta(mode) {
  return VALIDATION_MODE_META[mode] ?? { label: String(mode ?? 'Non configuré').replaceAll('_', ' '), tone: 'neutral' }
}

function replacementStatus(item, today = martiniqueToday()) {
  if (!item?.isActive) return { id: 'disabled', label: 'Désactivé', tone: 'disabled' }

  const validatorEligible = Boolean(
    item.replacementValidator?.isActive &&
      ELIGIBLE_VALIDATOR_ROLES.includes(item.replacementValidator?.role),
  )

  if (!validatorEligible) return { id: 'disabled', label: 'Inopérant', tone: 'danger' }
  if (today < item.startDate) return { id: 'planned', label: 'Planifié', tone: 'planned' }
  if (today > item.endDate) return { id: 'finished', label: 'Terminé', tone: 'finished' }
  return { id: 'current', label: 'En cours', tone: 'current' }
}

function matchesSearch(values, query) {
  const needle = normalize(query)
  if (!needle) return true
  const haystack = values.map(normalize).join(' ')
  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

function userTone(user) {
  const tones = ['blue', 'violet', 'green', 'orange', 'cyan', 'pink']
  const seed = Number(user?.id ?? 0) || fullName(user).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[Math.abs(seed) % tones.length]
}

function UserAvatar({ user, size = 'normal' }) {
  return (
    <span className={`rh-validator-avatar rh-validator-avatar--${userTone(user)} rh-validator-avatar--${size}`}>
      {initials(user)}
    </span>
  )
}

function ServiceStatusBadge({ active }) {
  return (
    <span className={`rh-validator-badge rh-validator-badge--${active ? 'active' : 'inactive'}`}>
      <i /> {active ? 'Actif' : 'Inactif'}
    </span>
  )
}

function ModeBadge({ mode }) {
  const meta = validationModeMeta(mode)
  return <span className={`rh-validator-badge rh-validator-badge--${meta.tone}`}>{meta.label}</span>
}

function ReplacementStatusBadge({ item }) {
  const meta = replacementStatus(item)
  return <span className={`rh-validator-badge rh-validator-badge--replacement-${meta.tone}`}><i />{meta.label}</span>
}

function BackupValidatorDrawer({ service, users, validatorData, onClose, onSaved }) {
  const activeIds = new Set(
    (validatorData?.backupValidators ?? [])
      .filter((item) => item.isActive)
      .map((item) => Number(item.validatorId)),
  )
  const primaryManagerId = Number(validatorData?.primaryManagerId ?? service.primaryManagerId ?? 0)
  const candidates = users.filter((user) => (
    user.isActive &&
    ELIGIBLE_VALIDATOR_ROLES.includes(user.role) &&
    Number(user.id) !== primaryManagerId &&
    !activeIds.has(Number(user.id))
  ))

  const [validatorId, setValidatorId] = useState(candidates[0]?.id ? String(candidates[0].id) : '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    if (!validatorId || saving) return
    setSaving(true)
    setFeedback('')
    try {
      await addRhBackupValidator(service.id, Number(validatorId))
      onSaved('Valideur de secours ajouté.')
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rh-validators-overlay" role="presentation" onMouseDown={onClose}>
      <aside className="rh-validators-drawer" role="dialog" aria-modal="true" aria-label="Ajouter un valideur de secours" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rh-validators-drawer__head">
          <div>
            <small>VALIDEUR DE SECOURS</small>
            <h2>Ajouter un valideur</h2>
            <p>{service.name}</p>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </div>

        <form className="rh-validators-form" onSubmit={submit}>
          <div className="rh-validators-form__info">
            <Icon name="info" size={18} />
            <p>Seuls les Responsables de service, RH et Directeur actifs peuvent être désignés. Le Responsable principal du service est exclu.</p>
          </div>

          <label>
            <span>Valideur</span>
            <select value={validatorId} onChange={(event) => setValidatorId(event.target.value)} disabled={saving || candidates.length === 0}>
              {candidates.length === 0 ? (
                <option value="">Aucun valideur éligible disponible</option>
              ) : candidates.map((user) => (
                <option key={user.id} value={user.id}>{fullName(user)} — {roleLabel(user.role)}</option>
              ))}
            </select>
          </label>

          {validatorId && (() => {
            const selected = candidates.find((user) => String(user.id) === String(validatorId))
            return selected ? (
              <div className="rh-validators-selected-user">
                <UserAvatar user={selected} size="large" />
                <div>
                  <strong>{fullName(selected)}</strong>
                  <span>{roleLabel(selected.role)}</span>
                  <small>{selected.email}</small>
                </div>
              </div>
            ) : null
          })()}

          {feedback && <div className="rh-validators-form__error"><Icon name="alert" size={16} />{feedback}</div>}

          <div className="rh-validators-form__actions">
            <button type="button" className="rh-validators-btn rh-validators-btn--secondary" onClick={onClose} disabled={saving}>Annuler</button>
            <button type="submit" className="rh-validators-btn rh-validators-btn--primary" disabled={!validatorId || saving}>
              <Icon name="plus" size={16} /> {saving ? 'Ajout…' : 'Ajouter le valideur'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

function ReplacementDrawer({ mode, item, users, onClose, onSaved }) {
  const today = martiniqueToday()
  const employees = users.filter((user) => user.isActive && user.role === 'COLLABORATEUR' && user.employmentType === 'INTERNE')
  const validators = users.filter((user) => user.isActive && ELIGIBLE_VALIDATOR_ROLES.includes(user.role))
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ? String(employees[0].id) : '',
    replacementValidatorId: validators[0]?.id ? String(validators[0].id) : '',
    startDate: today,
    endDate: today,
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    if (saving || !form.employeeId || !form.replacementValidatorId || !form.startDate || !form.endDate) return
    setSaving(true)
    setFeedback('')
    try {
      await createRhValidatorReplacement({
        employeeId: Number(form.employeeId),
        replacementValidatorId: Number(form.replacementValidatorId),
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim() || undefined,
      })
      onSaved('Valideur temporaire créé.')
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const disable = async () => {
    if (!item?.id || saving) return
    setSaving(true)
    setFeedback('')
    try {
      await disableRhValidatorReplacement(item.id)
      onSaved('Valideur temporaire désactivé.')
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const isCreate = mode === 'create'
  const status = item ? replacementStatus(item) : null
  const canDisable = item?.isActive === true

  return (
    <div className="rh-validators-overlay" role="presentation" onMouseDown={onClose}>
      <aside className="rh-validators-drawer rh-validators-drawer--replacement" role="dialog" aria-modal="true" aria-label={isCreate ? 'Nouveau valideur temporaire' : 'Détail du valideur temporaire'} onMouseDown={(event) => event.stopPropagation()}>
        <div className="rh-validators-drawer__head">
          <div>
            <small>{isCreate ? 'VALIDEUR TEMPORAIRE' : `VALIDEUR TEMPORAIRE N°${item?.id}`}</small>
            <h2>{isCreate ? 'Nouveau valideur temporaire' : fullName(item?.employee)}</h2>
            <p>{isCreate ? 'Désigner temporairement un valideur pour un collaborateur.' : item?.employee?.service?.name ?? 'Collaborateur interne'}</p>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </div>

        {isCreate ? (
          <form className="rh-validators-form" onSubmit={submit}>
            <div className="rh-validators-form__info">
              <Icon name="calendar" size={18} />
              <p>Les dates sont inclusives en fuseau Martinique. Aucun chevauchement n’est autorisé pour le même collaborateur.</p>
            </div>

            <div className="rh-validators-form__grid">
              <label className="rh-validators-form__wide">
                <span>Collaborateur</span>
                <select value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))} disabled={saving}>
                  {employees.length === 0 ? <option value="">Aucun collaborateur interne actif</option> : employees.map((user) => (
                    <option key={user.id} value={user.id}>{fullName(user)} — {user.service?.name ?? 'Sans service'}</option>
                  ))}
                </select>
              </label>

              <label className="rh-validators-form__wide">
                <span>Valideur temporaire</span>
                <select value={form.replacementValidatorId} onChange={(event) => setForm((current) => ({ ...current, replacementValidatorId: event.target.value }))} disabled={saving}>
                  {validators.length === 0 ? <option value="">Aucun valideur éligible</option> : validators.map((user) => (
                    <option key={user.id} value={user.id}>{fullName(user)} — {roleLabel(user.role)}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Date de début</span>
                <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} disabled={saving} />
              </label>

              <label>
                <span>Date de fin</span>
                <input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} disabled={saving} />
              </label>

              <label className="rh-validators-form__wide">
                <span>Motif (optionnel)</span>
                <textarea rows="4" maxLength="1000" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ex. absence du Responsable habituel, continuité du service…" disabled={saving} />
              </label>
            </div>

            {feedback && <div className="rh-validators-form__error"><Icon name="alert" size={16} />{feedback}</div>}

            <div className="rh-validators-form__actions">
              <button type="button" className="rh-validators-btn rh-validators-btn--secondary" onClick={onClose} disabled={saving}>Annuler</button>
              <button type="submit" className="rh-validators-btn rh-validators-btn--primary" disabled={saving || !form.employeeId || !form.replacementValidatorId}>
                <Icon name="check" size={16} /> {saving ? 'Création…' : 'Créer le valideur temporaire'}
              </button>
            </div>
          </form>
        ) : (
          <div className="rh-validators-detail">
            <div className="rh-validators-detail__status">
              <ReplacementStatusBadge item={item} />
              <span>Créé le {formatDateTime(item?.createdAt)}</span>
            </div>

            <div className="rh-validators-detail__people">
              <article>
                <small>Collaborateur</small>
                <div><UserAvatar user={item?.employee} size="large" /><span><strong>{fullName(item?.employee)}</strong><small>{item?.employee?.service?.name ?? '—'}</small></span></div>
              </article>
              <Icon name="arrowRight" size={22} />
              <article>
                <small>Valideur temporaire</small>
                <div><UserAvatar user={item?.replacementValidator} size="large" /><span><strong>{fullName(item?.replacementValidator)}</strong><small>{roleLabel(item?.replacementValidator?.role)}</small></span></div>
              </article>
            </div>

            <div className="rh-validators-detail__grid">
              <div><small>Date de début</small><strong>{formatDate(item?.startDate)}</strong></div>
              <div><small>Date de fin</small><strong>{formatDate(item?.endDate)}</strong></div>
              <div><small>Créé par la RH</small><strong>{fullName(item?.createdByRh)}</strong></div>
              <div><small>État du valideur temporaire</small><strong>{item?.replacementValidator?.isActive ? 'Utilisateur actif' : 'Utilisateur inactif'}</strong></div>
            </div>

            <div className="rh-validators-detail__reason">
              <small>Motif</small>
              <p>{item?.reason || 'Aucun motif renseigné.'}</p>
            </div>

            {status?.tone === 'danger' && (
              <div className="rh-validators-detail__warning"><Icon name="alert" size={17} />Ce valideur temporaire est inopérant car l’utilisateur n’est plus actif ou éligible. Le circuit normal reprend automatiquement.</div>
            )}

            {feedback && <div className="rh-validators-form__error"><Icon name="alert" size={16} />{feedback}</div>}

            <div className="rh-validators-form__actions">
              <button type="button" className="rh-validators-btn rh-validators-btn--secondary" onClick={onClose}>Fermer</button>
              {canDisable && (
                <button type="button" className="rh-validators-btn rh-validators-btn--danger" onClick={disable} disabled={saving}>
                  <Icon name="alert" size={16} /> {saving ? 'Désactivation…' : 'Désactiver le valideur temporaire'}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function ServiceAccordion({ item, expanded, onToggle, onAction, onAdd }) {
  const { service, validators } = item
  const backups = validators?.backupValidators ?? []
  const activeBackups = backups.filter((entry) => entry.isActive && entry.validator?.isActive)
  const supported = service.validationMode === SUPPORTED_VALIDATION_MODE

  return (
    <article className={`rh-validator-service-card${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="rh-validator-service-card__summary" onClick={onToggle} aria-expanded={expanded}>
        <div className="rh-validator-service-card__identity">
          <div className="rh-validator-service-card__titleline">
            <strong>{service.name}</strong>
            <ServiceStatusBadge active={service.isActive} />
            <ModeBadge mode={service.validationMode} />
          </div>
          <p>
            Responsable : <b>{fullName(validators?.primaryManager ?? service.primaryManager)}</b>
            <span aria-hidden="true">·</span>
            {activeBackups.length}/{backups.length} valideur{backups.length > 1 ? 's' : ''} actif{activeBackups.length > 1 ? 's' : ''}
          </p>
        </div>

        <div className="rh-validator-service-card__end">
          <div className="rh-validator-avatar-stack" aria-hidden="true">
            {backups.slice(0, 4).map((entry) => <UserAvatar key={entry.id} user={entry.validator} size="small" />)}
            {backups.length > 4 && <span className="rh-validator-avatar-stack__more">+{backups.length - 4}</span>}
          </div>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={18} />
        </div>
      </button>

      {expanded && (
        <div className="rh-validator-service-card__expanded">
          <div className="rh-validator-service-card__section-title">
            <span>VALIDEURS DE SECOURS</span>
            {supported && service.isActive && (
              <button type="button" onClick={onAdd}><Icon name="plus" size={15} /> Ajouter un valideur</button>
            )}
          </div>

          {!supported ? (
            <div className="rh-validator-service-card__unsupported">
              <Icon name="info" size={18} />
              <div>
                <strong>Aucun valideur de secours à configurer</strong>
                <p>Ce service utilise le circuit « {validationModeMeta(service.validationMode).label} ». Les valideurs de secours sont disponibles uniquement avec le circuit Responsable + relais.</p>
              </div>
            </div>
          ) : backups.length === 0 ? (
            <div className="rh-validator-service-card__empty">
              <Icon name="users" size={22} />
              <strong>Aucun valideur de secours</strong>
              <span>Ajoutez un Responsable de service, un RH ou le Directeur comme solution de secours.</span>
            </div>
          ) : (
            <div className="rh-validator-backup-list">
              {backups.map((entry) => {
                const user = entry.validator
                const operational = Boolean(entry.isActive && user?.isActive && ELIGIBLE_VALIDATOR_ROLES.includes(user?.role))
                return (
                  <div className="rh-validator-backup-row" key={entry.id}>
                    <div className="rh-validator-backup-row__identity">
                      <UserAvatar user={user} size="normal" />
                      <div>
                        <strong>{fullName(user)}</strong>
                        <span>{roleLabel(user?.role)}</span>
                      </div>
                    </div>

                    <span className={`rh-validator-badge rh-validator-badge--${operational ? 'active' : entry.isActive ? 'danger' : 'inactive'}`}>
                      <i /> {operational ? 'Actif' : entry.isActive ? 'Inopérant' : 'Inactif'}
                    </span>

                    <button
                      type="button"
                      className={`rh-validator-toggle-action rh-validator-toggle-action--${entry.isActive ? 'disable' : 'enable'}`}
                      onClick={() => onAction(entry)}
                      disabled={!entry.isActive && !user?.isActive}
                    >
                      <Icon name={entry.isActive ? 'eye' : 'check'} size={14} />
                      {entry.isActive ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function RhValidatorsPage() {
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const [tab, setTab] = useState('validators')
  const [servicePage, setServicePage] = useState(1)
  const [replacementPage, setReplacementPage] = useState(1)
  const [replacementFilter, setReplacementFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, services: [], users: [], replacements: [] })
  const [expandedServiceId, setExpandedServiceId] = useState(null)
  const [backupDrawerService, setBackupDrawerService] = useState(null)
  const [replacementDrawer, setReplacementDrawer] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [busyKey, setBusyKey] = useState('')

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const [services, users, replacements] = await Promise.all([
        getRhValidatorServices(),
        getRhValidatorUsers(),
        getRhValidatorReplacements(),
      ])

      const serviceValidatorResults = await Promise.all(
        services.map(async (service) => {
          try {
            const validators = await getRhServiceValidators(service.id)
            return { service, validators }
          } catch {
            return { service, validators: null }
          }
        }),
      )

      setState({ loading: false, error: false, services: serviceValidatorResults, users, replacements })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
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

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(''), 4200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    setServicePage(1)
    setReplacementPage(1)
  }, [query, tab, replacementFilter])

  const visibleServices = useMemo(
    () => state.services.filter(({ service, validators }) => matchesSearch([
      service.name,
      service.externalCompanyName,
      validationModeMeta(service.validationMode).label,
      fullName(validators?.primaryManager ?? service.primaryManager),
      ...(validators?.backupValidators ?? []).flatMap((entry) => [fullName(entry.validator), entry.validator?.email, roleLabel(entry.validator?.role)]),
    ], query)),
    [query, state.services],
  )

  const replacementCounts = useMemo(() => {
    const counts = { all: 0, current: 0, planned: 0, finished: 0, disabled: 0 }
    state.replacements.forEach((item) => {
      const id = replacementStatus(item).id
      counts.all += 1
      if (id === 'disabled') counts.disabled += 1
      else counts[id] += 1
    })
    return counts
  }, [state.replacements])

  const visibleReplacements = useMemo(
    () => state.replacements.filter((item) => {
      const status = replacementStatus(item)
      const filterMatch = replacementFilter === 'all' || status.id === replacementFilter
      if (!filterMatch) return false
      return matchesSearch([
        fullName(item.employee),
        item.employee?.email,
        item.employee?.service?.name,
        fullName(item.replacementValidator),
        item.replacementValidator?.email,
        roleLabel(item.replacementValidator?.role),
        item.startDate,
        item.endDate,
        item.reason,
        status.label,
      ], query)
    }),
    [query, replacementFilter, state.replacements],
  )

  const serviceTotalPages = Math.max(1, Math.ceil(visibleServices.length / PAGE_SIZE))
  const safeServicePage = Math.min(servicePage, serviceTotalPages)
  const paginatedServices = visibleServices.slice((safeServicePage - 1) * PAGE_SIZE, safeServicePage * PAGE_SIZE)

  const replacementTotalPages = Math.max(1, Math.ceil(visibleReplacements.length / PAGE_SIZE))
  const safeReplacementPage = Math.min(replacementPage, replacementTotalPages)
  const paginatedReplacements = visibleReplacements.slice((safeReplacementPage - 1) * PAGE_SIZE, safeReplacementPage * PAGE_SIZE)

  const referenceRange = useMemo(() => {
    if (visibleReplacements.length === 0) return null
    const starts = visibleReplacements.map((item) => item.startDate).filter(Boolean).sort()
    const ends = visibleReplacements.map((item) => item.endDate).filter(Boolean).sort()
    if (!starts.length || !ends.length) return null
    return { start: starts[0], end: ends[ends.length - 1] }
  }, [visibleReplacements])

  const timelineStyle = (item) => {
    if (!referenceRange) return { '--timeline-left': '0%', '--timeline-width': '100%' }
    const start = new Date(`${referenceRange.start}T12:00:00Z`).getTime()
    const end = new Date(`${referenceRange.end}T12:00:00Z`).getTime()
    const itemStart = new Date(`${item.startDate}T12:00:00Z`).getTime()
    const itemEnd = new Date(`${item.endDate}T12:00:00Z`).getTime()
    const span = Math.max(86400000, end - start + 86400000)
    const left = Math.max(0, Math.min(100, ((itemStart - start) / span) * 100))
    const width = Math.max(5, Math.min(100 - left, ((itemEnd - itemStart + 86400000) / span) * 100))
    return { '--timeline-left': `${left}%`, '--timeline-width': `${width}%` }
  }

  const changeBackup = async (service, entry) => {
    if (busyKey) return
    const key = `${service.id}-${entry.validatorId}`
    setBusyKey(key)
    try {
      if (entry.isActive) await disableRhBackupValidator(service.id, entry.validatorId)
      else await enableRhBackupValidator(service.id, entry.validatorId)
      setFeedback(entry.isActive ? 'Valideur de secours désactivé.' : 'Valideur de secours réactivé.')
      await load({ silent: true })
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusyKey('')
    }
  }

  const afterBackupSaved = async (message) => {
    setBackupDrawerService(null)
    setFeedback(message)
    await load({ silent: true })
  }

  const afterReplacementSaved = async (message) => {
    setReplacementDrawer(null)
    setFeedback(message)
    await load({ silent: true })
  }

  return (
    <PageContainer className="rh-validators-page">
      {feedback && <div className="rh-validators-feedback"><Icon name="info" size={16} />{feedback}</div>}

      <div className="rh-validators-toolbar">
        <div className="rh-validators-tabs" role="tablist" aria-label="Gestion des valideurs">
          <button type="button" role="tab" aria-selected={tab === 'validators'} className={tab === 'validators' ? 'is-active' : ''} onClick={() => setTab('validators')}>
            <Icon name="shield" size={17} /> Valideurs de secours
          </button>
          <button type="button" role="tab" aria-selected={tab === 'replacements'} className={tab === 'replacements' ? 'is-active' : ''} onClick={() => setTab('replacements')}>
            <Icon name="refresh" size={17} /> Valideurs temporaires
          </button>
        </div>

        {tab === 'replacements' && (
          <button type="button" className="rh-validators-new-replacement" onClick={() => setReplacementDrawer({ mode: 'create', item: null })}>
            <Icon name="plus" size={17} /> Nouveau valideur temporaire
          </button>
        )}
      </div>

      {state.loading ? (
        <div className="rh-validators-state"><div className="rh-validators-spinner" /><strong>Chargement de la configuration…</strong></div>
      ) : state.error ? (
        <div className="rh-validators-state rh-validators-state--error"><Icon name="alert" size={26} /><strong>Impossible de charger la configuration des valideurs.</strong><button type="button" onClick={() => load()}>Réessayer</button></div>
      ) : tab === 'validators' ? (
        <section className="rh-validator-services-section">
          {paginatedServices.length === 0 ? (
            <div className="rh-validators-state"><Icon name="users" size={28} /><strong>Aucun service à afficher</strong><span>Modifiez la recherche pour afficher d’autres services.</span></div>
          ) : (
            <div className="rh-validator-service-list">
              {paginatedServices.map((item) => (
                <ServiceAccordion
                  key={item.service.id}
                  item={item}
                  expanded={String(expandedServiceId) === String(item.service.id)}
                  onToggle={() => setExpandedServiceId((current) => String(current) === String(item.service.id) ? null : item.service.id)}
                  onAction={(entry) => changeBackup(item.service, entry)}
                  onAdd={() => setBackupDrawerService(item)}
                />
              ))}
            </div>
          )}

          <PaginationBar page={safeServicePage} pageSize={PAGE_SIZE} totalItems={visibleServices.length} onPageChange={setServicePage} />
        </section>
      ) : (
        <section className="rh-validator-replacements-section">
          <div className="rh-validator-replacements-meta">
            <div className="rh-validator-replacement-filters" role="tablist" aria-label="Filtres des valideurs temporaires">
              {REPLACEMENT_FILTERS.map((filter) => (
                <button key={filter.id} type="button" role="tab" aria-selected={replacementFilter === filter.id} className={replacementFilter === filter.id ? 'is-active' : ''} onClick={() => setReplacementFilter(filter.id)}>
                  {filter.label}<span>{replacementCounts[filter.id]}</span>
                </button>
              ))}
            </div>
            {referenceRange && <span className="rh-validator-reference-period">Période de référence : {formatDateLong(referenceRange.start)} → {formatDateLong(referenceRange.end)}</span>}
          </div>

          {paginatedReplacements.length === 0 ? (
            <div className="rh-validators-state"><Icon name="refresh" size={28} /><strong>Aucun valideur temporaire</strong><span>Les valideurs temporaires correspondant aux critères apparaîtront ici.</span></div>
          ) : (
            <div className="rh-validator-replacement-table">
              <div className="rh-validator-replacement-row rh-validator-replacement-row--head">
                <span>Collaborateur</span>
                <span>Valideur temporaire</span>
                <span>Période</span>
                <span>Timeline</span>
                <span>Motif</span>
                <span>Statut</span>
              </div>
              {paginatedReplacements.map((item) => (
                <button type="button" className="rh-validator-replacement-row rh-validator-replacement-row--body" key={item.id} onClick={() => setReplacementDrawer({ mode: 'detail', item })}>
                  <span className="rh-validator-replacement-person"><UserAvatar user={item.employee} size="normal" /><span><strong>{fullName(item.employee)}</strong><small>{item.employee?.service?.name ?? 'Collaborateur interne'}</small></span></span>
                  <span className="rh-validator-replacement-person"><UserAvatar user={item.replacementValidator} size="normal" /><span><strong>{fullName(item.replacementValidator)}</strong><small>{roleLabel(item.replacementValidator?.role)}</small></span></span>
                  <span className="rh-validator-replacement-period"><strong>{formatDate(item.startDate)}</strong><small>→ {formatDate(item.endDate)}</small></span>
                  <span className="rh-validator-timeline" style={timelineStyle(item)}><i /></span>
                  <span className="rh-validator-replacement-reason">{item.reason || '—'}</span>
                  <ReplacementStatusBadge item={item} />
                </button>
              ))}
            </div>
          )}

          <PaginationBar page={safeReplacementPage} pageSize={PAGE_SIZE} totalItems={visibleReplacements.length} onPageChange={setReplacementPage} />
        </section>
      )}

      {backupDrawerService && (
        <BackupValidatorDrawer
          service={backupDrawerService.service}
          users={state.users}
          validatorData={backupDrawerService.validators}
          onClose={() => setBackupDrawerService(null)}
          onSaved={afterBackupSaved}
        />
      )}

      {replacementDrawer && (
        <ReplacementDrawer
          mode={replacementDrawer.mode}
          item={replacementDrawer.item}
          users={state.users}
          onClose={() => setReplacementDrawer(null)}
          onSaved={afterReplacementSaved}
        />
      )}
    </PageContainer>
  )
}
