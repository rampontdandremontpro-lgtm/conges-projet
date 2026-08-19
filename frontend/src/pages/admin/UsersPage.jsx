import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  getAdminUsersData,
  updateAdminUser,
} from '@/services/adminUsers'

import '@/styles/admin/users.css'

const PAGE_SIZE = 8

const ROLE_LABELS = {
  COLLABORATEUR: 'Collaborateur',
  RESPONSABLE_SERVICE: 'Responsable de service',
  RH: 'RH',
  DIRECTEUR: 'Directeur',
  ADMIN: 'Administrateur',
}

const ROLE_TONES = {
  COLLABORATEUR: 'neutral',
  RESPONSABLE_SERVICE: 'blue',
  RH: 'violet',
  DIRECTEUR: 'navy',
  ADMIN: 'orange',
}

const EMPTY_FORM = {
  nom: '',
  prenom: '',
  email: '',
  role: 'COLLABORATEUR',
  employmentType: 'INTERNE',
  serviceId: '',
  hireDate: '',
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
  return message || error?.message || 'Une erreur est survenue.'
}

function fullName(user) {
  return `${user?.prenom ?? ''} ${user?.nom ?? ''}`.trim() || 'Utilisateur'
}

function initials(user) {
  const first = String(user?.prenom ?? '').trim().charAt(0)
  const last = String(user?.nom ?? '').trim().charAt(0)
  return `${first}${last}`.toUpperCase() || 'U'
}

