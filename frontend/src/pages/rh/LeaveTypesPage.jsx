import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  createRhLeaveType,
  disableRhLeaveType,
  getRhLeaveTypes,
  updateRhLeaveType,
} from '@/services/rh/rhLeaveTypes'

import '@/styles/rh/leave-types.css'

const PAGE_SIZE = 8

const CATEGORY_META = {
  DEMANDE_CONGE: { label: 'Congé', tone: 'blue' },
  DECLARATION_ABSENCE: { label: 'Absence', tone: 'orange' },
}

const EMPTY_FORM = {
  name: '',
  category: 'DEMANDE_CONGE',
  deductsPaidLeaveBalance: false,
  documentRequired: false,
  documentCanBeAddedLater: false,
  employeeCanCreate: true,
  rhOnly: false,
  allowsDays: true,
  allowsHalfDays: true,
  allowsHours: false,
  requiresValidation: true,
  isActive: true,
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

function formFromType(type) {
  if (!type) return { ...EMPTY_FORM }
  return {
    name: type.name ?? '',
    category: type.category ?? 'DEMANDE_CONGE',
    deductsPaidLeaveBalance: Boolean(type.deductsPaidLeaveBalance),
    documentRequired: Boolean(type.documentRequired),
    documentCanBeAddedLater: Boolean(type.documentCanBeAddedLater),
    employeeCanCreate: Boolean(type.employeeCanCreate),
    rhOnly: Boolean(type.rhOnly),
    allowsDays: Boolean(type.allowsDays),
    allowsHalfDays: Boolean(type.allowsHalfDays),
    allowsHours: Boolean(type.allowsHours),
    requiresValidation: Boolean(type.requiresValidation),
    isActive: type.isActive !== false,
  }
}

function unitsLabel(type) {
  const units = []
  if (type.allowsDays) units.push('Jours')
  if (type.allowsHalfDays) units.push('½ journées')
  if (type.allowsHours) units.push('Heures')
  return units.join(' · ') || '—'
}

function creationLabel(type) {
  if (type.rhOnly || !type.employeeCanCreate) return 'RH'
  return 'Salarié / RH'
}

function treatmentMeta(type) {
  if (type.category === 'DECLARATION_ABSENCE') {
    if (type.rhOnly || !type.employeeCanCreate) {
      return { label: 'Saisie RH', tone: 'neutral' }
    }
    return { label: 'Vérification RH', tone: 'orange' }
  }

  if (type.requiresValidation) {
    return { label: 'Validation', tone: 'blue' }
  }

  return { label: 'Enregistrement direct', tone: 'neutral' }
}

function LeaveTypeDrawer({ type, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFromType(type))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const isEdit = Boolean(type?.id)

  useEffect(() => {
    setForm(formFromType(type))
    setFeedback('')
  }, [type])

  const setValue = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value }

      if (key === 'category' && value === 'DECLARATION_ABSENCE') {
        next.deductsPaidLeaveBalance = false
      }
      if (key === 'documentRequired' && !value) {
        next.documentCanBeAddedLater = false
      }
      if (key === 'requiresValidation' && !value) {
        next.deductsPaidLeaveBalance = false
      }
      if (key === 'rhOnly' && value) {
        next.employeeCanCreate = false
      }
      if (key === 'employeeCanCreate' && value) {
        next.rhOnly = false
      }

      return next
    })
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    if (form.name.trim().length < 2) {
      setFeedback('Le libellé doit contenir au moins 2 caractères.')
      return
    }
    if (!form.allowsDays && !form.allowsHalfDays && !form.allowsHours) {
      setFeedback('Sélectionnez au moins une unité autorisée.')
      return
    }

    const payload = {
      name: form.name.trim(),
      category: form.category,
      deductsPaidLeaveBalance: form.deductsPaidLeaveBalance,
      documentRequired: form.documentRequired,
      documentCanBeAddedLater: form.documentRequired && form.documentCanBeAddedLater,
      employeeCanCreate: form.employeeCanCreate,
      rhOnly: form.rhOnly,
      allowsDays: form.allowsDays,
      allowsHalfDays: form.allowsHalfDays,
      allowsHours: form.allowsHours,
      requiresValidation: form.requiresValidation,
      ...(isEdit ? { isActive: form.isActive } : {}),
    }

    setBusy(true)
    setFeedback('')
    try {
      if (isEdit) {
        await updateRhLeaveType(type.id, payload)
      } else {
        await createRhLeaveType(payload)
      }
      onSaved(isEdit ? 'Type mis à jour.' : 'Nouveau type créé.')
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rh-leave-types-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="rh-leave-types-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rh-leave-type-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rh-leave-types-drawer__head">
          <div>
            <small>{isEdit ? 'PARAMÉTRAGE DU TYPE' : 'NOUVEAU TYPE'}</small>
            <h2 id="rh-leave-type-drawer-title">{isEdit ? type.name : 'Créer un type'}</h2>
            <p>Définissez les règles utilisées par les demandes de congés et les déclarations d’absence.</p>
          </div>
          <button type="button" className="rh-leave-types-close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <form className="rh-leave-types-form" onSubmit={submit}>
          <section className="rh-leave-types-form__section">
            <div className="rh-leave-types-form__title">
              <span>1</span>
              <div><h3>Informations générales</h3><p>Nom et catégorie fonctionnelle du type.</p></div>
            </div>

            <label className="rh-leave-types-field rh-leave-types-field--wide">
              <span>Libellé</span>
              <input
                value={form.name}
                onChange={(event) => setValue('name', event.target.value)}
                placeholder="Ex. Congé exceptionnel"
                maxLength="160"
                autoFocus
              />
            </label>

            <label className="rh-leave-types-field rh-leave-types-field--wide">
              <span>Catégorie</span>
              <select value={form.category} onChange={(event) => setValue('category', event.target.value)}>
                <option value="DEMANDE_CONGE">Demande de congé</option>
                <option value="DECLARATION_ABSENCE">Déclaration d’absence</option>
              </select>
            </label>
          </section>

          <section className="rh-leave-types-form__section">
            <div className="rh-leave-types-form__title">
              <span>2</span>
              <div><h3>Saisie et unités</h3><p>Choisissez qui peut utiliser ce type et sous quelle forme.</p></div>
            </div>

            <div className="rh-leave-types-unit-group">
              <span>Unités autorisées</span>
              <div>
                <label><input type="checkbox" checked={form.allowsDays} onChange={(event) => setValue('allowsDays', event.target.checked)} /><span>Jours</span></label>
                <label><input type="checkbox" checked={form.allowsHalfDays} onChange={(event) => setValue('allowsHalfDays', event.target.checked)} /><span>Demi-journées</span></label>
                <label><input type="checkbox" checked={form.allowsHours} onChange={(event) => setValue('allowsHours', event.target.checked)} /><span>Heures</span></label>
              </div>
            </div>

            <div className="rh-leave-types-switch-list">
              <label className="rh-leave-types-switch-row">
                <div><strong>Créable par le salarié</strong><small>Le type est proposé dans son espace personnel.</small></div>
                <input type="checkbox" checked={form.employeeCanCreate} onChange={(event) => setValue('employeeCanCreate', event.target.checked)} />
                <span className="rh-leave-types-switch" />
              </label>
              <label className="rh-leave-types-switch-row">
                <div><strong>Réservé à la RH</strong><small>Le type est utilisé uniquement dans les opérations RH.</small></div>
                <input type="checkbox" checked={form.rhOnly} onChange={(event) => setValue('rhOnly', event.target.checked)} />
                <span className="rh-leave-types-switch" />
              </label>
            </div>
          </section>

          <section className="rh-leave-types-form__section">
            <div className="rh-leave-types-form__title">
              <span>3</span>
              <div><h3>Justificatif et validation</h3><p>Paramètres de contrôle appliqués au type.</p></div>
            </div>

            <div className="rh-leave-types-switch-list">
              <label className="rh-leave-types-switch-row">
                <div><strong>Justificatif obligatoire</strong><small>Un document doit accompagner la déclaration ou la demande.</small></div>
                <input type="checkbox" checked={form.documentRequired} onChange={(event) => setValue('documentRequired', event.target.checked)} />
                <span className="rh-leave-types-switch" />
              </label>
              <label className={`rh-leave-types-switch-row${!form.documentRequired ? ' is-disabled' : ''}`}>
                <div><strong>Dépôt différé autorisé</strong><small>Le justificatif peut être ajouté après la déclaration.</small></div>
                <input
                  type="checkbox"
                  checked={form.documentCanBeAddedLater}
                  disabled={!form.documentRequired}
                  onChange={(event) => setValue('documentCanBeAddedLater', event.target.checked)}
                />
                <span className="rh-leave-types-switch" />
              </label>
              <label className="rh-leave-types-switch-row">
                <div><strong>Validation requise</strong><small>La demande doit suivre le circuit de validation prévu.</small></div>
                <input type="checkbox" checked={form.requiresValidation} onChange={(event) => setValue('requiresValidation', event.target.checked)} />
                <span className="rh-leave-types-switch" />
              </label>
              <label className={`rh-leave-types-switch-row${form.category !== 'DEMANDE_CONGE' || !form.requiresValidation ? ' is-disabled' : ''}`}>
                <div><strong>Décompter le solde de congés payés</strong><small>La validation diminue le compteur de congés payés.</small></div>
                <input
                  type="checkbox"
                  checked={form.deductsPaidLeaveBalance}
                  disabled={form.category !== 'DEMANDE_CONGE' || !form.requiresValidation}
                  onChange={(event) => setValue('deductsPaidLeaveBalance', event.target.checked)}
                />
                <span className="rh-leave-types-switch" />
              </label>
            </div>
          </section>

          {isEdit && (
            <section className="rh-leave-types-form__section rh-leave-types-form__section--status">
              <div>
                <h3>Disponibilité du type</h3>
                <p>Un type inactif reste dans l’historique mais n’est plus proposé pour les nouvelles saisies.</p>
              </div>
              <label className="rh-leave-types-status-toggle">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setValue('isActive', event.target.checked)} />
                <span className="rh-leave-types-switch" />
                <b>{form.isActive ? 'Actif' : 'Inactif'}</b>
              </label>
            </section>
          )}

          {feedback && <div className="rh-leave-types-form__feedback"><Icon name="alert" size={16} /> {feedback}</div>}

          <div className="rh-leave-types-form__actions">
            <button type="button" onClick={onClose}>Annuler</button>
            <button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : isEdit ? 'Enregistrer les modifications' : 'Créer le type'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}

