import gmesLogo from '@/assets/logo-gmes.png'

export function AuthLoading() {
  return (
    <div className="auth-loading">
      <img src={gmesLogo} alt="GMES" className="auth-loading__logo" />
      <span className="auth-loading__spinner" aria-hidden="true" />
    </div>
  )
}