function formatDate(value) {
  if (!value) return 'Non renseignée'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

function formFromUser(user) {
  if (!user) return { ...EMPTY_FORM }
  return {
    nom: user.nom ?? '',
    prenom: user.prenom ?? '',
    email: user.email ?? '',
    role: user.role ?? 'COLLABORATEUR',
    employmentType: user.employmentType ?? 'INTERNE',
    serviceId: user.serviceId ? String(user.serviceId) : '',
    hireDate: user.hireDate ? String(user.hireDate).slice(0, 10) : '',
  }
}

function UserDrawer({ mode, user, services, onClose, onSaved, onEdit }) {
  const isCreate = mode === 'create'
  const isView = mode === 'view'
  const [form, setForm] = useState(() => formFromUser(user))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    setForm(formFromUser(user))
    setFeedback('')
  }, [user, mode])

  const eligibleServices = useMemo(
    () => services.filter((service) =>
      service.serviceType === form.employmentType &&
      (service.isActive || String(service.id) === String(user?.serviceId ?? '')),
    ),
    [form.employmentType, services, user?.serviceId],
  )

  const setValue = (key, value) => {
    setFeedback('')
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'employmentType') {
        const selected = services.find((service) => String(service.id) === String(current.serviceId))
        if (selected && selected.serviceType !== value) next.serviceId = ''
      }
      if (key === 'role' && value === 'ADMIN') {
        next.employmentType = 'INTERNE'
        next.serviceId = ''
      }
      return next
    })
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy || isView) return

    if (form.nom.trim().length < 2 || form.prenom.trim().length < 2) {
      setFeedback('Le nom et le prénom doivent contenir au moins 2 caractères.')
      return
    }
    if (!form.email.trim()) {
      setFeedback('L’adresse e-mail est obligatoire.')
      return
    }
    if (form.role !== 'ADMIN' && !form.serviceId) {
      setFeedback('Un service est obligatoire pour ce rôle.')
      return
    }

    const payload = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      email: form.email.trim(),
      role: form.role,
      employmentType: form.role === 'ADMIN' ? 'INTERNE' : form.employmentType,
      ...(form.hireDate ? { hireDate: form.hireDate } : {}),
    }

    if (form.role === 'ADMIN') {
      if (!isCreate) payload.serviceId = null
    } else {
      payload.serviceId = Number(form.serviceId)
    }

    setBusy(true)
    try {
      if (isCreate) {
        const created = await createAdminUser(payload)
        onSaved(created, `${fullName(created)} a été créé.`)
      } else {
        const updated = await updateAdminUser(user.id, payload)
        onSaved(updated, `${fullName(updated)} a été modifié.`)
      }
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-users-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="admin-users-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-users-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-users-drawer__head">
          <div className="admin-users-drawer__identity">
            <span className={`admin-users-avatar admin-users-avatar--${ROLE_TONES[user?.role] ?? 'blue'}`}>
              {isCreate ? <Icon name="plus" size={20} /> : initials(user)}
            </span>
            <div>
              <small>{isCreate ? 'NOUVEAU COMPTE' : isView ? 'FICHE UTILISATEUR' : 'MODIFICATION'}</small>
              <h2 id="admin-users-drawer-title">{isCreate ? 'Nouvel utilisateur' : fullName(user)}</h2>
              <p>{isCreate ? 'Créez un nouvel accès à GMES.' : user?.email}</p>
            </div>
          </div>
          <button type="button" className="admin-users-close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        {isView ? (
          <div className="admin-users-view">
            <section className="admin-users-view__section">
              <div className="admin-users-section-title"><span>1</span><div><h3>Informations personnelles</h3><p>Identité et coordonnées du compte.</p></div></div>
              <dl className="admin-users-details-grid">
                <div><dt>Prénom</dt><dd>{user.prenom}</dd></div>
                <div><dt>Nom</dt><dd>{user.nom}</dd></div>
                <div className="is-wide"><dt>E-mail</dt><dd>{user.email}</dd></div>
                <div className="is-wide"><dt>Date d’entrée</dt><dd>{formatDate(user.hireDate)}</dd></div>
              </dl>
            </section>

            <section className="admin-users-view__section">
              <div className="admin-users-section-title"><span>2</span><div><h3>Accès et rattachement</h3><p>Rôle et périmètre dans l’application.</p></div></div>
              <dl className="admin-users-details-grid">
                <div><dt>Rôle</dt><dd><span className={`admin-users-role admin-users-role--${ROLE_TONES[user.role] ?? 'neutral'}`}>{ROLE_LABELS[user.role] ?? user.role}</span></dd></div>
                <div><dt>Type</dt><dd>{user.employmentType === 'EXTERNE' ? 'Externe' : 'Interne'}</dd></div>
                <div className="is-wide"><dt>Service</dt><dd>{user.service?.name ?? 'Aucun service'}</dd></div>
              </dl>
            </section>

            <section className="admin-users-view__section">
              <div className="admin-users-section-title"><span>3</span><div><h3>État du compte</h3><p>Disponibilité de l’accès à GMES.</p></div></div>
              <div className={`admin-users-account-state ${user.isActive ? 'is-active' : 'is-inactive'}`}>
                <span className="admin-users-account-state__dot" />
                <div><strong>{user.isActive ? 'Compte actif' : 'Compte inactif'}</strong><small>{user.isActive ? 'L’utilisateur peut se connecter à GMES.' : 'L’accès à GMES est actuellement désactivé.'}</small></div>
              </div>
            </section>

            <div className="admin-users-drawer__actions">
              <button type="button" className="admin-users-secondary" onClick={onClose}>Fermer</button>
              <button type="button" className="admin-users-primary" onClick={() => onEdit(user)}><Icon name="edit" size={16} /> Modifier</button>
            </div>
          </div>
        ) : (
          <form className="admin-users-form" onSubmit={submit}>
            <section className="admin-users-form__section">
              <div className="admin-users-section-title"><span>1</span><div><h3>Informations personnelles</h3><p>Renseignez l’identité et l’adresse de connexion.</p></div></div>
              <div className="admin-users-form__grid">
                <label><span>Prénom <b>*</b></span><input value={form.prenom} onChange={(event) => setValue('prenom', event.target.value)} maxLength="100" autoFocus /></label>
                <label><span>Nom <b>*</b></span><input value={form.nom} onChange={(event) => setValue('nom', event.target.value)} maxLength="100" /></label>
                <label className="is-wide"><span>E-mail <b>*</b></span><input type="email" value={form.email} onChange={(event) => setValue('email', event.target.value)} maxLength="190" placeholder="prenom.nom@gmes.fr" /></label>
                <label className="is-wide"><span>Date d’entrée</span><input type="date" value={form.hireDate} onChange={(event) => setValue('hireDate', event.target.value)} /></label>
              </div>
            </section>

            <section className="admin-users-form__section">
              <div className="admin-users-section-title"><span>2</span><div><h3>Accès et rattachement</h3><p>Définissez le rôle et le service de l’utilisateur.</p></div></div>
              <div className="admin-users-form__grid">
                <label className="is-wide"><span>Rôle <b>*</b></span><select value={form.role} onChange={(event) => setValue('role', event.target.value)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                {form.role !== 'ADMIN' && (
                  <>
                    <label><span>Type <b>*</b></span><select value={form.employmentType} onChange={(event) => setValue('employmentType', event.target.value)}><option value="INTERNE">Interne</option><option value="EXTERNE">Externe</option></select></label>
                    <label><span>Service <b>*</b></span><select value={form.serviceId} onChange={(event) => setValue('serviceId', event.target.value)}><option value="">Sélectionner…</option>{eligibleServices.map((service) => <option key={service.id} value={service.id}>{service.name}{service.externalCompanyName ? ` — ${service.externalCompanyName}` : ''}{service.isActive ? '' : ' (inactif)'}</option>)}</select></label>
                  </>
                )}
                {form.role === 'ADMIN' && <div className="admin-users-admin-note is-wide"><Icon name="info" size={17} /><span>Un administrateur n’est rattaché à aucun service métier.</span></div>}
              </div>
            </section>

            <section className="admin-users-form__section admin-users-form__section--account">
              <div className="admin-users-section-title"><span>3</span><div><h3>Compte</h3><p>{isCreate ? 'Le compte sera créé actif et prêt à recevoir son accès.' : 'Le statut actif/inactif se gère depuis la liste des utilisateurs.'}</p></div></div>
              <div className="admin-users-account-state is-active"><span className="admin-users-account-state__dot" /><div><strong>{isCreate ? 'Compte actif à la création' : user?.isActive ? 'Compte actuellement actif' : 'Compte actuellement inactif'}</strong><small>La désactivation reste une action séparée pour éviter les changements accidentels.</small></div></div>
            </section>

            {feedback && <div className="admin-users-form__feedback"><Icon name="alert" size={16} /> {feedback}</div>}

            <div className="admin-users-drawer__actions">
              <button type="button" className="admin-users-secondary" onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-users-primary" disabled={busy}><Icon name={isCreate ? 'plus' : 'check'} size={16} /> {busy ? 'Enregistrement…' : isCreate ? 'Créer l’utilisateur' : 'Enregistrer les modifications'}</button>
            </div>
          </form>
        )}
      </aside>
    </div>
  )
}

