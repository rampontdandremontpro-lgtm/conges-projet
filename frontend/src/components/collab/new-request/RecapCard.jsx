import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeCompactFR } from '@/utils/format'
import { formatRelativeReferencePeriod } from '@/utils/referencePeriods'
import { buildRequestRightsSituation } from '@/utils/requestRightsSituation'
import { evaluateNotice } from '@/utils/leaveNotice'
import { calculateDeductedDaysPreview } from '@/utils/leaveDuration'

function departureTimingLabel(daysBeforeStart) {
  if (daysBeforeStart === 0) {
    return 'Le départ est prévu aujourd’hui'
  }
  if (daysBeforeStart === 1) {
    return 'Le départ est prévu demain'
  }
  return `Le départ est prévu dans ${daysBeforeStart} jours`
}

function lateSubmissionMessage(daysBeforeStart) {
  if (daysBeforeStart < 0) {
    return 'La date de départ est déjà passée. Cette demande ne peut plus être soumise.'
  }
  return `${departureTimingLabel(daysBeforeStart)}. Une dérogation peut être demandée jusqu’au début du congé.`
}


export function RecapCard({
  selection,
  leaveType,
  projection,
  projectionLoading = false,
  periodSummaries = [],
  selectedReferencePeriod = null,
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
  derogationReason = '',
  onDerogationReasonChange,
  editingExisting = false,
  preparationMode = false,
  preparedForName = '',
  isAnticipatedLeave = false,
}) {
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
  const rightsSituation = buildRequestRightsSituation({
    periodSummaries,
    projection,
    selectedReferencePeriod,
  })

  const startLabel = startPeriod === 'MATIN' ? 'matin' : 'après-midi'
  const endLabel = endPeriod === 'MATIN' ? 'matin' : 'après-midi'
  const halfDayLabel = startDate === endDate
    ? startPeriod === 'MATIN' && endPeriod === 'APRES_MIDI'
      ? 'journée entière'
      : startLabel
    : startPeriod === 'MATIN' && endPeriod === 'APRES_MIDI'
      ? null
      : `${startLabel} → ${endLabel}`

  const derogationNeeded =
    !preparationMode &&
    notice &&
    !notice.isNoticeCompliant &&
    notice.isDerogationWindow

  const submitAllowed =
    periodComplete &&
    Boolean(leaveType) &&
    (!notice || notice.isNoticeCompliant || notice.isDerogationWindow)

  const submitHint =
    notice && !notice.isNoticeCompliant
      ? notice.daysBeforeStart < 0
        ? 'La date de départ est dépassée : la soumission est impossible.'
        : !notice.isDerogationWindow
          ? lateSubmissionMessage(notice.daysBeforeStart)
          : 'Une dérogation sera soumise avec votre demande et examinée par la RH.'
      : null

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
                  ? 'Calcul confirmé.'
                  : 'Calcul en temps réel.'
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
                    <em>Cette demande est effectuée moins de {notice.requiredNoticeDays} jours calendaires avant le début du congé. Le délai de prévenance n’est pas respecté : une dérogation est nécessaire pour poursuivre.</em>
                  </span>
                </p>
              ) : (
                <p className="nr-notice nr-notice--danger">
                  <Icon name="alert" size={15} />
                  <span>
                    Soumission impossible
                    <em>
                      {lateSubmissionMessage(notice.daysBeforeStart)}
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

          {leaveType?.deductsPaidLeaveBalance && (
            <section className="nr-recap__block nr-recap__rights-block">
              <div className="nr-recap__rights-titleline">
                <h4 className="nr-recap__subtitle">Situation de vos congés</h4>
              </div>
              {isAnticipatedLeave && (
                <div className="nr-anticipated-panel" role="note">
                  <div className="nr-anticipated-panel__head">
                    <span className="nr-anticipated-panel__icon"><Icon name="calendar" size={15} /></span>
                    <strong>Congé anticipé</strong>
                    <span className="nr-anticipated-panel__badge">N+1</span>
                  </div>
                  <p className="nr-anticipated-panel__text">
                    Ce congé est prévu sur la prochaine période de référence. Les droits acquis disponibles seront utilisés en priorité. Les indicateurs ci-dessous présentent les droits concernés par cette demande.
                  </p>
                </div>
              )}
              {!isAnticipatedLeave && <p className="nr-recap__rights-note">Les indicateurs ci-dessous correspondent aux périodes concernées par votre demande.</p>}
              {projectionLoading ? (
                <p className="nr-recap__rights-note">Actualisation des indicateurs…</p>
              ) : rightsSituation.length > 0 ? (
                <div className="nr-rights-impact">
                  {rightsSituation.map((item) => (
                    <div className="nr-rights-impact__period" key={item.referencePeriod}>
                      <strong>{formatRelativeReferencePeriod(item.referencePeriod)}</strong>
                      <span>Pris <b>{formatDays(item.metrics.takenDays)} j</b></span>
                      <span>En attente <b>{formatDays(item.metrics.pendingDays)} j</b></span>
                      <span>Validées <b>{formatDays(item.metrics.validatedDays)} j</b></span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="nr-recap__rights-note">Les indicateurs de cette période ne sont pas disponibles.</p>
              )}
            </section>
          )}

          {derogationNeeded && (
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
                onChange={(event) => onDerogationReasonChange?.(event.target.value)}
                placeholder="Vous pouvez préciser le motif de votre demande hors délai…"
              />
              <p className="nr-derogation-form__count">
                {derogationReason.trim().length}/2000 — facultatif
              </p>
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
