import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeNumericFR } from '@/utils/format'


export function ManagerRecentRequestsCard({ requests, loading, error, onRetry, onViewAll, onOpenRequest }) {
  return (
    <section className="dash-card manager-recent-card">
      <div className="dash-card__header">
        <div className="dash-card__heading">
          <span className="dash-card__title dash-card__title--lg">Demandes récentes à traiter</span>
        </div>
        <button className="dash-card__view-all" type="button" onClick={onViewAll}>
          Voir tout
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      {loading ? (
        <div className="manager-request-list">
          {[0, 1, 2].map((item) => (
            <div className="manager-request-row manager-request-row--loading" key={item}>
              <span className="manager-request-avatar" />
              <span className="manager-card-state__skeleton" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="manager-card-state manager-card-state--compact">
          <Icon name="alert" size={22} />
          <strong>Impossible de charger les demandes.</strong>
          <button type="button" onClick={onRetry}>Réessayer</button>
        </div>
      ) : requests.length === 0 ? (
        <div className="manager-empty-state">
          <span className="manager-empty-state__icon"><Icon name="check" size={22} /></span>
          <strong>Aucune demande à traiter</strong>
          <span>Votre file de validation est à jour.</span>
        </div>
      ) : (
        <div className="manager-request-list">
          {requests.slice(0, 4).map((request) => (
            <button className="manager-request-row" type="button" key={request.id} onClick={() => onOpenRequest?.(request.id)}>
              <ProfileAvatar user={request.employee} className="manager-request-avatar" />
              <span className="manager-request-main">
                <span className="manager-request-topline">
                  <strong>{request.employee?.nom} {request.employee?.prenom}</strong>
                  {request.isUrgent && <span className="manager-request-urgent">Urgente</span>}
                </span>
                <span className="manager-request-meta">
                  {request.leaveType?.name ?? 'Demande de congé'} · {formatRangeNumericFR(request.startDate, request.endDate)}
                </span>
              </span>
              <span className="manager-request-duration">{formatDays(request.deductedDays)} j</span>
              <Icon name="chevronRight" size={17} className="manager-request-chevron" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
