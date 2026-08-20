import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'

import { PasswordRecoveryLayout, LockIcon } from '@/components/auth/PasswordRecoveryLayout'
import { useAuth } from '@/auth/AuthContext'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import {
  resetPassword,
  validatePasswordResetToken,
} from '@/services/auth/passwordRecovery'

function passwordRules(password) {
  return {
    length: password.length >= 12 && password.length <= 64,
  }
}

export function ResetPasswordPage() {
  const { isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const [tokenState, setTokenState] = useState(token ? 'checking' : 'invalid')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useAutoDismiss(error, setError, { clearValue: '' })

  const rules = useMemo(() => passwordRules(password), [password])
  const passwordsMatch = Boolean(password) && password === confirmation
  const formValid = rules.length && passwordsMatch

  useEffect(() => {
    if (!token) {
      return undefined
    }

    let active = true
    setTokenState('checking')

    validatePasswordResetToken(token)
      .then(() => {
        if (active) setTokenState('valid')
      })
      .catch(() => {
        if (active) setTokenState('invalid')
      })

    return () => {
      active = false
    }
  }, [token])

  if (isAuthenticated) {
    return <Navigate to="/app/dashboard" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!formValid) {
      setError('Vérifiez le nouveau mot de passe et sa confirmation.')
      return
    }

    setSubmitting(true)
    try {
      await resetPassword(token, password)
      setSuccess(true)
      setPassword('')
      setConfirmation('')
    } catch (err) {
      const message = err.response?.data?.message
      setError(
        typeof message === 'string' && message.trim()
          ? message
          : 'Impossible de réinitialiser le mot de passe. Le lien est peut-être expiré.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  let content

  if (tokenState === 'checking') {
    content = (
      <div className="recovery-token-state" role="status">
        <span className="recovery-spinner" aria-hidden="true" />
        <strong>Vérification du lien sécurisé…</strong>
        <span>Quelques secondes suffisent.</span>
      </div>
    )
  } else if (tokenState === 'invalid') {
    content = (
      <div className="recovery-invalid" role="alert">
        <span className="recovery-invalid__icon" aria-hidden="true">!</span>
        <h3>Lien invalide ou expiré</h3>
        <p>
          Ce lien de réinitialisation n’est plus utilisable. Demandez-en un nouveau depuis la page
          « Mot de passe oublié ».
        </p>
        <Link className="login-submit recovery-link-button" to="/forgot-password">
          Demander un nouveau lien
        </Link>
        <Link className="recovery-back" to="/login">
          ← Retour à la connexion
        </Link>
      </div>
    )
  } else if (success) {
    content = (
      <div className="recovery-success" role="status">
        <span className="recovery-success__icon" aria-hidden="true">✓</span>
        <h3>Mot de passe réinitialisé</h3>
        <p>
          Votre nouveau mot de passe est enregistré. Le lien reçu par e-mail ne peut plus être
          réutilisé.
        </p>
        <Link className="login-submit recovery-link-button" to="/login">
          Se connecter
        </Link>
      </div>
    )
  } else {
    content = (
      <form className="login-form login-form--recovery" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label className="form-label" htmlFor="new-password">
            Nouveau mot de passe
          </label>
          <div className="login-input login-password">
            <span className="login-input__icon">
              <LockIcon />
            </span>
            <input
              id="new-password"
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Votre nouveau mot de passe"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={64}
            />
            <button
              type="button"
              className="login-toggle"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="confirm-password">
            Confirmer le mot de passe
          </label>
          <div className="login-input">
            <span className="login-input__icon">
              <LockIcon />
            </span>
            <input
              id="confirm-password"
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="Confirmez votre mot de passe"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={64}
            />
          </div>
        </div>

        <div className="password-rules" aria-label="Règles du mot de passe">
          <span className={rules.length ? 'is-valid' : ''}>✓ 12 à 64 caractères</span>
          <span className={passwordsMatch ? 'is-valid' : ''}>✓ Les deux saisies sont identiques</span>
        </div>

        {error && (
          <p className="login-message login-message--error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="login-submit" disabled={submitting || !formValid}>
          {submitting ? 'Enregistrement…' : 'Réinitialiser mon mot de passe'}
        </button>

        <Link className="recovery-back" to="/login">
          ← Retour à la connexion
        </Link>
      </form>
    )
  }

  return (
    <PasswordRecoveryLayout
      title="Réinitialiser le mot de passe"
      subtitle="Choisissez un nouveau mot de passe pour votre compte GMES."
      securityText="Lien à usage unique — valable pendant 1 heure"
    >
      {content}
    </PasswordRecoveryLayout>
  )
}
