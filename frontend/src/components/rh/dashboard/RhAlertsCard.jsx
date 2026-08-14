export function RhAlertsCard({ alerts }) {
  const items = [
    {
      key: 'urgent',
      visible: (alerts?.urgentRequests ?? 0) > 0,
      className: 'danger',
      text: `${alerts?.urgentRequests ?? 0} demande(s) urgente(s) en attente`,
    },
    {
      key: 'documents',
      visible: (alerts?.documentsToVerify ?? 0) > 0,
      className: 'warning',
      text: `${alerts?.documentsToVerify ?? 0} justificatif(s) à vérifier`,
    },
    {
      key: 'waiting-documents',
      visible: (alerts?.waitingJustificatifs ?? 0) > 0,
      className: 'info',
      text: `${alerts?.waitingJustificatifs ?? 0} justificatif(s) encore attendu(s)`,
    },
    {
      key: 'derogations',
      visible: (alerts?.derogationsPending ?? 0) > 0,
      className: 'info',
      text: `${alerts?.derogationsPending ?? 0} dérogation(s) à traiter`,
    },
  ].filter((item) => item.visible)

  return (
    <section className="dash-card rh-alerts-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Alertes</h2>
      </header>
      {items.length === 0 ? (
        <div className="alert-list">
          <div className="alert-pill alert-pill--success">Aucune alerte RH prioritaire.</div>
        </div>
      ) : (
        <div className="alert-list">
          {items.map((item) => (
            <div key={item.key} className={`alert-pill rh-alert-pill--${item.className}`}>
              {item.text}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
