import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import { ManagerRefusalModal } from '@/components/manager/requests/ManagerRefusalModal'
import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import {
  getDirectorRequest,
  getDirectorRequestAvailability,
  refuseDirectorRequest,
  validateDirectorRequest,
} from '@/services/director/directorRequests'
import { formatDateNumericFR, formatDays, formatRangeNumericFR } from '@/utils/format'

import '@/styles/manager/requests/index.css'
import '@/styles/director/request-detail.css'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function periodLabel(value) {
  return value === 'APRES_MIDI' ? 'Après-midi' : 'Matin'
}

function treatmentLabel(request) {
  const accessKind = request?.decisionAccess?.kind
  const treatmentKind = request?.treatment?.kind

  if (accessKind === 'URGENCE' || request?.isUrgent) return 'Intervention urgente'
  if (accessKind === 'REMPLACEMENT' || treatmentKind === 'VALIDATEUR_TEMPORAIRE') return 'Valideur temporaire'
  if (accessKind === 'SECOURS') return 'Valideur de secours'

  if (treatmentKind === 'RESPONSABLE_SERVICE') return 'Responsable de service'
  if (treatmentKind === 'VALIDATEUR_SECOURS_DIRECTEUR') return 'Valideur de secours / Directeur'
  if (treatmentKind === 'RELAIS_DIRECTEUR') return 'Directeur en relais'
  if (treatmentKind === 'DIRECTEUR_SEUL') return 'Directeur seul'
  if (treatmentKind === 'DIRECTEUR_RH') return 'Directeur / RH'
  if (treatmentKind === 'SANS_VALIDATION') return 'Sans validation'

  if (request?.employee?.role === 'RH') return 'Directeur seul'
  if (request?.employee?.role === 'RESPONSABLE_SERVICE') return 'Directeur / RH'
  if (request?.service?.serviceType === 'EXTERNE') return 'Directeur / RH'
  if (request?.service?.validationMode === 'DIRECTEUR_SEUL') return 'Directeur seul'
  if (request?.service?.validationMode === 'DIRECTEUR_ET_RH') return 'Directeur / RH'
  if (request?.service?.validationMode === 'RESPONSABLE_PUIS_RELAIS') return 'Responsable de service'
  return 'Selon le paramétrage du service'
}

function requestStatusMeta(status) {
  if (status === 'EN_ATTENTE_VALIDATION') return { label: 'En attente', tone: 'pending', icon: 'clock' }
  if (status === 'VALIDEE') return { label: 'Validée', tone: 'approved', icon: 'check' }
  if (status === 'REFUSEE') return { label: 'Refusée', tone: 'refused', icon: 'alert' }
  if (status === 'ANNULATION_EN_ATTENTE_ACCORD') return { label: 'Annulation en attente', tone: 'pending', icon: 'clock' }
  if (status === 'ANNULEE_APRES_VALIDATION') return { label: 'Annulée après validation', tone: 'cancelled', icon: 'alert' }
  if (status === 'ANNULEE') return { label: 'Annulée', tone: 'cancelled', icon: 'alert' }
  if (status === 'EXPIREE_NON_VALIDEE') return { label: 'Expirée', tone: 'cancelled', icon: 'clock' }
  return { label: status || 'Traitée', tone: 'pending', icon: 'clock' }
}

