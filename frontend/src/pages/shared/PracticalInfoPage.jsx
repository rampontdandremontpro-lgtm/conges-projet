import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { ROLES } from '@/config/navigation'
import {
  createPracticalLink,
  deletePracticalLink,
  getPracticalLinks,
  updatePracticalLink,
} from '@/services/practicalInfo'

import '@/styles/shared/practical-info.css'

const EMPTY_FORM = { title: '', description: '', url: '' }

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

export function PracticalInfoPage() {
  const { effectiveRole } = useAuth()
  const canManage = [ROLES.RH, ROLES.ADMIN].includes(effectiveRole)
  const [state, setState] = useState({ loading: true, error: false, links: [] })
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  const load = useCallback(async () => {
    try {
      const links = await getPracticalLinks()
      setState({ loading: false, error: false, links: Array.isArray(links) ? links : [] })
    } catch {
      setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditor({ mode: 'create', id: null })
    setForm(EMPTY_FORM)
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
    setForm(EMPTY_FORM)
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
      setState({ loading: false, error: false, links })
      setEditor(null)
      setForm(EMPTY_FORM)
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
      setState({ loading: false, error: false, links })
    } catch (error) {
      setFeedback(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageContainer className="practical-info-page">
      <div className="practical-info-heading">
        <div>
          <span className="practical-info-eyebrow">Ressources</span>
          <h1>Informations pratiques</h1>
          <p>Retrouvez les liens utiles pour comprendre les règles et démarches liées aux congés et absences.</p>
        </div>
        {canManage && (
          <button type="button" className="practical-info-add" onClick={openCreate}>
            <Icon name="plus" size={17} /> Ajouter un lien
          </button>
        )}
      </div>

      {feedback && !editor && <div className="practical-info-feedback"><Icon name="alert" size={16} /> {feedback}</div>}

      {state.loading ? (
        <div className="practical-info-state"><span className="practical-info-spinner" /> Chargement des liens…</div>
      ) : state.error ? (
        <div className="practical-info-state practical-info-state--error">
          <Icon name="alert" size={22} />
          <strong>Impossible de charger les informations pratiques.</strong>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : state.links.length === 0 ? (
        <div className="practical-info-empty">
          <span><Icon name="info" size={28} /></span>
          <strong>Aucun lien pratique</strong>
          <p>{canManage ? 'Ajoutez le premier lien utile pour les utilisateurs.' : 'Les ressources seront ajoutées prochainement par la RH.'}</p>
        </div>
      ) : (
        <div className="practical-info-grid">
          {state.links.map((link) => (
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
    </PageContainer>
  )
}
