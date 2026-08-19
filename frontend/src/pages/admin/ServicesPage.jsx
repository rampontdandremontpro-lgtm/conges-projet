import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  createAdminService,
  disableAdminService,
  enableAdminService,
  getAdminServicesData,
  updateAdminService,
} from '@/services/admin/adminServices'

import '@/styles/admin/services.css'

const PAGE_SIZE = 8

const TYPE_LABELS = {
  INTERNE: 'Interne',
  EXTERNE: 'Externe',
}

const VALIDATION_LABELS = {
  RESPONSABLE_PUIS_RELAIS: 'Responsable puis relais',
  DIRECTEUR_ET_RH: 'Directeur + RH',
  DIRECTEUR_SEUL: 'Directeur seul',
  SANS_VALIDATION: 'Sans validation',
}

const EMPTY_FORM = {
  name: '',
  serviceType: 'INTERNE',
  externalCompanyName: '',
  primaryManagerId: '',
  validationMode: 'DIRECTEUR_ET_RH',
  takeoverDelayDays: '7',
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

function personName(user) {
  return `${user?.prenom ?? ''} ${user?.nom ?? ''}`.trim() || 'Utilisateur'
}

function serviceForm(service) {
  if (!service) return { ...EMPTY_FORM }
  return {
    name: service.name ?? '',
    serviceType: service.serviceType ?? 'INTERNE',
    externalCompanyName: service.externalCompanyName ?? '',
    primaryManagerId: service.primaryManagerId ? String(service.primaryManagerId) : '',
    validationMode: service.validationMode ?? 'DIRECTEUR_ET_RH',
    takeoverDelayDays: String(service.takeoverDelayDays ?? 7),
  }
}

function ServiceDrawer({ mode, service, users, counts, onClose, onSaved, onEdit }) {
  const navigate = useNavigate()
  const isCreate = mode === 'create'
  const isView = mode === 'view'
  const [form, setForm] = useState(() => serviceForm(service))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    setForm(serviceForm(service))
    setFeedback('')
  }, [mode, service])

  const eligibleManagers = useMemo(() => {
    if (!service?.id) return []
    return users.filter((user) =>
      String(user.id) === String(service.primaryManagerId ?? '') ||
      (
        user.isActive &&
        user.role === 'RESPONSABLE_SERVICE' &&
        String(user.serviceId ?? '') === String(service.id)
      ),
    )
  }, [service?.id, service?.primaryManagerId, users])

  const setValue = (key, value) => {
    setFeedback('')
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'serviceType' && value === 'EXTERNE') {
        next.primaryManagerId = ''
        next.validationMode = 'DIRECTEUR_ET_RH'
      }
      if (key === 'validationMode' && value !== 'RESPONSABLE_PUIS_RELAIS') {
        next.takeoverDelayDays = current.takeoverDelayDays || '7'
      }
      return next
    })
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy || isView) return

    if (form.name.trim().length < 2) {
      setFeedback('Le nom du service doit contenir au moins 2 caractères.')
      return
    }
    if (form.serviceType === 'EXTERNE' && form.externalCompanyName.trim().length < 2) {
      setFeedback('Le nom de l’entreprise externe est obligatoire.')
      return
    }
    if (!isCreate && form.validationMode === 'RESPONSABLE_PUIS_RELAIS' && !form.primaryManagerId) {
      setFeedback('Un Responsable principal est obligatoire pour ce circuit de validation.')
      return
    }

    const payload = {
      name: form.name.trim(),
      serviceType: form.serviceType,
      externalCompanyName: form.serviceType === 'EXTERNE' ? form.externalCompanyName.trim() : undefined,
      validationMode: form.serviceType === 'EXTERNE' ? 'DIRECTEUR_ET_RH' : form.validationMode,
    }

    if (!isCreate) {
      if (form.serviceType === 'EXTERNE') {
        payload.primaryManagerId = null
      } else if (String(form.primaryManagerId || '') !== String(service.primaryManagerId || '')) {
        payload.primaryManagerId = form.primaryManagerId ? Number(form.primaryManagerId) : null
      }
      if (payload.validationMode === 'RESPONSABLE_PUIS_RELAIS') {
        payload.takeoverDelayDays = Number(form.takeoverDelayDays || 7)
      }
    }

    setBusy(true)
    try {
      if (isCreate) {
        const created = await createAdminService(payload)
        onSaved(created, `Le service « ${created.name} » a été créé.`)
      } else {
        const updated = await updateAdminService(service.id, payload)
        onSaved(updated, `Le service « ${updated.name} » a été modifié.`)
      }
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const activeCount = counts?.active ?? 0
  const totalCount = counts?.total ?? 0
  const presenceLabel = service?.hasMinimumPresenceRule
    ? `${service.minimumPresence ?? 0} personne${Number(service.minimumPresence ?? 0) > 1 ? 's' : ''}`
    : 'Aucune règle'

  return (
    <div className="admin-services-overlay" role="presentation" onMouseDown={onClose}>
      <aside className="admin-services-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-services-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="admin-services-drawer__head">
          <div className="admin-services-drawer__identity">
            <span className={`admin-services-symbol ${service?.serviceType === 'EXTERNE' || form.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>
              <Icon name={isCreate ? 'plus' : 'building'} size={20} />
            </span>
            <div>
              <small>{isCreate ? 'NOUVEAU SERVICE' : isView ? 'FICHE SERVICE' : 'MODIFICATION'}</small>
              <h2 id="admin-services-drawer-title">{isCreate ? 'Nouveau service' : service?.name}</h2>
              <p>{isCreate ? 'Créez un nouveau périmètre dans GMES.' : service?.externalCompanyName || TYPE_LABELS[service?.serviceType]}</p>
            </div>
          </div>
          <button type="button" className="admin-services-close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        {isView ? (
          <div className="admin-services-view">
            <section className="admin-services-section">
              <div className="admin-services-section-title"><span>1</span><div><h3>Informations</h3><p>Identité et périmètre du service.</p></div></div>
              <dl className="admin-services-details-grid">
                <div className="is-wide"><dt>Nom du service</dt><dd>{service.name}</dd></div>
                <div><dt>Type</dt><dd><span className={`admin-services-type ${service.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>{TYPE_LABELS[service.serviceType] ?? service.serviceType}</span></dd></div>
                <div><dt>Statut</dt><dd><span className={`admin-services-status ${service.isActive ? 'is-active' : 'is-inactive'}`}>{service.isActive ? 'Actif' : 'Inactif'}</span></dd></div>
                {service.serviceType === 'EXTERNE' && <div className="is-wide"><dt>Entreprise externe</dt><dd>{service.externalCompanyName || 'Non renseignée'}</dd></div>}
                <div><dt>Effectif actif</dt><dd>{activeCount}</dd></div>
                <div><dt>Effectif total</dt><dd>{totalCount}</dd></div>
              </dl>
            </section>

            <section className="admin-services-section">
              <div className="admin-services-section-title"><span>2</span><div><h3>Responsable</h3><p>Responsable principal actuellement configuré.</p></div></div>
              {service.serviceType === 'EXTERNE' ? (
                <div className="admin-services-info-box"><Icon name="info" size={17} /><span>Les services externes ne possèdent pas de Responsable principal dans GMES.</span></div>
              ) : service.primaryManager ? (
                <div className="admin-services-manager-card"><span>{personName(service.primaryManager).split(' ').map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase()}</span><div><strong>{personName(service.primaryManager)}</strong><small>{service.primaryManager.email}</small></div></div>
              ) : (
                <div className="admin-services-warning-box"><Icon name="alert" size={17} /><div><strong>Aucun Responsable principal</strong><small>Affectez d’abord un Responsable de service via Utilisateurs, puis sélectionnez-le en modification.</small></div></div>
              )}
            </section>

            <section className="admin-services-section">
              <div className="admin-services-section-title"><span>3</span><div><h3>Validation</h3><p>Circuit métier appliqué aux demandes de ce service.</p></div></div>
              <dl className="admin-services-details-grid">
                <div className="is-wide"><dt>Mode de validation</dt><dd>{VALIDATION_LABELS[service.validationMode] ?? service.validationMode}</dd></div>
                {service.validationMode === 'RESPONSABLE_PUIS_RELAIS' && <div className="is-wide"><dt>Délai avant relais</dt><dd>{service.takeoverDelayDays ?? 7} jours</dd></div>}
              </dl>
              <button type="button" className="admin-services-link" onClick={() => navigate('/app/admin-validators')}><Icon name="shield" size={15} /> Gérer les valideurs</button>
            </section>

            <section className="admin-services-section">
              <div className="admin-services-section-title"><span>4</span><div><h3>Présence</h3><p>Règle minimale actuellement associée au service.</p></div></div>
              <div className={`admin-services-presence-card ${service.hasMinimumPresenceRule ? 'is-configured' : ''}`}>
                <span><Icon name="chart" size={18} /></span>
                <div><strong>{presenceLabel}</strong><small>{service.hasMinimumPresenceRule ? 'Présence minimale configurée' : 'Aucune présence minimale imposée'}</small></div>
              </div>
            </section>

            <div className="admin-services-drawer__actions">
              <button type="button" className="admin-services-secondary" onClick={onClose}>Fermer</button>
              <button type="button" className="admin-services-primary" onClick={() => onEdit(service)}><Icon name="edit" size={16} /> Modifier</button>
            </div>
          </div>
        ) : (
          <form className="admin-services-form" onSubmit={submit}>
            <section className="admin-services-section">
              <div className="admin-services-section-title"><span>1</span><div><h3>Informations</h3><p>Définissez le nom et le type du service.</p></div></div>
              <div className="admin-services-form-grid">
                <label className="is-wide"><span>Nom du service <b>*</b></span><input value={form.name} onChange={(event) => setValue('name', event.target.value)} maxLength="180" autoFocus /></label>
                <label><span>Type <b>*</b></span><select value={form.serviceType} onChange={(event) => setValue('serviceType', event.target.value)}><option value="INTERNE">Interne</option><option value="EXTERNE">Externe</option></select></label>
                {form.serviceType === 'EXTERNE' && <label><span>Entreprise externe <b>*</b></span><input value={form.externalCompanyName} onChange={(event) => setValue('externalCompanyName', event.target.value)} maxLength="180" placeholder="Nom de l’entreprise" /></label>}
              </div>
            </section>

            {isCreate ? (
              <section className="admin-services-section">
                <div className="admin-services-section-title"><span>2</span><div><h3>Configuration initiale</h3><p>Le service sera créé actif avec une configuration sûre par défaut.</p></div></div>
                <div className="admin-services-info-box"><Icon name="info" size={17} /><span>{form.serviceType === 'EXTERNE' ? 'Le circuit Directeur + RH est obligatoire pour un service externe.' : 'Le service sera créé avec le circuit Directeur + RH. Le Responsable et le circuit Responsable puis relais pourront être configurés après rattachement d’un Responsable.'}</span></div>
              </section>
            ) : (
              <>
                <section className="admin-services-section">
                  <div className="admin-services-section-title"><span>2</span><div><h3>Responsable</h3><p>Sélectionnez le Responsable principal du service.</p></div></div>
                  {form.serviceType === 'EXTERNE' ? (
                    <div className="admin-services-info-box"><Icon name="info" size={17} /><span>Un service externe ne peut pas avoir de Responsable principal.</span></div>
                  ) : (
                    <div className="admin-services-form-grid">
                      <label className="is-wide"><span>Responsable principal</span><select value={form.primaryManagerId} onChange={(event) => setValue('primaryManagerId', event.target.value)}><option value="">Aucun Responsable</option>{eligibleManagers.map((manager) => <option key={manager.id} value={manager.id}>{personName(manager)} — {manager.email}{manager.isActive ? '' : ' (inactif)'}</option>)}</select></label>
                      {eligibleManagers.length === 0 && <div className="admin-services-warning-box is-wide"><Icon name="alert" size={17} /><div><strong>Aucun Responsable éligible dans ce service</strong><small>Créez ou rattachez un utilisateur de rôle Responsable de service depuis la page Utilisateurs.</small></div></div>}
                    </div>
                  )}
                </section>

                <section className="admin-services-section">
                  <div className="admin-services-section-title"><span>3</span><div><h3>Validation</h3><p>Définissez le circuit de traitement des demandes.</p></div></div>
                  {form.serviceType === 'EXTERNE' ? (
                    <div className="admin-services-info-box"><Icon name="shield" size={17} /><span>Le circuit Directeur + RH est imposé aux services externes.</span></div>
                  ) : (
                    <div className="admin-services-form-grid">
                      <label className="is-wide"><span>Mode de validation <b>*</b></span><select value={form.validationMode} onChange={(event) => setValue('validationMode', event.target.value)}><option value="DIRECTEUR_ET_RH">Directeur + RH</option><option value="RESPONSABLE_PUIS_RELAIS">Responsable puis relais</option><option value="DIRECTEUR_SEUL">Directeur seul</option><option value="SANS_VALIDATION">Sans validation</option></select></label>
                      {form.validationMode === 'RESPONSABLE_PUIS_RELAIS' && <label className="is-wide"><span>Délai avant relais <b>*</b></span><input type="number" min="1" max="30" value={form.takeoverDelayDays} onChange={(event) => setValue('takeoverDelayDays', event.target.value)} /></label>}
                    </div>
                  )}
                </section>

                <section className="admin-services-section">
                  <div className="admin-services-section-title"><span>4</span><div><h3>Présence minimale</h3><p>Cette règle sera gérée dans la page dédiée.</p></div></div>
                  <div className="admin-services-presence-card"><span><Icon name="chart" size={18} /></span><div><strong>{service?.hasMinimumPresenceRule ? `${service.minimumPresence} personne${Number(service.minimumPresence) > 1 ? 's' : ''}` : 'Aucune règle'}</strong><small>Utilisez la page Présence minimale pour modifier cette valeur.</small></div></div>
                </section>
              </>
            )}

            {feedback && <div className="admin-services-form-feedback"><Icon name="alert" size={16} /> {feedback}</div>}

            <div className="admin-services-drawer__actions">
              <button type="button" className="admin-services-secondary" onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-services-primary" disabled={busy}><Icon name={isCreate ? 'plus' : 'check'} size={16} /> {busy ? 'Enregistrement…' : isCreate ? 'Créer le service' : 'Enregistrer les modifications'}</button>
            </div>
          </form>
        )}
      </aside>
    </div>
  )
}

