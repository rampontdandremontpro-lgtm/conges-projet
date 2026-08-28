import { createPortal } from 'react-dom'

import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeCompactFR } from '@/utils/format'
import { evaluateNotice } from '@/utils/leaveNotice'

function periodLabel(startPeriod, endPeriod, startDate, endDate) {
  if (startDate === endDate) {
    if (startPeriod === 'MATIN' && endPeriod === 'MATIN') return 'Matin'
    if (startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI') return 'Après-midi'
    return 'Journée entière'
  }
  const start = startPeriod === 'APRES_MIDI' ? 'Après-midi' : 'Matin'
  const end = endPeriod === 'MATIN' ? 'Matin' : 'Après-midi'
  return `${start} → ${end}`
}

function RightsImpact({ projection }) {
  if (!projection) return <p className="nr-review__muted">Impact non disponible.</p>

  return (
    <div className="nr-review__rights">
      {Number(projection.nMinus1Used ?? 0) > 0 && (
        <div>
          <strong>N-1 · {String(projection.nMinus1Period).replace('-', '/')}</strong>
          <span>{formatDays(projection.nMinus1Used)} j utilisés</span>
          <small>Solde après demande : {formatDays(projection.nMinus1BalanceAfter)} j</small>
        </div>
      )}
      {Number(projection.nUsed ?? 0) > 0 && (
        <div>
          <strong>N · {String(projection.nPeriod).replace('-', '/')}</strong>
          <span>{formatDays(projection.nUsed)} j utilisés</span>
          <small>Solde après demande : {formatDays(projection.nBalanceAfter)} j</small>
        </div>
      )}
    </div>
  )
}

export function RequestReviewModal({
  open,
  selection,
  employee,
  leaveType,
  deductedDays,
  projection,
  settings,
  seasonal,
  onClose,
  onConfirm,
}) {
  if (!open) return null

  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const notice = startDate && endDate && settings && seasonal
    ? evaluateNotice({ startIso: startDate, endIso: endDate, settings, seasonal })
    : null
  const derogationRequired = Boolean(notice && !notice.isNoticeCompliant && notice.isDerogationWindow)

  return createPortal(
    <div className="nr-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="nr-review" role="dialog" aria-modal="true" aria-labelledby="nr-review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="nr-review__head">
          <div>
            <span>RÉCAPITULATIF DE LA DEMANDE</span>
            <h3 id="nr-review-title">Vérifiez avant de signer</h3>
          </div>
          <button type="button" className="nr-modal__close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div className="nr-review__document">
          <div className="nr-review__brand"><Icon name="calendar" size={22} /><strong>G Congés & Absences</strong></div>
          <section className="nr-review__two-cols">
            <div><small>COLLABORATEUR</small><strong>{employee ? `${employee.nom ?? ''} ${employee.prenom ?? ''}`.trim() : '—'}</strong></div>
            <div><small>TYPE DE CONGÉ</small><strong>{leaveType?.name ?? '—'}</strong></div>
          </section>
          <section className="nr-review__two-cols">
            <div><small>PÉRIODE</small><strong>{startDate && endDate ? formatRangeCompactFR(startDate, endDate) : '—'}</strong></div>
            <div><small>JOURS DÉCOMPTÉS</small><strong>{deductedDays == null ? '—' : `${formatDays(deductedDays)} j`}</strong></div>
          </section>
          <section>
            <small>DÉPART / RETOUR</small>
            <strong>{startDate && endDate ? periodLabel(startPeriod, endPeriod, startDate, endDate) : '—'}</strong>
          </section>
          {leaveType?.deductsPaidLeaveBalance && (
            <section>
              <small>IMPACT PRÉVISIONNEL SUR VOS DROITS</small>
              <RightsImpact projection={projection} />
            </section>
          )}
          {derogationRequired && (
            <section className="nr-review__warning">
              <Icon name="alert" size={17} />
              <div><strong>Dérogation nécessaire</strong><p>Le délai de prévenance n’est pas respecté. Une dérogation est nécessaire pour poursuivre cette demande.</p></div>
            </section>
          )}
        </div>

        <div className="nr-review__question">
          <strong>Confirmez-vous que les informations de cette demande sont correctes ?</strong>
          <p>Vous pourrez encore revenir au formulaire avant la signature.</p>
        </div>
        <div className="nr-review__actions">
          <button type="button" className="nr-btn nr-btn--ghost" onClick={onClose}>Non, modifier ma demande</button>
          <button type="button" className="nr-btn nr-btn--primary" onClick={onConfirm}>Oui, continuer</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
