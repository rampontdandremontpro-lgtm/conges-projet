import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { SignatureSettingsCard } from '@/components/collab/settings/SignatureSettingsCard'
import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import {
  changeMyPassword,
  deleteMySignature,
  getMySignature,
  getMyPreferences,
  saveMyPreferences,
  saveMySignature,
} from '@/services/profile'

import '@/styles/collab/settings/index.css'

function errorMessage(error, fallback) {
  const message = error.response?.data?.message
  if (Array.isArray(message)) return message[0] ?? fallback
  return message ?? fallback
}

const LEAVE_EMOJIS = ['🏖️', '🌴', '☀️', '✈️', '🧳', '😎', '🌊', '⛱️']
const UNAVAILABILITY_EMOJIS = ['📍', '🚫', '⏰', '🏠', '🩺', '📌', '🌙', '⚠️']

function resizeProfileImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Sélectionnez un fichier image.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Image invalide.'))
      image.onload = () => {
        const size = Math.min(180, Math.max(image.width, image.height))
        const ratio = Math.min(1, size / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * ratio))
        canvas.height = Math.max(1, Math.round(image.height * ratio))
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        let data = canvas.toDataURL('image/jpeg', 0.76)
        if (data.length > 56000) data = canvas.toDataURL('image/jpeg', 0.58)
        if (data.length > 58000) {
          reject(new Error('La photo reste trop volumineuse. Choisissez une image plus simple.'))
          return
        }
        resolve(data)
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
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
  const profileFileRef = useRef(null)
  const [preferences, setPreferences] = useState({
    loading: true,
    saving: false,
    profileImageData: null,
    leaveEmoji: '🏖️',
    unavailabilityEmoji: '📍',
  })

  useAutoDismiss(feedback, setFeedback)

  const loadPreferences = useCallback(async () => {
    setPreferences((current) => ({ ...current, loading: true }))
    try {
      const data = await getMyPreferences()
      setPreferences({
        loading: false,
        saving: false,
        profileImageData: data?.profileImageData ?? null,
        leaveEmoji: data?.leaveEmoji ?? '🏖️',
        unavailabilityEmoji: data?.unavailabilityEmoji ?? '📍',
      })
    } catch (error) {
      setPreferences((current) => ({ ...current, loading: false }))
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible de charger vos préférences.') })
    }
  }, [])

  const savePreferences = async (nextValues, successMessage) => {
    setPreferences((current) => ({ ...current, ...nextValues, saving: true }))
    setFeedback(null)
    try {
      const data = await saveMyPreferences(nextValues)
      setPreferences({ loading: false, saving: false, ...data })
      window.dispatchEvent(new CustomEvent('gmes:profile-preferences-updated', { detail: data }))
      window.dispatchEvent(new Event('gmes:data-changed'))
      setFeedback({ kind: 'success', message: successMessage })
    } catch (error) {
      setPreferences((current) => ({ ...current, saving: false }))
      setFeedback({ kind: 'error', message: errorMessage(error, 'Impossible d’enregistrer vos préférences.') })
    }
  }

  const handleProfileImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const profileImageData = await resizeProfileImage(file)
      await savePreferences({ profileImageData }, 'Votre photo de profil a été mise à jour.')
    } catch (error) {
      setFeedback({ kind: 'error', message: error.message ?? 'Impossible de préparer cette image.' })
    }
  }

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
    loadPreferences()
    loadSignature()
  }, [loadPreferences, loadSignature])

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

      <section className="settings-card settings-preferences-card">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><Icon name="user" size={19} /></span>
          <div>
            <h2>Photo de profil</h2>
            <p>Choisissez une photo ou une image qui apparaîtra dans votre espace.</p>
          </div>
        </div>
        <div className="settings-profile-photo">
          <div className="settings-profile-photo__preview" aria-label="Aperçu de la photo de profil">
            {preferences.profileImageData ? (
              <img src={preferences.profileImageData} alt="Votre profil" />
            ) : (
              <span>{`${user?.nom?.[0] ?? ''}${user?.prenom?.[0] ?? ''}`.toUpperCase()}</span>
            )}
          </div>
          <div className="settings-profile-photo__actions">
            <input ref={profileFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleProfileImage} />
            <button type="button" className="settings-btn settings-btn--primary" disabled={preferences.loading || preferences.saving} onClick={() => profileFileRef.current?.click()}>
              Choisir une image
            </button>
            {preferences.profileImageData && (
              <button type="button" className="settings-btn" disabled={preferences.saving} onClick={() => savePreferences({ profileImageData: null }, 'Votre photo de profil a été supprimée.')}>
                <Icon name="trash" size={15} /> Supprimer
              </button>
            )}
            <small>PNG, JPEG ou WebP. L’image est automatiquement redimensionnée.</small>
          </div>
        </div>
      </section>

      <section className="settings-card settings-preferences-card">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><Icon name="calendar" size={19} /></span>
          <div>
            <h2>Emojis du calendrier</h2>
            <p>Personnalisez les repères affichés sur vos jours de congé et d’indisponibilité.</p>
          </div>
        </div>
        <div className="settings-emoji-grid">
          <div className="settings-emoji-group">
            <strong>Congé</strong>
            <div className="settings-emoji-list" role="radiogroup" aria-label="Emoji de congé">
              {LEAVE_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" role="radio" aria-checked={preferences.leaveEmoji === emoji} className={preferences.leaveEmoji === emoji ? 'is-selected' : ''} onClick={() => setPreferences((current) => ({ ...current, leaveEmoji: emoji }))}>{emoji}</button>
              ))}
            </div>
          </div>
          <div className="settings-emoji-group">
            <strong>Indisponibilité / absence</strong>
            <div className="settings-emoji-list" role="radiogroup" aria-label="Emoji d’indisponibilité">
              {UNAVAILABILITY_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" role="radio" aria-checked={preferences.unavailabilityEmoji === emoji} className={preferences.unavailabilityEmoji === emoji ? 'is-selected' : ''} onClick={() => setPreferences((current) => ({ ...current, unavailabilityEmoji: emoji }))}>{emoji}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="settings-actions settings-actions--end">
          <button type="button" className="settings-btn settings-btn--primary" disabled={preferences.loading || preferences.saving} onClick={() => savePreferences({ leaveEmoji: preferences.leaveEmoji, unavailabilityEmoji: preferences.unavailabilityEmoji }, 'Vos emojis de calendrier ont été enregistrés.')}>
            {preferences.saving ? 'Enregistrement…' : 'Enregistrer les emojis'}
          </button>
        </div>
      </section>

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