function StatusConfirm({ service, busy, onCancel, onConfirm }) {
  const enable = !service.isActive
  return (
    <div className="admin-services-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <div className="admin-services-confirm" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <span className={`admin-services-confirm__icon ${enable ? 'is-enable' : 'is-disable'}`}><Icon name={enable ? 'refresh' : 'ban'} size={22} /></span>
        <h3>{enable ? 'Réactiver ce service ?' : 'Désactiver ce service ?'}</h3>
        <p>{enable ? `Le service « ${service.name} » redeviendra disponible dans GMES.` : `Le service « ${service.name} » ne pourra plus être utilisé pour de nouveaux rattachements tant qu’il n’est pas réactivé.`}</p>
        <div><button type="button" onClick={onCancel}>Annuler</button><button type="button" className={enable ? 'is-enable' : 'is-disable'} disabled={busy} onClick={onConfirm}>{busy ? 'Traitement…' : enable ? 'Réactiver' : 'Désactiver'}</button></div>
      </div>
    </div>
  )
}

export function AdminServicesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState({ loading: true, error: false, services: [], users: [] })
  const [filters, setFilters] = useState({ type: 'ALL', status: 'ALL', manager: 'ALL' })
  const [drawer, setDrawer] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const data = await getAdminServicesData()
      setState({ loading: false, error: false, services: data.services, users: data.users })
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

  useEffect(() => {
    const action = searchParams.get('action')
    const status = searchParams.get('status')
    const manager = searchParams.get('manager')
    let consumed = false

    if (action === 'create') {
      setDrawer({ mode: 'create', service: null })
      consumed = true
    }

    if (status === 'INACTIVE' || status === 'ACTIVE') {
      setFilters((current) => ({ ...current, status }))
      consumed = true
    }

    if (manager === 'WITHOUT' || manager === 'WITH') {
      setFilters((current) => ({ ...current, manager }))
      consumed = true
    }

    if (consumed) {
      const next = new URLSearchParams(searchParams)
      next.delete('action')
      next.delete('status')
      next.delete('manager')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const countsByService = useMemo(() => {
    const map = new Map()
    state.users.forEach((user) => {
      if (!user.serviceId) return
      const key = String(user.serviceId)
      const current = map.get(key) ?? { total: 0, active: 0 }
      current.total += 1
      if (user.isActive) current.active += 1
      map.set(key, current)
    })
    return map
  }, [state.users])

  const query = normalize(searchParams.get('q'))
  const filtered = useMemo(() => state.services.filter((service) => {
    if (filters.type !== 'ALL' && service.serviceType !== filters.type) return false
    if (filters.status === 'ACTIVE' && !service.isActive) return false
    if (filters.status === 'INACTIVE' && service.isActive) return false
    if (filters.manager === 'WITH' && !service.primaryManagerId) return false
    if (filters.manager === 'WITHOUT' && service.primaryManagerId) return false
    if (!query) return true
    const searchable = `${service.name} ${service.externalCompanyName ?? ''} ${TYPE_LABELS[service.serviceType] ?? service.serviceType} ${service.primaryManager ? personName(service.primaryManager) : ''} ${VALIDATION_LABELS[service.validationMode] ?? service.validationMode} ${service.isActive ? 'actif' : 'inactif'}`
    return normalize(searchable).includes(query)
  }), [filters, query, state.services])

  useEffect(() => setPage(1), [filters, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const visibleServices = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resetFilters = () => {
    setFilters({ type: 'ALL', status: 'ALL', manager: 'ALL' })
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
  }

  const handleSaved = async (savedService, message) => {
    setDrawer(null)
    setFeedback({ kind: 'success', message })
    await load({ silent: true })
    setDrawer({ mode: 'view', service: savedService })
  }

  const confirmStatus = async () => {
    if (!statusTarget || statusBusy) return
    setStatusBusy(true)
    try {
      const updated = statusTarget.isActive ? await disableAdminService(statusTarget.id) : await enableAdminService(statusTarget.id)
      setFeedback({ kind: 'success', message: `Le service « ${updated.name} » a été ${updated.isActive ? 'réactivé' : 'désactivé'}.` })
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
    <PageContainer className="admin-services-page">
      {feedback && <div className={`admin-services-feedback admin-services-feedback--${feedback.kind}`} role="status"><Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} /> {feedback.message}</div>}

      <div className="admin-services-heading">
        <div className="admin-services-count"><p>{state.services.length} service{state.services.length > 1 ? 's' : ''} enregistré{state.services.length > 1 ? 's' : ''}</p></div>
        <button type="button" className="admin-services-new" onClick={() => setDrawer({ mode: 'create', service: null })}><Icon name="plus" size={17} /> Nouveau service</button>
      </div>

      <section className="admin-services-filters" aria-label="Filtres services">
        <label><span>TYPE</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="ALL">Tous les types</option><option value="INTERNE">Interne</option><option value="EXTERNE">Externe</option></select></label>
        <label><span>STATUT</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="ALL">Tous les statuts</option><option value="ACTIVE">Actifs</option><option value="INACTIVE">Inactifs</option></select></label>
        <label><span>RESPONSABLE</span><select value={filters.manager} onChange={(event) => setFilters((current) => ({ ...current, manager: event.target.value }))}><option value="ALL">Tous</option><option value="WITH">Avec responsable</option><option value="WITHOUT">Sans responsable</option></select></label>
        <button type="button" className="admin-services-reset" onClick={resetFilters}><Icon name="refresh" size={15} /> Réinitialiser</button>
      </section>

      <section className="admin-services-card">
        {state.loading ? (
          <div className="admin-services-state"><span className="admin-services-spinner" /><strong>Chargement des services…</strong></div>
        ) : state.error ? (
          <div className="admin-services-state admin-services-state--error"><Icon name="alert" size={24} /><strong>Impossible de charger les services.</strong><button type="button" onClick={() => load()}>Réessayer</button></div>
        ) : filtered.length === 0 ? (
          <div className="admin-services-state"><Icon name="building" size={28} /><strong>Aucun service à afficher</strong><span>Modifiez les filtres ou la recherche pour afficher d’autres services.</span></div>
        ) : (
          <>
            <div className="admin-services-table-wrap">
              <div className="admin-services-table">
                <div className="admin-services-row admin-services-row--head"><span>Service</span><span>Type</span><span>Responsable principal</span><span>Effectif</span><span>Présence min.</span><span>Statut</span><span>Actions</span></div>
                {visibleServices.map((service) => {
                  const counts = countsByService.get(String(service.id)) ?? { total: 0, active: 0 }
                  return (
                    <div key={service.id} className={`admin-services-row admin-services-row--body${service.isActive ? '' : ' is-inactive'}`} role="button" tabIndex="0" onClick={() => setDrawer({ mode: 'view', service })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDrawer({ mode: 'view', service }) } }}>
                      <div className="admin-services-name"><span className={`admin-services-symbol ${service.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}><Icon name="building" size={18} /></span><div><strong>{service.name}</strong><small>{service.serviceType === 'EXTERNE' ? service.externalCompanyName || 'Entreprise externe' : VALIDATION_LABELS[service.validationMode] ?? 'Service interne'}</small></div></div>
                      <span className={`admin-services-type ${service.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>{TYPE_LABELS[service.serviceType] ?? service.serviceType}</span>
                      <span className="admin-services-manager" title={service.primaryManager ? personName(service.primaryManager) : ''}>{service.primaryManager ? personName(service.primaryManager) : '—'}</span>
                      <span className="admin-services-headcount"><strong>{counts.active}</strong><small>{counts.total !== counts.active ? `${counts.total} total` : 'actif'}</small></span>
                      <span className="admin-services-minimum">{service.hasMinimumPresenceRule ? service.minimumPresence ?? '—' : '—'}</span>
                      <span className={`admin-services-status ${service.isActive ? 'is-active' : 'is-inactive'}`}>{service.isActive ? 'Actif' : 'Inactif'}</span>
                      <div className="admin-services-actions">
                        <button type="button" title="Modifier" aria-label={`Modifier ${service.name}`} onClick={(event) => { event.stopPropagation(); setDrawer({ mode: 'edit', service }) }}><Icon name="edit" size={16} /></button>
                        <button type="button" className={service.isActive ? 'is-disable' : 'is-enable'} title={service.isActive ? 'Désactiver' : 'Réactiver'} aria-label={service.isActive ? `Désactiver ${service.name}` : `Réactiver ${service.name}`} onClick={(event) => { event.stopPropagation(); setStatusTarget(service) }}><Icon name={service.isActive ? 'ban' : 'refresh'} size={16} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="admin-services-footer"><span>{filtered.length} service{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}</span><PaginationBar page={page} pageSize={PAGE_SIZE} totalItems={filtered.length} onPageChange={setPage} /></div>
          </>
        )}
      </section>

      {drawer && <ServiceDrawer mode={drawer.mode} service={drawer.service} users={state.users} counts={drawer.service ? countsByService.get(String(drawer.service.id)) : null} onClose={() => setDrawer(null)} onEdit={(selected) => setDrawer({ mode: 'edit', service: selected })} onSaved={handleSaved} />}
      {statusTarget && <StatusConfirm service={statusTarget} busy={statusBusy} onCancel={() => setStatusTarget(null)} onConfirm={confirmStatus} />}
    </PageContainer>
  )
}
