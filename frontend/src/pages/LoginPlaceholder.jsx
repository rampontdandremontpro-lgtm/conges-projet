import { Link } from 'react-router-dom'

export function LoginPlaceholder() {
  return (
    <div className="standalone-page">
      <div className="standalone-card">
        <span className="standalone-card__logo">G</span>
        <h1>Connexion</h1>
        <p>
          Le module d&apos;authentification sera intégré dans une prochaine
          itération.
        </p>
        <Link to="/" className="link-button">
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