function StatusConfirm({ user, busy, onCancel, onConfirm }) {
  const nextActive = !user.isActive
  return (
    <div className="admin-users-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <div className="admin-users-confirm" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <span className={`admin-users-confirm__icon ${nextActive ? 'is-enable' : 'is-disable'}`}><Icon name={nextActive ? 'refresh' : 'ban'} size={22} /></span>
        <h3>{nextActive ? 'Réactiver ce compte ?' : 'Désactiver ce compte ?'}</h3>
        <p>{nextActive ? `${fullName(user)} pourra de nouveau accéder à GMES.` : `${fullName(user)} ne pourra plus se connecter tant que son compte n’est pas réactivé.`}</p>
        <div><button type="button" onClick={onCancel}>Annuler</button><button type="button" className={nextActive ? 'is-enable' : 'is-disable'} onClick={onConfirm} disabled={busy}>{busy ? 'Traitement…' : nextActive ? 'Réactiver' : 'Désactiver'}</button></div>
      </div>
    </div>
  )
}

export function AdminUsersPage() {
  const { user: authenticatedUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState({ loading: true, error: false, users: [], services: [] })
  const [filters, setFilters] = useState({ role: 'ALL', serviceId: 'ALL', type: 'ALL', status: 'ALL' })
  const [drawer, setDrawer] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getAdminUsersData()
      setState({ loading: false, error: false, users: data.users, services: data.services })
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
    const timer = window.setTimeout(() => setFeedback(null), 4200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const query = normalize(searchParams.get('q'))
  const filtered = useMemo(() => state.users.filter((item) => {
    if (filters.role !== 'ALL' && item.role !== filters.role) return false
    if (filters.serviceId !== 'ALL' && String(item.serviceId ?? '') !== filters.serviceId) return false
    if (filters.type !== 'ALL' && item.employmentType !== filters.type) return false
    if (filters.status === 'ACTIVE' && !item.isActive) return false
    if (filters.status === 'INACTIVE' && item.isActive) return false
    if (!query) return true
    const searchable = `${item.prenom} ${item.nom} ${item.email} ${ROLE_LABELS[item.role] ?? item.role} ${item.service?.name ?? ''} ${item.employmentType === 'EXTERNE' ? 'externe' : 'interne'} ${item.isActive ? 'actif' : 'inactif'}`
    return normalize(searchable).includes(query)
  }), [filters, query, state.users])

  useEffect(() => setPage(1), [filters, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const visibleUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resetFilters = () => {
    setFilters({ role: 'ALL', serviceId: 'ALL', type: 'ALL', status: 'ALL' })
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
  }

  const handleSaved = async (savedUser, message) => {
    setDrawer(null)
    setFeedback({ kind: 'success', message })
    await load({ silent: true })
    setDrawer({ mode: 'view', user: savedUser })
  }

  const confirmStatus = async () => {
    if (!statusTarget || statusBusy) return
    setStatusBusy(true)
    try {
      const updated = statusTarget.isActive ? await disableAdminUser(statusTarget.id) : await enableAdminUser(statusTarget.id)
      setFeedback({ kind: 'success', message: `${fullName(updated)} a été ${updated.isActive ? 'réactivé' : 'désactivé'}.` })
      setStatusTarget(null)
      await load({ silent: true })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
      setStatusTarget(null)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <PageContainer className="admin-users-page">
      {feedback && <div className={`admin-users-feedback admin-users-feedback--${feedback.kind}`} role="status"><Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} /> {feedback.message}</div>}

      <div className="admin-users-heading">
        <div className="admin-users-count"><p>{state.users.length} compte{state.users.length > 1 ? 's' : ''} enregistré{state.users.length > 1 ? 's' : ''}</p></div>
        <button type="button" className="admin-users-new" onClick={() => setDrawer({ mode: 'create', user: null })}><Icon name="plus" size={17} /> Nouvel utilisateur</button>
      </div>

      <section className="admin-users-filters" aria-label="Filtres utilisateurs">
        <label><span>RÔLE</span><select value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}><option value="ALL">Tous les rôles</option>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>SERVICE</span><select value={filters.serviceId} onChange={(event) => setFilters((current) => ({ ...current, serviceId: event.target.value }))}><option value="ALL">Tous les services</option>{state.services.map((service) => <option key={service.id} value={service.id}>{service.name}{service.isActive ? '' : ' (inactif)'}</option>)}</select></label>
        <label><span>TYPE</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="ALL">Tous les types</option><option value="INTERNE">Interne</option><option value="EXTERNE">Externe</option></select></label>
        <label><span>STATUT</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="ALL">Tous les statuts</option><option value="ACTIVE">Actifs</option><option value="INACTIVE">Inactifs</option></select></label>
        <button type="button" className="admin-users-reset" onClick={resetFilters}><Icon name="refresh" size={15} /> Réinitialiser</button>
      </section>

      <section className="admin-users-card">
        {state.loading ? (
          <div className="admin-users-state"><span className="admin-users-spinner" /><strong>Chargement des utilisateurs…</strong></div>
        ) : state.error ? (
          <div className="admin-users-state admin-users-state--error"><Icon name="alert" size={24} /><strong>Impossible de charger les utilisateurs.</strong><button type="button" onClick={() => load()}>Réessayer</button></div>
        ) : filtered.length === 0 ? (
          <div className="admin-users-state"><Icon name="users" size={28} /><strong>Aucun utilisateur à afficher</strong><span>Modifiez les filtres ou la recherche pour afficher d’autres comptes.</span></div>
        ) : (
          <>
            <div className="admin-users-table-wrap">
              <div className="admin-users-table">
                <div className="admin-users-row admin-users-row--head"><span>Utilisateur</span><span>Email</span><span>Rôle</span><span>Service</span><span>Type</span><span>Statut</span><span>Actions</span></div>
                {visibleUsers.map((item) => {
                  const isSelf = String(item.id) === String(authenticatedUser?.id)
                  return (
                    <div key={item.id} className={`admin-users-row admin-users-row--body${item.isActive ? '' : ' is-inactive'}`} role="button" tabIndex="0" onClick={() => setDrawer({ mode: 'view', user: item })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDrawer({ mode: 'view', user: item }) } }}>
                      <div className="admin-users-name"><span className={`admin-users-avatar admin-users-avatar--${ROLE_TONES[item.role] ?? 'neutral'}`}>{initials(item)}</span><div><strong>{fullName(item)}</strong><small>{item.hireDate ? `Depuis le ${formatDate(item.hireDate)}` : 'Date d’entrée non renseignée'}</small></div></div>
                      <span className="admin-users-email" title={item.email}>{item.email}</span>
                      <span className={`admin-users-role admin-users-role--${ROLE_TONES[item.role] ?? 'neutral'}`}>{ROLE_LABELS[item.role] ?? item.role}</span>
                      <span className="admin-users-service" title={item.service?.name ?? ''}>{item.service?.name ?? '—'}</span>
                      <span className={`admin-users-type ${item.employmentType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>{item.employmentType === 'EXTERNE' ? 'Externe' : 'Interne'}</span>
                      <span className={`admin-users-status ${item.isActive ? 'is-active' : 'is-inactive'}`}>{item.isActive ? 'Actif' : 'Inactif'}</span>
                      <div className="admin-users-actions">
                        <button type="button" title="Modifier" aria-label={`Modifier ${fullName(item)}`} onClick={(event) => { event.stopPropagation(); setDrawer({ mode: 'edit', user: item }) }}><Icon name="edit" size={16} /></button>
                        <button type="button" className={item.isActive ? 'is-disable' : 'is-enable'} disabled={isSelf} title={isSelf ? 'Votre propre compte ne peut pas être désactivé ici' : item.isActive ? 'Désactiver' : 'Réactiver'} aria-label={item.isActive ? `Désactiver ${fullName(item)}` : `Réactiver ${fullName(item)}`} onClick={(event) => { event.stopPropagation(); if (!isSelf) setStatusTarget(item) }}><Icon name={item.isActive ? 'ban' : 'refresh'} size={16} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="admin-users-footer"><span>{filtered.length} utilisateur{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}</span><PaginationBar page={page} pageSize={PAGE_SIZE} totalItems={filtered.length} onPageChange={setPage} /></div>
          </>
        )}
      </section>

      {drawer && <UserDrawer mode={drawer.mode} user={drawer.user} services={state.services} onClose={() => setDrawer(null)} onEdit={(selected) => setDrawer({ mode: 'edit', user: selected })} onSaved={handleSaved} />}
      {statusTarget && <StatusConfirm user={statusTarget} busy={statusBusy} onCancel={() => setStatusTarget(null)} onConfirm={confirmStatus} />}
    </PageContainer>
  )
}
