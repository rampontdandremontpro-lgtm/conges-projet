import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { RuleContentEditor } from '@/components/shared/RuleContentEditor'
import { ROLES } from '@/config/navigation'
import { getPublicSettings } from '@/services/collab/dashboard'
import {
  createInternalRule,
  deleteInternalRule,
  getInternalRules,
  updateInternalRule,
} from '@/services/internalRules'
import {
  createPracticalLink,
  deletePracticalLink,
  getPracticalLinks,
  updatePracticalLink,
} from '@/services/practicalInfo'
import {
  INTERNAL_RULE_ICONS,
  resolveInternalRules,
} from '@/utils/practicalInfoRules'

const EMPTY_LINK_FORM = { title: '', description: '', url: '' }
const EMPTY_RULE_FORM = { title: '', content: '', icon: 'info' }

const TABS = [
  { id: 'rules', label: 'Règles internes GMES' },
  { id: 'resources', label: 'Ressources officielles' },
]

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

export function PracticalInfoPage() {
  const { effectiveRole } = useAuth()
  const canManage = [ROLES.RH, ROLES.ADMIN].includes(effectiveRole)
  const [activeTab, setActiveTab] = useState('rules')
  const [linksState, setLinksState] = useState({ loading: true, error: false, links: [] })
  const [settingsState, setSettingsState] = useState({ loading: true, error: false, settings: [] })
  const [rulesState, setRulesState] = useState({ loading: true, error: false, rules: [] })
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState(EMPTY_LINK_FORM)
  const [ruleEditor, setRuleEditor] = useState(null)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [ruleFeedback, setRuleFeedback] = useState('')

  const load = useCallback(async () => {
    setLinksState((current) => ({ ...current, loading: true, error: false }))
    setSettingsState((current) => ({ ...current, loading: true, error: false }))
    setRulesState((current) => ({ ...current, loading: true, error: false }))
    try {
      const [links, settings, rules] = await Promise.all([
        getPracticalLinks(),
        getPublicSettings(),
        getInternalRules(),
      ])
      setLinksState({ loading: false, error: false, links: Array.isArray(links) ? links : [] })
      setSettingsState({ loading: false, error: false, settings: Array.isArray(settings) ? settings : [] })
      setRulesState({ loading: false, error: false, rules: Array.isArray(rules) ? rules : [] })
    } catch {
      setLinksState({ loading: false, error: true, links: [] })
      setSettingsState({ loading: false, error: true, settings: [] })
      setRulesState({ loading: false, error: true, rules: [] })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const resolvedRules = useMemo(
    () => resolveInternalRules(rulesState.rules, settingsState.settings),
    [rulesState.rules, settingsState.settings],
  )

  // --- Gestion des liens officiels -------------------------------------
  const openCreate = () => {
    setEditor({ mode: 'create', id: null })
    setForm(EMPTY_LINK_FORM)
    setFeedback('')
  }

  const openEdit = (link) => {
    setEditor({ mode: 'edit', id: link.id })
    setForm({ title: link.title, description: link.description ?? '', url: link.url })
    setFeedback('')
  }

  const closeEditor = () => {
    if (busy) return
    setEditor(null)
    setForm(EMPTY_LINK_FORM)
    setFeedback('')
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFeedback('')
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        url: form.url.trim(),
      }
      const links = editor.mode === 'edit'
        ? await updatePracticalLink(editor.id, payload)
        : await createPracticalLink(payload)
      setLinksState({ loading: false, error: false, links })
      setEditor(null)
      setForm(EMPTY_LINK_FORM)
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (link) => {
    if (busy) return
    if (!window.confirm(`Supprimer le lien « ${link.title} » ?`)) return
    setBusy(true)
    setFeedback('')
    try {
      const links = await deletePracticalLink(link.id)
      setLinksState({ loading: false, error: false, links })
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  // --- Gestion des règles internes -------------------------------------
  const openCreateRule = () => {
    setRuleEditor({ mode: 'create', id: null })
    setRuleForm(EMPTY_RULE_FORM)
    setRuleFeedback('')
  }

  const openEditRule = (rule) => {
    setRuleEditor({ mode: 'edit', id: rule.id })
    setRuleForm({ title: rule.title, content: rule.content ?? '', icon: rule.icon ?? 'info' })
    setRuleFeedback('')
  }

  const closeRuleEditor = () => {
    if (busy) return
    setRuleEditor(null)
    setRuleForm(EMPTY_RULE_FORM)
    setRuleFeedback('')
  }

  const submitRule = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setRuleFeedback('')
    try {
      const payload = {
        title: ruleForm.title.trim(),
        content: ruleForm.content.trim(),
        icon: ruleForm.icon,
      }
      const rules = ruleEditor.mode === 'edit'
        ? await updateInternalRule(ruleEditor.id, payload)
        : await createInternalRule(payload)
      setRulesState({ loading: false, error: false, rules })
      setRuleEditor(null)
      setRuleForm(EMPTY_RULE_FORM)
    } catch (error) {
      setRuleFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeRule = async (rule) => {
    if (busy) return
    if (!window.confirm(`Supprimer la règle « ${rule.title} » ?`)) return
    setBusy(true)
    setRuleFeedback('')
    try {
      const rules = await deleteInternalRule(rule.id)
      setRulesState({ loading: false, error: false, rules })
    } catch (error) {
      setRuleFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const renderResources = () => {
    if (linksState.loading) {
      return <div className="practical-info-state"><span className="practical-info-spinner" /> Chargement des liens…</div>
    }
    if (linksState.error) {
      return (
        <div className="practical-info-state practical-info-state--error">
          <Icon name="alert" size={22} />
          <strong>Impossible de charger les informations pratiques.</strong>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      )
    }
    if (linksState.links.length === 0) {
      return (
        <div className="practical-info-empty">
          <span><Icon name="info" size={28} /></span>
          <strong>Aucun lien pratique</strong>
          <p>{canManage ? 'Ajoutez le premier lien utile pour les utilisateurs.' : 'Les ressources seront ajoutées prochainement par la RH.'}</p>
        </div>
      )
    }
    return (
      <div className="practical-info-grid">
        {linksState.links.map((link) => (
          <article className="practical-info-card" key={link.id}>
            <div className="practical-info-card__icon"><Icon name="info" size={21} /></div>
            <div className="practical-info-card__body">
              <h2>{link.title}</h2>
              {link.description && <p>{link.description}</p>}
              <a href={link.url} target="_blank" rel="noreferrer">
                Ouvrir le lien <Icon name="arrowRight" size={15} />
              </a>
            </div>
            {canManage && (
              <div className="practical-info-card__actions">
                <button type="button" onClick={() => openEdit(link)} aria-label={`Modifier ${link.title}`}><Icon name="edit" size={16} /></button>
                <button type="button" className="is-danger" onClick={() => remove(link)} aria-label={`Supprimer ${link.title}`}><Icon name="trash" size={16} /></button>
              </div>
            )}
          </article>
        ))}
      </div>
    )
  }

  const renderRules = () => {
    if (rulesState.loading) {
      return <div className="practical-info-state"><span className="practical-info-spinner" /> Chargement des règles internes…</div>
    }
    if (rulesState.error) {
      return (
        <div className="practical-info-state practical-info-state--error">
          <Icon name="alert" size={22} />
          <strong>Impossible de charger les règles internes.</strong>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      )
    }
    if (resolvedRules.length === 0) {
      return (
        <div className="practical-info-empty">
          <span><Icon name="info" size={28} /></span>
          <strong>Aucune règle interne</strong>
          <p>{canManage ? 'Ajoutez la première règle interne pour les utilisateurs.' : 'Les règles internes seront ajoutées prochainement par la RH.'}</p>
        </div>
      )
    }
    return (
      <div className="practical-info-grid">
        {resolvedRules.map((rule) => (
          <article className={`practical-info-card practical-info-card--rule${canManage ? ' practical-info-card--manage' : ''}`} key={rule.id}>
            <div className="practical-info-card__icon"><Icon name={rule.icon} size={21} /></div>
            <div className="practical-info-card__body">
              <h2>{rule.title}</h2>
              <p>{rule.text}</p>
            </div>
            {canManage && (
              <div className="practical-info-card__actions">
                <button type="button" onClick={() => openEditRule(rule)} aria-label={`Modifier ${rule.title}`}><Icon name="edit" size={16} /></button>
                <button type="button" className="is-danger" onClick={() => removeRule(rule)} aria-label={`Supprimer ${rule.title}`}><Icon name="trash" size={16} /></button>
              </div>
            )}
          </article>
        ))}
      </div>
    )
  }

  return (
    <PageContainer className="practical-info-page">
      <div className="practical-info-heading">
        <div>
          <span className="practical-info-eyebrow">Ressources</span>
          <h1>Informations pratiques</h1>
          <p>Consultez les règles internes de GMES et les ressources utiles concernant les congés et les absences.</p>
        </div>
      </div>

      <div className="practical-info-tabs" role="tablist" aria-label="Sections des informations pratiques">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`practical-info-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`practical-info-panel-${tab.id}`}
            className={`practical-info-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' ? (
        <div
          id="practical-info-panel-rules"
          role="tabpanel"
          aria-labelledby="practical-info-tab-rules"
        >
          {ruleFeedback && !ruleEditor && <div className="practical-info-feedback"><Icon name="alert" size={16} /> {ruleFeedback}</div>}
          {canManage && (
            <div className="practical-info-toolbar">
              <button type="button" className="practical-info-add" onClick={openCreateRule}>
                <Icon name="plus" size={17} /> Ajouter une règle
              </button>
            </div>
          )}
          {renderRules()}
        </div>
      ) : (
        <div
          id="practical-info-panel-resources"
          role="tabpanel"
          aria-labelledby="practical-info-tab-resources"
        >
          {feedback && !editor && <div className="practical-info-feedback"><Icon name="alert" size={16} /> {feedback}</div>}
          {canManage && (
            <div className="practical-info-toolbar">
              <button type="button" className="practical-info-add" onClick={openCreate}>
                <Icon name="plus" size={17} /> Ajouter un lien
              </button>
            </div>
          )}
          {renderResources()}
        </div>
      )}

      {editor && (
        <div className="practical-info-modal-backdrop" role="presentation" onMouseDown={closeEditor}>
          <section className="practical-info-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="practical-info-eyebrow">{effectiveRole === ROLES.ADMIN ? 'ADMINISTRATION' : 'RH'}</span>
                <h2>{editor.mode === 'edit' ? 'Modifier le lien' : 'Ajouter un lien'}</h2>
              </div>
              <button type="button" onClick={closeEditor} disabled={busy} aria-label="Fermer">×</button>
            </header>
            <form onSubmit={submit}>
              <label>
                <span>Titre *</span>
                <input value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label>
                <span>Description</span>
                <textarea value={form.description} maxLength={500} rows={4} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                <span>URL *</span>
                <input type="url" placeholder="https://…" value={form.url} maxLength={1000} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} required />
              </label>
              {feedback && <div className="practical-info-feedback"><Icon name="alert" size={16} /> {feedback}</div>}
              <footer>
                <button type="button" onClick={closeEditor} disabled={busy}>Annuler</button>
                <button type="submit" className="is-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {ruleEditor && (
        <div className="practical-info-modal-backdrop" role="presentation" onMouseDown={closeRuleEditor}>
          <section className="practical-info-modal practical-info-modal--wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="practical-info-eyebrow">{effectiveRole === ROLES.ADMIN ? 'ADMINISTRATION' : 'RH'}</span>
                <h2>{ruleEditor.mode === 'edit' ? 'Modifier la règle' : 'Ajouter une règle'}</h2>
              </div>
              <button type="button" onClick={closeRuleEditor} disabled={busy} aria-label="Fermer">×</button>
            </header>
            <form onSubmit={submitRule}>
              <label>
                <span>Titre *</span>
                <input value={ruleForm.title} maxLength={120} onChange={(event) => setRuleForm((current) => ({ ...current, title: event.target.value }))} required />
              </label>

              <div className="practical-info-icon-field">
                <span className="practical-info-field-label">Icône</span>
                <div className="practical-info-icon-grid" role="group" aria-label="Choisir une icône">
                  {INTERNAL_RULE_ICONS.map((icon) => (
                    <button
                      key={icon.value}
                      type="button"
                      className={`practical-info-icon-option ${ruleForm.icon === icon.value ? 'is-active' : ''}`}
                      aria-pressed={ruleForm.icon === icon.value}
                      aria-label={icon.label}
                      title={icon.label}
                      onClick={() => setRuleForm((current) => ({ ...current, icon: icon.value }))}
                    >
                      <Icon name={icon.value} size={18} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="practical-info-field">
                <span className="practical-info-field-label">Contenu explicatif *</span>
                <RuleContentEditor
                  value={ruleForm.content}
                  settings={settingsState.settings}
                  onChange={(content) => setRuleForm((current) => ({ ...current, content }))}
                />
              </div>

              {ruleFeedback && <div className="practical-info-feedback"><Icon name="alert" size={16} /> {ruleFeedback}</div>}
              <footer>
                <button type="button" onClick={closeRuleEditor} disabled={busy}>Annuler</button>
                <button type="submit" className="is-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </PageContainer>
  )
}
