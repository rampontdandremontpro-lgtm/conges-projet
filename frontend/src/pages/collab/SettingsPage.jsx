import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { SignatureSettingsCard } from '@/components/collab/settings/SignatureSettingsCard'
import { Icon } from '@/components/ui/Icon'
import {
  changeMyPassword,
  deleteMySignature,
  getMySignature,
  saveMySignature,
} from '@/services/profile'

import '@/styles/collab/settings/index.css'

function errorMessage(error, fallback) {
  const message = error.response?.data?.message
  if (Array.isArray(message)) return message[0] ?? fallback
  return message ?? fallback
}

export function SettingsPage() {
  const { user } = useAuth()
  const canSign = user?.role !== 'ADMIN'
  const [signature, setSignature] = useState({ loading: canSign, saving: false, data: null })
  const [feedback, setFeedback] = useState(null)
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordVisibility, setPasswordVisibility] = useState({
    current: false,
    next: false,
    confirm: false,
  })

  const loadSignature = useCallback(async () => {
    if (!canSign) return
    setSignature((current) => ({ ...current, loading: true }))
    try {
      const data = await getMySignature()
      setSignature({ loading: false, saving: false, data })
    } catch (error) {
      setSignature({ loading: false, saving: false, data: null })
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible de charger votre signature.') })
    }
  }, [canSign])

  useEffect(() => {
    loadSignature()
  }, [loadSignature])

  const handleSaveSignature = async (payload) => {
    setFeedback(null)
    setSignature((current) => ({ ...current, saving: true }))
    try {
      const data = await saveMySignature(payload)
      setSignature({ loading: false, saving: false, data })
      setFeedback({ kind: 'success', message: 'Votre signature a été enregistrée.' })
    } catch (error) {
      setSignature((current) => ({ ...current, saving: false }))
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible d’enregistrer votre signature.') })
    }
  }

  const handleDeleteSignature = async () => {
    if (!window.confirm('Supprimer votre signature enregistrée ?')) return
    setFeedback(null)
    setSignature((current) => ({ ...current, saving: true }))
    try {
      await deleteMySignature()
      setSignature({
        loading: false,
        saving: false,
        data: { configured: false, signatureType: null, signatureData: null, updatedAt: null },
      })
      setFeedback({ kind: 'success', message: 'Votre signature enregistrée a été supprimée.' })
    } catch (error) {
      setSignature((current) => ({ ...current, saving: false }))
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible de supprimer votre signature.') })
    }
  }

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    setFeedback(null)

    if (password.newPassword.length < 12) {
      setFeedback({ kind: 'error', message: 'Le nouveau mot de passe doit contenir au moins 12 caractères.' })
      return
    }
    if (password.newPassword !== password.confirmPassword) {
      setFeedback({ kind: 'error', message: 'La confirmation ne correspond pas au nouveau mot de passe.' })
      return
    }

    setPasswordSaving(true)
    try {
      const response = await changeMyPassword({
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      })
      setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setFeedback({ kind: 'success', message: response.message ?? 'Votre mot de passe a été modifié.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible de modifier votre mot de passe.') })
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="settings-page">
      {feedback && (
        <div className={`settings-feedback settings-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

      {canSign && (
        <SignatureSettingsCard
          signature={signature.data}
          loading={signature.loading}
          saving={signature.saving}
          onSave={handleSaveSignature}
          onDelete={handleDeleteSignature}
        />
      )}

      <section className="settings-card">
        <div className="settings-card__heading">
          <span className="settings-card__icon settings-card__icon--security">
            <Icon name="shield" size={19} />
          </span>
          <div>
            <h2>Sécurité du compte</h2>
            <p>Modifiez le mot de passe utilisé pour votre compte local de développement.</p>
          </div>
        </div>

        <form className="settings-password-form" onSubmit={handlePasswordSubmit}>
          <div className="settings-field">
            <label htmlFor="current-password">Mot de passe actuel</label>
            <div className="settings-password-input">
              <input
                id="current-password"
                type={passwordVisibility.current ? 'text' : 'password'}
                autoComplete="current-password"
                value={password.currentPassword}
                onChange={(event) => setPassword((current) => ({ ...current, currentPassword: event.target.value }))}
                required
              />
              <button
                type="button"
                className="settings-password-visibility"
                onClick={() => setPasswordVisibility((current) => ({ ...current, current: !current.current }))}
                aria-label={passwordVisibility.current ? 'Masquer le mot de passe actuel' : 'Afficher le mot de passe actuel'}
                title={passwordVisibility.current ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                <Icon name={passwordVisibility.current ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
          </div>

          <div className="settings-password-grid">
            <div className="settings-field">
              <label htmlFor="new-password">Nouveau mot de passe</label>
              <div className="settings-password-input">
                <input
                  id="new-password"
                  type={passwordVisibility.next ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={64}
                  value={password.newPassword}
                  onChange={(event) => setPassword((current) => ({ ...current, newPassword: event.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="settings-password-visibility"
                  onClick={() => setPasswordVisibility((current) => ({ ...current, next: !current.next }))}
                  aria-label={passwordVisibility.next ? 'Masquer le nouveau mot de passe' : 'Afficher le nouveau mot de passe'}
                  title={passwordVisibility.next ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <Icon name={passwordVisibility.next ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
              <small>12 caractères minimum.</small>
            </div>
            <div className="settings-field">
              <label htmlFor="confirm-password">Confirmer le nouveau mot de passe</label>
              <div className="settings-password-input">
                <input
                  id="confirm-password"
                  type={passwordVisibility.confirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={64}
                  value={password.confirmPassword}
                  onChange={(event) => setPassword((current) => ({ ...current, confirmPassword: event.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="settings-password-visibility"
                  onClick={() => setPasswordVisibility((current) => ({ ...current, confirm: !current.confirm }))}
                  aria-label={passwordVisibility.confirm ? 'Masquer la confirmation du mot de passe' : 'Afficher la confirmation du mot de passe'}
                  title={passwordVisibility.confirm ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <Icon name={passwordVisibility.confirm ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="settings-security-note">
            <Icon name="info" size={16} />
            <span>En production, l’authentification principale des utilisateurs internes sera assurée par Microsoft Entra ID. Ce formulaire concerne le compte local utilisé actuellement pour le développement et les tests.</span>
          </div>

          <div className="settings-actions settings-actions--end">
            <button type="submit" className="settings-btn settings-btn--primary" disabled={passwordSaving}>
              {passwordSaving ? 'Modification…' : 'Modifier le mot de passe'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
