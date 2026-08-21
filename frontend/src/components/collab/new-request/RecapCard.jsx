import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import { formatDays, formatRangeCompactFR } from '@/utils/format'
import { buildNoticeRules, evaluateNotice } from '@/utils/leaveNotice'
import { calculateDeductedDaysPreview } from '@/utils/leaveDuration'

const DEROGATION_LABELS = {
  EN_ATTENTE_RH: 'En attente de décision RH',
  EN_ATTENTE_DIRECTEUR: 'Validée par la RH · en attente du Directeur',
  ACCORDEE: 'Accordée par la RH et le Directeur',
  REFUSEE: 'Refusée par la RH',
  EXPIREE: 'Expirée',
  UTILISEE: 'Utilisée',
}

function departureTimingLabel(daysBeforeStart) {
  if (daysBeforeStart === 0) {
    return 'Le départ est prévu aujourd’hui'
  }
  if (daysBeforeStart === 1) {
    return 'Le départ est prévu demain'
  }
  return `Le départ est prévu dans ${daysBeforeStart} jours`
}

function lateSubmissionMessage(daysBeforeStart, derogationLastAllowedDay) {
  if (daysBeforeStart < 0) {
    return 'La date de départ est déjà passée. Cette demande ne peut plus être soumise.'
  }
  return `${departureTimingLabel(daysBeforeStart)}. Une dérogation RH n’est possible que jusqu’à ${derogationLastAllowedDay} jours avant le départ.`
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
  editingExisting = false,
  preparationMode = false,
  preparedForName = '',
}) {
  const [derogationFormOpen, setDerogationFormOpen] = useState(false)
  const [derogationReason, setDerogationReason] = useState('')
  const [derogationSending, setDerogationSending] = useState(false)
  const [derogationError, setDerogationError] = useState(null)

  useAutoDismiss(derogationError, setDerogationError)

  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const periodComplete = Boolean(startDate && endDate)

  const notice =
    periodComplete && settings && seasonal
      ? evaluateNotice({ startIso: startDate, endIso: endDate, settings, seasonal })
      : null
  const noticeRules = settings ? buildNoticeRules(settings, seasonal) : null
  const derogationLastAllowedDay = noticeRules?.derogationLastAllowedDay ?? 3

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

  const derogationNeeded =
    !preparationMode &&
    notice &&
    !notice.isNoticeCompliant &&
    notice.isDerogationWindow

  const derogationWorkflowStatus = derogation?.workflowStatus ?? (derogation?.status === 'EN_ATTENTE_RH' && derogation?.decidedByRhId ? 'EN_ATTENTE_DIRECTEUR' : derogation?.status)

  const derogationAllowed = Boolean(
    derogationNeeded &&
      (!derogation || derogation.status === 'EXPIREE'),
  )

  const submitAllowed =
    periodComplete &&
    Boolean(leaveType) &&
    (!notice || notice.isNoticeCompliant || (draftClean && derogationWorkflowStatus === 'ACCORDEE'))

  const submitHint =
    notice && !notice.isNoticeCompliant
      ? derogationWorkflowStatus === 'ACCORDEE' && draftClean
        ? 'Dérogation accordée — la soumission est possible.'
        : notice.daysBeforeStart < 0
          ? 'La date de départ est dépassée : la soumission est impossible.'
          : !notice.isDerogationWindow
            ? lateSubmissionMessage(notice.daysBeforeStart, derogationLastAllowedDay)
            : derogationWorkflowStatus === 'EN_ATTENTE_RH'
              ? 'Votre demande de dérogation est en attente de décision RH.'
              : derogationWorkflowStatus === 'EN_ATTENTE_DIRECTEUR'
                ? 'La RH a validé la dérogation. Elle est en attente de la décision finale du Directeur.'
                : derogationWorkflowStatus === 'REFUSEE'
                  ? 'La dérogation a été refusée. Modifiez les dates si nécessaire.'
                  : 'Une dérogation validée par la RH puis le Directeur est requise pour soumettre.'
      : null

  useEffect(() => {
    if (derogationAllowed) {
      return
    }

    setDerogationFormOpen(false)
    setDerogationReason('')
    setDerogationError(null)
  }, [derogationAllowed])

  const handleDerogationSubmit = async () => {
    setDerogationError(null)
    setDerogationSending(true)
    try {
      await onRequestDerogation({ reason: derogationReason.trim() })
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
                  ? 'Calcul confirmé. Un vendredi posé décompte aussi le samedi suivant ; les dimanches et jours non décomptables sont exclus.'
                  : 'Calcul en temps réel. Un vendredi posé décompte aussi le samedi suivant ; les dimanches et jours non décomptables sont exclus.'
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
                      {lateSubmissionMessage(
                        notice.daysBeforeStart,
                        derogationLastAllowedDay,
                      )}
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
                  {Number(balance.reservedDays ?? 0) > 0 && (
                    <SoldeRow
                      label="Déjà réservés"
                      value={`−${formatDays(balance.reservedDays)} j`}
                      tone="reserved"
                    />
                  )}
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

          {!preparationMode && derogation && (
            <section className="nr-recap__block">
              <h4 className="nr-recap__subtitle">Dérogation RH</h4>
              <span
                className={`nr-derogation-badge nr-derogation-badge--${derogation.status.toLowerCase()}`}
              >
                {DEROGATION_LABELS[derogationWorkflowStatus] ?? derogation.status}
              </span>
            </section>
          )}

          {derogationAllowed && !derogationFormOpen && (
            <button
              type="button"
              className="nr-recap__derogation-cta"
              onClick={() => setDerogationFormOpen(true)}
              disabled={saving || submitting}
            >
              <Icon name="alert" size={15} />
              {derogation?.status === 'EXPIREE'
                ? 'Demander une nouvelle dérogation'
                : 'Demander une dérogation'}
            </button>
          )}

          {derogationFormOpen && (
            <div className="nr-derogation-form">
              <label className="nr-derogation-form__label" htmlFor="derogation-reason">
                Motif de la dérogation (facultatif)
              </label>
              <textarea
                id="derogation-reason"
                className="nr-derogation-form__textarea"
                rows="3"
                maxLength={2000}
                value={derogationReason}
                onChange={(event) => setDerogationReason(event.target.value)}
                placeholder="Vous pouvez préciser le motif de votre demande hors délai…"
              />
              <p className="nr-derogation-form__count">
                {derogationReason.trim().length}/2000 — facultatif
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
                  disabled={derogationSending || saving || submitting}
                >
                  {derogationSending ? 'Envoi…' : 'Envoyer la demande'}
                </button>
              </div>
            </div>
          )}

          <div className="nr-recap__actions">
            <button
              type="button"
              className={preparationMode ? 'nr-btn nr-btn--primary' : 'nr-btn nr-btn--secondary'}
              onClick={onSaveDraft}
              disabled={!periodComplete || saving || submitting}
            >
              {saving ? (
                <>
                  <span className="nr-spinner" /> Enregistrement…
                </>
              ) : preparationMode ? (
                'Préparer le brouillon'
              ) : editingExisting ? (
                'Enregistrer les modifications'
              ) : draftClean ? (
                'Modifier le brouillon'
              ) : (
                'Enregistrer en brouillon'
              )}
            </button>
            {!preparationMode && (
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
            )}
            {preparationMode ? (
              <p className="nr-recap__hint nr-recap__hint--prep">
                {preparedForName || 'Le collaborateur'} retrouvera ce brouillon dans Mes demandes. Il pourra le vérifier, le modifier si nécessaire, puis le signer et le soumettre lui-même.
              </p>
            ) : (
              submitHint && !submitting && <p className="nr-recap__hint">{submitHint}</p>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