function DisableDialog({ type, busy, onCancel, onConfirm }) {
  if (!type) return null
  return (
    <div className="rh-leave-types-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <div className="rh-leave-types-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rh-leave-types-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="rh-leave-types-confirm__icon"><Icon name="trash" size={20} /></span>
        <h3 id="rh-leave-types-confirm-title">Désactiver « {type.name} » ?</h3>
        <p>Le type ne sera plus proposé pour les nouvelles demandes. Les demandes et documents existants restent conservés.</p>
        <div>
          <button type="button" onClick={onCancel} disabled={busy}>Annuler</button>
          <button type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Désactivation…' : 'Désactiver'}</button>
        </div>
      </div>
    </div>
  )
}

export function RhLeaveTypesPage() {
  const [searchParams] = useSearchParams()
  const [state, setState] = useState({ loading: true, error: false, items: [] })
  const [selectedType, setSelectedType] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const items = await getRhLeaveTypes()
      setState({ loading: false, error: false, items })
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

  const query = normalize(searchParams.get('q'))
  const filtered = useMemo(() => {
    if (!query) return state.items
    return state.items.filter((item) => {
      const category = CATEGORY_META[item.category]?.label ?? item.category
      return normalize(`${item.name} ${category} ${creationLabel(item)} ${unitsLabel(item)} ${item.isActive ? 'actif' : 'inactif'}`).includes(query)
    })
  }, [query, state.items])

  useEffect(() => setPage(1), [query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const visibleItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openCreate = () => {
    setSelectedType(null)
    setDrawerOpen(true)
  }

  const openEdit = (type) => {
    setSelectedType(type)
    setDrawerOpen(true)
  }

  const handleSaved = async (message) => {
    setDrawerOpen(false)
    setSelectedType(null)
    setFeedback(message)
    await load({ silent: true })
  }

  const confirmDisable = async () => {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    try {
      await disableRhLeaveType(deleteTarget.id)
      setFeedback(`« ${deleteTarget.name} » a été désactivé.`)
      setDeleteTarget(null)
      await load({ silent: true })
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <PageContainer className="rh-leave-types-page">
      {feedback && <div className="rh-leave-types-feedback"><Icon name="check" size={16} /> {feedback}</div>}

      <section className="rh-leave-types-card">
        <div className="rh-leave-types-toolbar">
          <div>
            <h2>Types de congés et absences</h2>
            <p>Configurez les types proposés dans GMES et leurs règles de saisie.</p>
          </div>
          <button type="button" className="rh-leave-types-new" onClick={openCreate}>
            <Icon name="plus" size={17} /> Nouveau type
          </button>
        </div>

        {state.loading ? (
          <div className="rh-leave-types-state">
            <span className="rh-leave-types-spinner" />
            <strong>Chargement des types…</strong>
          </div>
        ) : state.error ? (
          <div className="rh-leave-types-state rh-leave-types-state--error">
            <Icon name="alert" size={24} />
            <strong>Impossible de charger les types.</strong>
            <button type="button" onClick={() => load()}>Réessayer</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rh-leave-types-state">
            <Icon name="file" size={28} />
            <strong>Aucun type à afficher</strong>
            <span>{query ? 'Aucun résultat ne correspond à votre recherche.' : 'Créez votre premier type de congé ou d’absence.'}</span>
          </div>
        ) : (
          <>
            <div className="rh-leave-types-table-wrap">
              <div className="rh-leave-types-table">
                <div className="rh-leave-types-row rh-leave-types-row--head">
                  <span>Libellé</span>
                  <span>Catégorie</span>
                  <span>Solde CP</span>
                  <span>Justificatif</span>
                  <span>Unités autorisées</span>
                  <span>Création</span>
                  <span>Traitement</span>
                  <span>Statut</span>
                  <span>Actions</span>
                </div>

                {visibleItems.map((type) => {
                  const category = CATEGORY_META[type.category] ?? { label: type.category, tone: 'neutral' }
                  const treatment = treatmentMeta(type)
                  return (
                    <div
                      key={type.id}
                      className={`rh-leave-types-row rh-leave-types-row--body${type.isActive ? '' : ' is-inactive'}`}
                      role="button"
                      tabIndex="0"
                      onClick={() => openEdit(type)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openEdit(type)
                        }
                      }}
                    >
                      <div className="rh-leave-types-name">
                        <span className={`rh-leave-types-name__icon rh-leave-types-name__icon--${category.tone}`}><Icon name={type.category === 'DECLARATION_ABSENCE' ? 'calendar' : 'file'} size={17} /></span>
                        <div><strong>{type.name}</strong><small>{type.category === 'DECLARATION_ABSENCE' ? 'Déclaration d’absence' : 'Demande de congé'}</small></div>
                      </div>
                      <span className={`rh-leave-types-badge rh-leave-types-badge--${category.tone}`}>{category.label}</span>
                      <span className={type.deductsPaidLeaveBalance ? 'rh-leave-types-yes' : 'rh-leave-types-muted'}>{type.deductsPaidLeaveBalance ? 'Déduit' : 'Non'}</span>
                      <span className={`rh-leave-types-badge${type.documentRequired ? ' rh-leave-types-badge--warning' : ' rh-leave-types-badge--neutral'}`}>
                        {type.documentRequired ? (type.documentCanBeAddedLater ? 'Obligatoire · différé' : 'Obligatoire') : 'Non requis'}
                      </span>
                      <span className="rh-leave-types-units">{unitsLabel(type)}</span>
                      <span>{creationLabel(type)}</span>
                      <span className={`rh-leave-types-treatment rh-leave-types-treatment--${treatment.tone}`}>{treatment.label}</span>
                      <span className={`rh-leave-types-status${type.isActive ? ' is-active' : ' is-inactive'}`}>{type.isActive ? 'Actif' : 'Inactif'}</span>
                      <div className="rh-leave-types-actions">
                        {type.isActive && (
                          <button
                            type="button"
                            title="Désactiver ce type"
                            aria-label={`Désactiver ${type.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteTarget(type)
                            }}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rh-leave-types-footer">
              <span>{filtered.length} type{filtered.length > 1 ? 's' : ''}</span>
              <PaginationBar
                page={page}
                pageSize={PAGE_SIZE}
                totalItems={filtered.length}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </section>

      {drawerOpen && <LeaveTypeDrawer type={selectedType} onClose={() => setDrawerOpen(false)} onSaved={handleSaved} />}
      <DisableDialog type={deleteTarget} busy={deleteBusy} onCancel={() => !deleteBusy && setDeleteTarget(null)} onConfirm={confirmDisable} />
    </PageContainer>
  )
}
