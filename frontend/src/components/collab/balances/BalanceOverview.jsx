import { formatDays } from '@/utils/format'

function reservedLabel(value) {
  const days = Number(value) || 0
  return days > 0 ? `-${formatDays(days)} j` : `${formatDays(days)} j`
}

export function BalanceOverview({ available, acquisition, reserved, potential, acquisitionSubtitle }) {
  const progress = available > 0 ? Math.max(0, Math.min(100, (potential / available) * 100)) : 0

  return (
    <>
      <section className="balances-overview balances-overview--simple">
        <div className="balances-overview__metric">
          <span>Congés à utiliser</span>
          <strong>{formatDays(available)}</strong>
          <small>Disponibles aujourd&apos;hui</small>
        </div>
        <div className="balances-overview__metric balances-overview__metric--cyan">
          <span>En cours d&apos;acquisition</span>
          <strong>{formatDays(acquisition)}</strong>
          <small>{acquisitionSubtitle}</small>
        </div>
      </section>

      <section className="balances-impact-card">
        <div className="balances-impact-card__heading">
          <div>
            <span className="balances-impact-card__eyebrow">Impact des demandes en cours</span>
            <strong>{formatDays(potential)} j</strong>
            <p>encore disponibles après les réservations</p>
          </div>
          <div className="balances-impact-card__numbers">
            <span>
              Solde réel <strong>{formatDays(available)} j</strong>
            </span>
            <span>
              Jours réservés <strong className="is-negative">{reservedLabel(reserved)}</strong>
            </span>
            <span>
              Disponible <strong className="is-positive">{formatDays(potential)} j</strong>
            </span>
          </div>
        </div>
        <div className="balances-impact-card__progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="balances-impact-card__help">
          Une demande de congés payés en attente réserve les jours, mais ne diminue pas encore votre solde réel.
        </p>
      </section>
    </>
  )
}
