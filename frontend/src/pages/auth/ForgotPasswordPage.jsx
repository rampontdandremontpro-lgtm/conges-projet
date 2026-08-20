import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'

import { PasswordRecoveryLayout, MailIcon } from '@/components/auth/PasswordRecoveryLayout'
import { useAuth } from '@/auth/AuthContext'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import { requestPasswordReset } from '@/services/auth/passwordRecovery'

export function ForgotPasswordPage() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const initialEmail = typeof location.state?.email === 'string' ? location.state.email : ''
  const [email, setEmail] = useState(initialEmail)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useAutoDismiss(error, setError, { clearValue: '' })

  if (isAuthenticated) {
    return <Navigate to="/app/dashboard" replace />
  }

  async function sendResetRequest() {
    setError('')
    setSubmitting(true)

    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      const message = err.response?.data?.message
      if (typeof message === 'string' && message.trim()) {
        setError(message)
      } else {
        setError('Impossible d’envoyer la demande pour le moment. Veuillez réessayer.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await sendResetRequest()
  }

  return (
    <PasswordRecoveryLayout
      title="Mot de passe oublié"
      subtitle="Recevez un lien sécurisé pour définir un nouveau mot de passe."
      securityText="Lien sécurisé et valable pendant 1 heure"
    >
      {sent ? (
        <div className="recovery-success" role="status">
          <span className="recovery-success__icon" aria-hidden="true">✓</span>
          <h3>Consultez votre boîte e-mail</h3>
          <p>
            Si un compte actif correspond à <strong>{email.trim()}</strong>, un lien de
            réinitialisation vient d’être envoyé. Pensez aussi à vérifier vos courriers indésirables.
          </p>
          <button
            type="button"
            className="login-submit recovery-resend"
            disabled={submitting}
            onClick={sendResetRequest}
          >
            {submitting ? 'Envoi en cours…' : 'Renvoyer le lien'}
          </button>
          <Link className="recovery-back" to="/login">
            ← Retour à la connexion
          </Link>
        </div>
      ) : (
        <form className="login-form login-form--recovery" onSubmit={handleSubmit} noValidate>
          <div className="recovery-help">
            Indiquez l’adresse e-mail associée à votre compte GMES. Pour des raisons de sécurité,
            nous afficherons le même message qu’un compte existe ou non.
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="forgot-email">
              Adresse e-mail
            </label>
            <div className="login-input">
              <span className="login-input__icon">
                <MailIcon />
              </span>
              <input
                id="forgot-email"
                className="form-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="vous@gmes.fr"
                autoComplete="email"
                required
              />
            </div>
          </div>

          {error && (
            <p className="login-message login-message--error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={submitting || !email.trim()}>
            {submitting ? 'Envoi en cours…' : 'Envoyer le lien de réinitialisation'}
          </button>

          <Link className="recovery-back" to="/login">
            ← Retour à la connexion
          </Link>
        </form>
      )}
    </PasswordRecoveryLayout>
  )
}
