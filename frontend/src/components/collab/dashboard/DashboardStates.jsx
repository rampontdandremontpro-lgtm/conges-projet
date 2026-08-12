import { Icon } from '@/components/ui/Icon'

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="dash-skeleton-card" aria-hidden="true">
      <div className="skeleton-line skeleton-line--title" />
      <div className="skeleton-line skeleton-line--big" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton-line" />
      ))}
    </div>
  )
}

export function CardError({ message, onRetry }) {
  return (
    <div className="dash-card-error" role="alert">
      <span className="dash-card-error__icon">
        <Icon name="alert" size={20} />
      </span>
      <p>{message ?? 'Impossible de charger les informations du tableau de bord.'}</p>
      {onRetry && (
        <button type="button" className="dash-btn dash-btn--ghost" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  )
}
