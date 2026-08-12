import { formatDays } from '@/utils/format'

function signedDays(value) {
  const number = Number(value) || 0
  return number > 0 ? `-${formatDays(number)} j` : `${formatDays(number)} j`
}

export function BalanceOverview({ available, acquisition, forecast, reserved, acquisitionSubtitle }) {
  const potential = Math.max(0, forecast - reserved)
  const progress = forecast > 0 ? Math.max(0, Math.min(100, (potential / forecast) * 100)) : 0

  return (
    <>
      <section className="balances-overview">
        <div className="balances-overview__metric">
          <span>Congés à utiliser</span>
          <strong>{formatDays(available)}</strong>
          <small>Solde disponible aujourd&apos;hui</small>
        </div>
        <div className="balances-overview__metric balances-overview__metric--cyan">
          <span>En cours d&apos;acquisition</span>
          <strong>{formatDays(acquisition)}</strong>
          <small>{acquisitionSubtitle}</small>
        </div>
        <div className="balances-overview__metric balances-overview__metric--light">
          <span>Prévisionnels</span>
          <strong>{formatDays(forecast)}</strong>
          <small>Projection fin de période</small>
        </div>
        <div className="balances-overview__metric balances-overview__metric--orange">
          <span>Jours réservés</span>
          <strong>{formatDays(reserved)}</strong>
          <small>Demandes validées / en attente</small>
        </div>
      </section>

      <section className="balances-potential-card">
        <span className="balances-potential-card__eyebrow">Solde potentiel fin de période</span>
        <div className="balances-potential-card__body">
          <div className="balances-potential-card__primary">
            <strong>{formatDays(potential)} j</strong>
            <span>Prévisionnels ({formatDays(forecast)}) − Réservés ({formatDays(reserved)})</span>
          </div>
          <div className="balances-potential-card__details">
            <span>
              Acquis : <strong>{formatDays(forecast)} j</strong>
            </span>
            <span>
              Réservés : <strong className="is-negative">{signedDays(reserved)}</strong>
            </span>
            <span>
              = Potentiel : <strong className="is-positive">{formatDays(potential)} j</strong>
            </span>
          </div>
        </div>
        <div className="balances-potential-card__progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>
    </>
  )
}
