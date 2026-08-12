import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeCompactFR } from '@/utils/format'
import { evaluateNotice } from '@/utils/leaveNotice'
import { calculateDeductedDaysPreview } from '@/utils/leaveDuration'

const DEROGATION_LABELS = {
  EN_ATTENTE_RH: 'En attente de décision RH',
  ACCORDEE: 'Accordée par la RH',
  REFUSEE: 'Refusée par la RH',
  EXPIREE: 'Expirée',
  UTILISEE: 'Utilisée',
}

function SoldeRow({ label, value, tone }) {
  return (
    <div className={`nr-solde__row${tone ? ` nr-solde__row--${tone}` : ''}`}>
      <span className="nr-solde__label">{label}</span>
      <span className="nr-solde__value">{value}</span>
    </div>
  )
}

export function RecapCard({
  selection,
  leaveType,
  balance,
  settings,
  seasonal,
  holidays,
  draft,
  dirty,
  derogation,
  saving,
  submitting,
  onSaveDraft,
  onSubmit,
  onRequestDerogation,
}) {
  const [derogationFormOpen, setDerogationFormOpen] = useState(false)
  const [derogationReason, setDerogationReason] = useState('')
  const [derogationSending, setDerogationSending] = useState(false)
  const [derogationError, setDerogationError] = useState(null)

  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const periodComplete = Boolean(startDate && endDate)

  const notice =
    periodComplete && settings && seasonal
      ? evaluateNotice({ startIso: startDate, endIso: endDate, settings, seasonal })
      : null

  const draftClean = Boolean(draft) && !dirty
  const previewDeductedDays = periodComplete
    ? calculateDeductedDaysPreview(selection, holidays)
    : null
  const deductedDays = draftClean ? draft.deductedDays : previewDeductedDays
  const deductedDaysSource = draftClean ? 'server' : 'preview'

  const startLabel = startPeriod === 'MATIN' ? 'matin' : 'après-midi'
  const endLabel = endPeriod === 'MATIN' ? 'matin' : 'après-midi'
  const halfDayLabel =
    startPeriod === 'MATIN' && endPeriod === 'APRES_MIDI'
      ? null
      : startDate === endDate
        ? startLabel
        : `${startLabel} → ${endLabel}`

  const derogationAllowed =
    notice &&
    draftClean &&
    !notice.isNoticeCompliant &&
    notice.isDerogationWindow &&
    !derogation

  const submitAllowed =
    periodComplete &&
    Boolean(leaveType) &&
    (!notice || notice.isNoticeCompliant || (draftClean && derogation?.status === 'ACCORDEE'))

  const submitHint =
    notice && !notice.isNoticeCompliant
      ? derogation?.status === 'ACCORDEE' && draftClean
        ? 'Dérogation accordée — la soumission est possible.'
        : notice.daysBeforeStart < 0
          ? 'La date de départ est dépassée : la soumission est impossible.'
          : notice.daysBeforeStart < 3
            ? 'Départ à moins de J-2 : la soumission est impossible.'
            : draftClean
              ? 'Une dérogation RH accordée est requise pour soumettre.'
              : 'Enregistrez en brouillon pour pouvoir demander une dérogation RH.'
      : null

  const handleDerogationSubmit = async () => {
    setDerogationError(null)
    if (derogationReason.trim().length < 10) {
      setDerogationError('La motivation doit contenir au moins 10 caractères.')
      return
    }
    setDerogationSending(true)
    try {
      await onRequestDerogation({ leaveRequestId: draft.id, reason: derogationReason.trim() })
      setDerogationFormOpen(false)
      setDerogationReason('')
    } catch {
      setDerogationFormOpen(false)
    } finally {
      setDerogationSending(false)
    }
  }

  return (
    <aside className="nr-recap">
      <div className="nr-recap__header">
        <h3>Récapitulatif</h3>
      </div>

      {!periodComplete ? (
        <div className="nr-recap__empty">
          <span className="nr-recap__empty-icon">
            <Icon name="calendar" size={22} />
          </span>
          <p className="nr-recap__empty-title">Sélectionnez vos dates</p>
          <p className="nr-recap__empty-text">
            Cliquez sur le premier puis le dernier jour dans le calendrier.
          </p>
        </div>
      ) : (
        <div className="nr-recap__content">
          <section className="nr-recap__block">
            <h4 className="nr-recap__subtitle">Période</h4>
            <p className="nr-recap__period-line">{formatRangeCompactFR(startDate, endDate)}</p>
            {halfDayLabel && <span className="nr-recap__halfday">{halfDayLabel}</span>}
            {leaveType && <span className="nr-recap__type">{leaveType.name}</span>}
          </section>

          <section className="nr-recap__block">
            <h4 className="nr-recap__subtitle">Jours décomptés</h4>
            <p className="nr-recap__days">
              {deductedDays != null ? (
                <>
                  <strong>{formatDays(deductedDays)}</strong>
                  <span>
                    {deductedDays === 1 ? 'jour' : 'jours'}
                    <em>décomptés pour cette demande</em>
                  </span>
                </>
              ) : (
                <span className="nr-recap__days--pending">—</span>
              )}
            </p>
            <p className="nr-recap__note">
              {deductedDays != null
                ? deductedDaysSource === 'server'
                  ? 'Calcul confirmé. Les dimanches et jours non décomptables sont exclus.'
                  : 'Calcul en temps réel. Les dimanches et jours non décomptables sont exclus.'
                : 'Sélectionnez une période complète pour calculer le décompte.'}
            </p>
          </section>

          {notice && (
            <section className="nr-recap__block">
              <h4 className="nr-recap__subtitle">Délai de prévenance</h4>
              {notice.isNoticeCompliant ? (
                <p className="nr-notice nr-notice--ok">
                  <Icon name="check" size={15} />
                  <span>
                    Délai respecté
                    <em>Minimum {notice.requiredNoticeDays} jours calendaires</em>
                  </span>
                </p>
              ) : notice.isDerogationWindow ? (
                <p className="nr-notice nr-notice--warn">
                  <Icon name="alert" size={15} />
                  <span>
                    Dérogation nécessaire
                    <em>
                      Entre J-29 et J-3 — délai exigé {notice.requiredNoticeDays} jours
                      {notice.isLongLeave || notice.overlapsSummerPeriod
                        ? ' (période spéciale)'
                        : ''}
                    </em>
                  </span>
                </p>
              ) : (
                <p className="nr-notice nr-notice--danger">
                  <Icon name="alert" size={15} />
                  <span>
                    Soumission impossible
                    <em>
                      {notice.daysBeforeStart < 0
                        ? 'La date de départ est dépassée.'
                        : 'La demande doit être déposée au plus tard à J-2.'}
                    </em>
                  </span>
                </p>
              )}
              {(notice.isLongLeave || notice.overlapsSummerPeriod) &&
                notice.isNoticeCompliant && (
                  <p className="nr-recap__note">
                    Période spéciale : durée ≥ {settings.SPECIAL_DURATION_THRESHOLD_DAYS} jours
                    ou chevauchement de la période estivale — délai de{' '}
                    {notice.requiredNoticeDays} jours.
                  </p>
                )}
            </section>
          )}

          {leaveType?.deductsPaidLeaveBalance ? (
            balance ? (
              <section className="nr-recap__block">
                <h4 className="nr-recap__subtitle">Solde congés payés</h4>
                <div className="nr-solde">
                  <SoldeRow label="Disponible aujourd’hui" value={`${formatDays(balance.availableDays)} j`} />
                  <SoldeRow
                    label="Déjà réservés"
                    value={`−${formatDays(balance.reservedDays)} j`}
                    tone="reserved"
                  />
                  <SoldeRow
                    label="Cette demande"
                    value={deductedDays != null ? `−${formatDays(deductedDays)} j` : '—'}
                    tone="danger"
                  />
                  <div className="nr-solde__divider" />
                  <SoldeRow
                    label="Disponible après cette demande"
                    value={`${formatDays(
                      deductedDays != null
                        ? balance.potentialDays - deductedDays
                        : balance.potentialDays,
                    )} j`}
                    tone="success"
                  />
                </div>
              </section>
            ) : (
              <section className="nr-recap__block">
                <h4 className="nr-recap__subtitle">Solde congés payés</h4>
                <p className="nr-recap__note">Solde indisponible pour le moment.</p>
              </section>
            )
          ) : (
            <section className="nr-recap__block">
              <h4 className="nr-recap__subtitle">Solde congés payés</h4>
              <p className="nr-notice nr-notice--neutral">
                <Icon name="info" size={15} />
                <span>Cette demande n’est pas déduite du solde de congés payés.</span>
              </p>
            </section>
          )}

          {derogation && (
            <section className="nr-recap__block">
              <h4 className="nr-recap__subtitle">Dérogation RH</h4>
              <span
                className={`nr-derogation-badge nr-derogation-badge--${derogation.status.toLowerCase()}`}
              >
                {DEROGATION_LABELS[derogation.status] ?? derogation.status}
              </span>
            </section>
          )}

          {derogationAllowed && !derogationFormOpen && (
            <button
              type="button"
              className="nr-recap__derogation-cta"
              onClick={() => setDerogationFormOpen(true)}
            >
              <Icon name="alert" size={15} />
              Demander une dérogation
            </button>
          )}

          {derogationFormOpen && (
            <div className="nr-derogation-form">
              <label className="nr-derogation-form__label" htmlFor="derogation-reason">
                Motivation de la dérogation
              </label>
              <textarea
                id="derogation-reason"
                className="nr-derogation-form__textarea"
                rows="3"
                maxLength={2000}
                value={derogationReason}
                onChange={(event) => setDerogationReason(event.target.value)}
                placeholder="Expliquez le motif de votre demande hors délai…"
              />
              <p className="nr-derogation-form__count">
                {derogationReason.trim().length}/2000 — minimum 10 caractères
              </p>
              {derogationError && <p className="nr-derogation-form__error">{derogationError}</p>}
              <div className="nr-derogation-form__actions">
                <button
                  type="button"
                  className="nr-btn nr-btn--ghost"
                  onClick={() => {
                    setDerogationFormOpen(false)
                    setDerogationReason('')
                    setDerogationError(null)
                  }}
                  disabled={derogationSending}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="nr-btn nr-btn--secondary"
                  onClick={handleDerogationSubmit}
                  disabled={derogationSending || derogationReason.trim().length < 10}
                >
                  {derogationSending ? 'Envoi…' : 'Envoyer la demande'}
                </button>
              </div>
            </div>
          )}

          <div className="nr-recap__actions">
            <button
              type="button"
              className="nr-btn nr-btn--secondary"
              onClick={onSaveDraft}
              disabled={!periodComplete || saving || submitting}
            >
              {saving ? (
                <>
                  <span className="nr-spinner" /> Enregistrement…
                </>
              ) : draftClean ? (
                'Modifier le brouillon'
              ) : (
                'Enregistrer en brouillon'
              )}
            </button>
            <button
              type="button"
              className="nr-btn nr-btn--primary"
              onClick={onSubmit}
              disabled={!submitAllowed || saving || submitting}
            >
              {submitting ? (
                <>
                  <span className="nr-spinner" /> Soumission…
                </>
              ) : (
                'Signer et soumettre'
              )}
            </button>
            {submitHint && !submitting && <p className="nr-recap__hint">{submitHint}</p>}
          </div>
        </div>
      )}
    </aside>
  )
}
