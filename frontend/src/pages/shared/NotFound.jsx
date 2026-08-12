import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="standalone-page">
      <div className="standalone-card">
        <h1>404</h1>
        <p>Cette page n&apos;existe pas ou a été déplacée.</p>
        <Link to="/" className="link-button">
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