export function DirectorRequestDecisionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const backPath = '/app/director-all-requests'
  const [state, setState] = useState({ loading: true, error: null, request: null, availability: null })
  const [showSignature, setShowSignature] = useState(false)
  const [showRefusal, setShowRefusal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [minimumPresenceJustification, setMinimumPresenceJustification] = useState('')

  useAutoDismiss(feedback, setFeedback)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: null }))
    }

    try {
      const request = await getDirectorRequest(id)
      let availability = null

      if (request?.status === 'EN_ATTENTE_VALIDATION') {
        try {
          availability = await getDirectorRequestAvailability(id)
        } catch {
          availability = null
        }
      }

      setState({ loading: false, error: null, request, availability })
    } catch (error) {
      if (!silent) {
        setState({
          loading: false,
          error: error.response?.data?.message || error.message || 'Impossible de charger cette demande.',
          request: null,
          availability: null,
        })
      }
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const employeeName = useMemo(() => {
    const employee = state.request?.employee
    return employee ? `${employee.prenom} ${employee.nom}` : ''
  }, [state.request])

  const handleValidate = () => {
    if (state.availability?.minimumPresenceBreached && !minimumPresenceJustification.trim()) {
      setFeedback({
        kind: 'error',
        message: 'Une justification est obligatoire car le seuil minimum de présence serait dépassé.',
      })
      return
    }

    setFeedback(null)
    setShowSignature(true)
  }

  const handleDecisionError = async (error, fallback) => {
    const message = error.response?.data?.message || error.message || fallback
    const isConflict = error.response?.status === 409

    setFeedback({
      kind: isConflict ? 'info' : 'error',
      message: isConflict
        ? 'Cette demande vient d’être traitée par un autre décideur. Les informations ont été actualisées.'
        : message,
    })

    if (isConflict) await load({ silent: true })
  }

  const confirmValidation = async (signatureType, signatureData) => {
    setSubmitting(true)
    setFeedback(null)

    try {
      await validateDirectorRequest(id, {
        signatureType,
        signatureData,
        minimumPresenceJustification: minimumPresenceJustification.trim() || undefined,
      })
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate(backPath, {
        replace: true,
        state: { flash: { kind: 'success', message: 'Demande validée avec succès.' } },
      })
    } catch (error) {
      await handleDecisionError(error, 'Impossible de valider cette demande.')
    } finally {
      setSubmitting(false)
      setShowSignature(false)
    }
  }

  const confirmRefusal = async (comment) => {
    setSubmitting(true)
    setFeedback(null)

    try {
      await refuseDirectorRequest(id, comment ? { comment } : {})
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate(backPath, {
        replace: true,
        state: { flash: { kind: 'success', message: 'Demande refusée.' } },
      })
    } catch (error) {
      await handleDecisionError(error, 'Impossible de refuser cette demande.')
    } finally {
      setSubmitting(false)
      setShowRefusal(false)
    }
  }

  if (state.loading) {
    return (
      <div className="manager-request-detail-page">
        <div className="manager-request-detail-loading">Chargement de la demande…</div>
      </div>
    )
  }

  if (state.error || !state.request) {
    return (
      <div className="manager-request-detail-page">
        <button type="button" className="manager-request-back" onClick={() => navigate(backPath)}>
          <Icon name="chevronLeft" size={16} /> Retour à toutes les demandes
        </button>
        <div className="manager-request-detail-state manager-request-detail-state--error">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger cette demande.</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => load()}>Réessayer</button>
        </div>
      </div>
    )
  }

  const request = state.request
  const availability = state.availability
  const overlapCount = availability?.overlaps?.length ?? 0
  const canDecide =
    request.status === 'EN_ATTENTE_VALIDATION' &&
    Boolean(request.decisionAccess) &&
    !request.finalDeciderId &&
    !request.lockedAt
  const readonlyStatus = requestStatusMeta(request.status)

  return (
    <div className="manager-request-detail-page director-request-detail-page">
      <button type="button" className="manager-request-back" onClick={() => navigate(backPath)}>
        <Icon name="chevronLeft" size={16} /> Retour à toutes les demandes
      </button>

      {feedback && (
        <div className={`manager-request-detail-feedback manager-request-detail-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'info' ? 'clock' : 'alert'} size={15} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)}>×</button>
        </div>
      )}

      <section className="manager-request-detail-hero">
        <span className="manager-request-detail-hero__avatar">
          {`${request.employee?.prenom?.[0] ?? ''}${request.employee?.nom?.[0] ?? ''}`.toUpperCase()}
        </span>
        <div className="director-request-hero-content">
          <span className="manager-request-detail-hero__eyebrow">DEMANDE DE CONGÉ N°{request.displayNumber ?? request.id}</span>
          <div className="manager-request-detail-hero__titleline">
            <h2>{employeeName}</h2>
            {request.status === 'EN_ATTENTE_VALIDATION' && request.isUrgent ? (
              <span className="manager-requests-badge manager-requests-badge--urgent"><Icon name="alert" size={12} /> Urgente</span>
            ) : (
              <span className={`manager-requests-badge manager-requests-badge--${readonlyStatus.tone}`}>
                <Icon name={readonlyStatus.icon} size={12} /> {readonlyStatus.label}
              </span>
            )}
          </div>
          <p>{request.leaveType?.name ?? 'Demande de congé'} · {request.service?.name ?? 'Service non renseigné'}</p>
          <span className="director-request-treatment">
            <span className="director-request-treatment__icon"><Icon name="shield" size={13} /></span>
            <span className="director-request-treatment__text">
              <small>Traitement</small>
              <strong>{treatmentLabel(request)}</strong>
            </span>
          </span>
        </div>
      </section>

      <div className="manager-request-detail-grid">
        <div className="manager-request-detail-main">
          <section className="manager-request-detail-card">
            <div className="manager-request-detail-card__heading">
              <span className="manager-request-detail-card__icon"><Icon name="calendar" size={18} /></span>
              <div><h3>Période demandée</h3><p>Détails enregistrés pour cette demande.</p></div>
            </div>
            <div className="manager-request-detail-info-grid">
              <div><small>Date de début</small><strong>{formatDateNumericFR(request.startDate)}</strong></div>
              <div><small>Date de fin</small><strong>{formatDateNumericFR(request.endDate)}</strong></div>
              <div><small>Durée</small><strong>{formatDays(Number(request.deductedDays) || 0)} j</strong></div>
              <div><small>Service</small><strong>{request.service?.name ?? '—'}</strong></div>
              <div><small>Premier jour</small><strong>{periodLabel(request.startPeriod)}</strong></div>
              <div><small>Dernier jour</small><strong>{periodLabel(request.endPeriod)}</strong></div>
            </div>
          </section>

          <section className="manager-request-detail-card">
            <div className="manager-request-detail-card__heading">
              <span className="manager-request-detail-card__icon"><Icon name="doc" size={18} /></span>
              <div><h3>Informations complémentaires</h3><p>Éléments transmis par le demandeur.</p></div>
            </div>
            <div className="manager-request-detail-note">
              <small>COMMENTAIRE</small>
              <p>{request.comment?.trim() || 'Aucun commentaire.'}</p>
            </div>
            <div className="manager-request-detail-info-grid manager-request-detail-info-grid--compact">
              <div><small>Soumise le</small><strong>{formatDateTime(request.submittedAt)}</strong></div>
              <div><small>Signée le</small><strong>{formatDateTime(request.employeeSignedAt)}</strong></div>
              <div><small>Type</small><strong>{request.leaveType?.name ?? '—'}</strong></div>
              <div><small>Période</small><strong>{formatRangeNumericFR(request.startDate, request.endDate)}</strong></div>
            </div>
          </section>

          {request.status === 'EN_ATTENTE_VALIDATION' && (
            <section className={`manager-request-detail-card manager-request-availability${availability?.minimumPresenceBreached ? ' is-warning' : ''}`}>
              <div className="manager-request-detail-card__heading">
                <span className="manager-request-detail-card__icon"><Icon name="users" size={18} /></span>
                <div><h3>Disponibilité du service</h3><p>Contrôle des chevauchements et de la présence minimale.</p></div>
              </div>

              {availability ? (
                <>
                  <div className="manager-request-availability__stats">
                    <div><small>Effectif actif</small><strong>{availability.totalActiveEmployees}</strong></div>
                    <div><small>Minimum requis</small><strong>{availability.minimumPresence ?? '—'}</strong></div>
                    <div><small>Minimum restant</small><strong>{availability.minimumRemainingEmployees}</strong></div>
                    <div><small>Chevauchements</small><strong>{overlapCount}</strong></div>
                  </div>

                  {availability.minimumPresenceBreached && (
                    <div className="manager-request-availability__warning">
                      <Icon name="alert" size={17} />
                      <span>La validation ferait passer le service sous le seuil minimum de présence. Une justification est obligatoire pour poursuivre.</span>
                    </div>
                  )}

                  {overlapCount > 0 && (
                    <div className="manager-request-overlaps">
                      <strong>Personnes déjà absentes ou en attente sur la période</strong>
                      {availability.overlaps.map((item) => (
                        <div className="manager-request-overlap-row" key={`${item.source}-${item.sourceId}`}>
                          <span>{item.prenom} {item.nom}</span>
                          <small>{formatRangeNumericFR(item.startDate, item.endDate)}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="manager-request-availability__empty">Les informations de disponibilité n’ont pas pu être chargées.</p>
              )}
            </section>
          )}
        </div>

        <aside className="manager-request-actions-card director-request-actions-card">
          <span className="manager-request-actions-card__eyebrow">
            {canDecide ? 'DÉCISION DU DIRECTEUR' : 'STATUT DE LA DEMANDE'}
          </span>
          <h3>{request.leaveType?.name ?? 'Demande de congé'}</h3>

          {canDecide ? (
            <>
              <div className="director-request-decision-note">
                <Icon name="shield" size={17} />
                <p>Votre décision clôt immédiatement cette demande pour les autres valideurs autorisés.</p>
              </div>

              {availability?.minimumPresenceBreached && (
                <label className="manager-request-actions-card__justification" htmlFor="director-minimum-presence-justification">
                  <span>Justification du dépassement</span>
                  <textarea
                    id="director-minimum-presence-justification"
                    rows={4}
                    maxLength={1500}
                    value={minimumPresenceJustification}
                    onChange={(event) => setMinimumPresenceJustification(event.target.value)}
                    placeholder="Expliquez pourquoi la demande peut être validée malgré le seuil…"
                  />
                </label>
              )}

              <button type="button" className="manager-request-action manager-request-action--validate" onClick={handleValidate} disabled={submitting}>
                <Icon name="check" size={16} /> Valider la demande
              </button>
              <button type="button" className="manager-request-action manager-request-action--refuse" onClick={() => setShowRefusal(true)} disabled={submitting}>
                <Icon name="alert" size={16} /> Refuser la demande
              </button>
            </>
          ) : (
            <div className="manager-request-actions-card__readonly">
              <span className={`manager-requests-badge manager-requests-badge--${readonlyStatus.tone}`}>
                <Icon name={readonlyStatus.icon} size={12} />
                {readonlyStatus.label}
              </span>

              {request.decisionAt && (
                <div className="manager-request-actions-card__decision-meta">
                  <small>Décision le</small>
                  <strong>{formatDateTime(request.decisionAt)}</strong>
                </div>
              )}

              {request.finalDecider && (
                <div className="manager-request-actions-card__decision-meta">
                  <small>Décideur</small>
                  <strong>{request.finalDecider.prenom} {request.finalDecider.nom}</strong>
                </div>
              )}

              {request.refusalComment && (
                <div className="manager-request-actions-card__refusal-note">
                  <small>Motif du refus</small>
                  <p>{request.refusalComment}</p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <SignatureModal
        open={showSignature}
        requestLabel={`${employeeName} — ${request.leaveType?.name ?? 'Demande de congé'}`}
        title="Valider la demande en tant que Directeur"
        confirmLabel="Confirmer la validation"
        submittingLabel="Validation…"
        dialogLabel="Signer la validation de la demande"
        submitting={submitting}
        onClose={() => setShowSignature(false)}
        onConfirm={confirmValidation}
      />

      <ManagerRefusalModal
        open={showRefusal}
        employeeName={employeeName}
        submitting={submitting}
        onClose={() => setShowRefusal(false)}
        onConfirm={confirmRefusal}
      />
    </div>
  )
}
