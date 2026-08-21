import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import { ManagerRefusalModal } from '@/components/manager/requests/ManagerRefusalModal'
import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import {
  getManagerRequest,
  getManagerRequestAvailability,
  refuseManagerRequest,
  validateManagerRequest,
} from '@/services/manager/managerRequests'
import { formatDateNumericFR, formatDays, formatRangeNumericFR } from '@/utils/format'

import '@/styles/manager/requests/index.css'

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

const STATUS_META = {
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'pending', icon: 'clock' },
  EN_COURS_TRAITEMENT: { label: 'En cours de traitement', tone: 'pending', icon: 'clock' },
  VALIDEE: { label: 'Validée · circuit terminé', tone: 'approved', icon: 'check' },
  REFUSEE: { label: 'Refusée', tone: 'refused', icon: 'alert' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled', icon: 'refresh' },
  ANNULATION_EN_ATTENTE_ACCORD: { label: 'Annulation en attente', tone: 'pending', icon: 'clock' },
  ANNULEE_APRES_VALIDATION: { label: 'Annulée après validation', tone: 'cancelled', icon: 'refresh' },
  EXPIREE_NON_VALIDEE: { label: 'Expirée', tone: 'cancelled', icon: 'clock' },
}

function getStatusMeta(status, request) {
  const effective = status === 'EN_ATTENTE_VALIDATION' && request?.finalDeciderId ? 'EN_COURS_TRAITEMENT' : status
  return STATUS_META[effective] ?? { label: effective || '—', tone: 'pending', icon: 'clock' }
}

export function ManagerRequestDecisionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: null, request: null, availability: null })
  const [showSignature, setShowSignature] = useState(false)
  const [showRefusal, setShowRefusal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [minimumPresenceJustification, setMinimumPresenceJustification] = useState('')

  useAutoDismiss(feedback, setFeedback)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const request = await getManagerRequest(id)
      const availability = request.status === 'EN_ATTENTE_VALIDATION'
        ? await getManagerRequestAvailability(id).catch(() => null)
        : null
      setState({ loading: false, error: null, request, availability })
    } catch (error) {
      setState({
        loading: false,
        error: error.response?.data?.message || error.message || 'Impossible de charger cette demande.',
        request: null,
        availability: null,
      })
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
      setFeedback({ kind: 'error', message: 'Une justification est obligatoire car le seuil minimum de présence serait dépassé.' })
      return
    }
    setFeedback(null)
    setShowSignature(true)
  }

  const confirmValidation = async (signatureType, signatureData) => {
    setSubmitting(true)
    setFeedback(null)
    try {
      await validateManagerRequest(id, {
        signatureType,
        signatureData,
        minimumPresenceJustification: minimumPresenceJustification.trim() || undefined,
      })
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate('/app/requests', { replace: true })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible de valider cette demande.',
      })
    } finally {
      setSubmitting(false)
      setShowSignature(false)
    }
  }

  const confirmRefusal = async (comment) => {
    setSubmitting(true)
    setFeedback(null)
    try {
      await refuseManagerRequest(id, comment ? { comment } : {})
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate('/app/requests', { replace: true })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible de refuser cette demande.',
      })
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
        <button type="button" className="manager-request-back" onClick={() => navigate('/app/requests')}>
          <Icon name="chevronLeft" size={16} /> Retour aux demandes
        </button>
        <div className="manager-request-detail-state manager-request-detail-state--error">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger cette demande.</strong>
          <span>{state.error}</span>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      </div>
    )
  }

  const request = state.request
  const availability = state.availability
  const overlapCount = availability?.overlaps?.length ?? 0
  const hasAvailabilityAlert = Boolean(
    availability?.minimumPresenceBreached || overlapCount > 0,
  )
  const requestStatus = getStatusMeta(request.status)
  const canDecide = request.status === 'EN_ATTENTE_VALIDATION' && Boolean(request.decisionAccess)

  return (
    <div className="manager-request-detail-page">
      <button type="button" className="manager-request-back" onClick={() => navigate('/app/requests')}>
        <Icon name="chevronLeft" size={16} /> Retour aux demandes
      </button>

      {feedback && (
        <div className={`manager-request-detail-feedback manager-request-detail-feedback--${feedback.kind}`}>
          <Icon name="alert" size={15} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)}>×</button>
        </div>
      )}

      <section className="manager-request-detail-hero">
        <span className="manager-request-detail-hero__avatar">
          {`${request.employee?.prenom?.[0] ?? ''}${request.employee?.nom?.[0] ?? ''}`.toUpperCase()}
        </span>
        <div>
          <span className="manager-request-detail-hero__eyebrow">DEMANDE DE CONGÉ N°{request.id}</span>
          <div className="manager-request-detail-hero__titleline">
            <h2>{employeeName}</h2>
            {request.isUrgent && request.status === 'EN_ATTENTE_VALIDATION' ? (
              <span className="manager-requests-badge manager-requests-badge--urgent"><Icon name="alert" size={12} /> Urgente</span>
            ) : (
              <span className={`manager-requests-badge manager-requests-badge--${requestStatus.tone}`}><Icon name={requestStatus.icon} size={12} /> {requestStatus.label}</span>
            )}
          </div>
          <p>{request.leaveType?.name ?? 'Demande de congé'} · {request.service?.name}</p>
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
              <div><h3>Informations complémentaires</h3><p>Éléments transmis par le collaborateur.</p></div>
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
          <section className={`manager-request-detail-card manager-request-availability${hasAvailabilityAlert ? ' is-warning' : ''}`}>
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

        <aside className="manager-request-actions-card">
          <span className="manager-request-actions-card__eyebrow">
            {canDecide ? 'ACTIONS DISPONIBLES' : 'CONSULTATION'}
          </span>
          <h3>{request.leaveType?.name ?? 'Demande de congé'}</h3>

          {canDecide ? (
            <>
              {availability?.minimumPresenceBreached && (
                <label className="manager-request-actions-card__justification" htmlFor="minimum-presence-justification">
                  <span>Justification du dépassement</span>
                  <textarea
                    id="minimum-presence-justification"
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
              <span className={`manager-requests-badge manager-requests-badge--${requestStatus.tone}`}>{requestStatus.label}</span>
              <p>
                {request.status === 'EN_ATTENTE_VALIDATION'
                  ? 'Cette demande appartient bien à votre service, mais elle est actuellement attribuée à un autre valideur.'
                  : 'Cette demande est consultable dans l’historique de votre service. Aucune action de validation n’est disponible.'}
              </p>
            </div>
          )}
        </aside>
      </div>

      <SignatureModal
        open={showSignature}
        requestLabel={`${employeeName} — ${request.leaveType?.name ?? 'Demande de congé'}`}
        title="Valider la demande"
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
