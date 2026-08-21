import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import { ManagerRefusalModal } from '@/components/manager/requests/ManagerRefusalModal'
import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'
import {
  getRhRequest,
  getRhRequestAvailability,
  refuseRhRequest,
  validateRhRequest,
} from '@/services/rh/rhRequests'
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
  VALIDEE: { label: 'Validée · traitement terminé', tone: 'approved', icon: 'check' },
  REFUSEE: { label: 'Refusée', tone: 'refused', icon: 'alert' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled', icon: 'alert' },
  ANNULATION_EN_ATTENTE_ACCORD: { label: 'Annulation en attente', tone: 'pending', icon: 'clock' },
  ANNULEE_APRES_VALIDATION: { label: 'Annulée après validation', tone: 'cancelled', icon: 'alert' },
  EXPIREE_NON_VALIDEE: { label: 'Expirée', tone: 'expired', icon: 'clock' },
}

function requestStatusMeta(request) {
  if (request?.status === 'EN_ATTENTE_VALIDATION' && request?.finalDeciderId) {
    return STATUS_META.EN_COURS_TRAITEMENT
  }
  if (request?.status === 'EN_ATTENTE_VALIDATION' && request?.isUrgent) {
    return { label: 'Urgente', tone: 'urgent', icon: 'alert' }
  }
  return STATUS_META[request?.status] ?? { label: request?.status || 'Statut inconnu', tone: 'pending', icon: 'clock' }
}

export function RhRequestDecisionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [state, setState] = useState({ loading: true, error: null, request: null, availability: null })
  const [showSignature, setShowSignature] = useState(false)
  const [showRefusal, setShowRefusal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [minimumPresenceJustification, setMinimumPresenceJustification] = useState('')

  useAutoDismiss(feedback, setFeedback)
  const [directorAgreementConfirmed, setDirectorAgreementConfirmed] = useState(false)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const request = await getRhRequest(id)
      let availability = null
      if (request?.status === 'EN_ATTENTE_VALIDATION') {
        try {
          availability = await getRhRequestAvailability(id)
        } catch {
          availability = null
        }
      }
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
    const isRhFinalization = state.request?.decisionAccess?.kind === 'RH_FINALISATION'
    if (!isRhFinalization && !directorAgreementConfirmed) {
      setFeedback({ kind: 'error', message: 'Vous devez confirmer avoir obtenu l’accord du Directeur avant de valider.' })
      return
    }
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
      await validateRhRequest(id, {
        signatureType,
        signatureData,
        rhConfirmedDirectorAgreement: state.request?.decisionAccess?.kind === 'RH_FINALISATION' ? undefined : true,
        minimumPresenceJustification: minimumPresenceJustification.trim() || undefined,
      })
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate('/app/rh-all-requests', {
        replace: true,
        state: { flash: { kind: 'success', message: 'Demande validée avec succès.' } },
      })
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
      await refuseRhRequest(id, comment ? { comment } : {})
      window.dispatchEvent(new Event('gmes:data-changed'))
      navigate('/app/rh-all-requests', {
        replace: true,
        state: { flash: { kind: 'success', message: 'Demande refusée.' } },
      })
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
        <button type="button" className="manager-request-back" onClick={() => navigate('/app/rh-all-requests')}>
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
  const status = requestStatusMeta(request)
  const isOwnRequest = String(request.employee?.id ?? '') === String(user?.id ?? '')
  const canDecide =
    request.status === 'EN_ATTENTE_VALIDATION' &&
    request.employee?.role !== 'RH' &&
    !isOwnRequest &&
    Boolean(request.decisionAccess)

  return (
    <div className="manager-request-detail-page">
      <button type="button" className="manager-request-back" onClick={() => navigate('/app/rh-all-requests')}>
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
            <span className={`manager-requests-badge manager-requests-badge--${status.tone}`}>
              <Icon name={status.icon} size={12} /> {status.label}
            </span>
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

        <aside className="manager-request-actions-card">
          <span className="manager-request-actions-card__eyebrow">
            {canDecide ? 'ACTIONS DISPONIBLES' : 'STATUT DE LA DEMANDE'}
          </span>
          <h3>{request.leaveType?.name ?? 'Demande de congé'}</h3>

          {canDecide ? (
            <>
              {request.decisionAccess?.kind !== 'RH_FINALISATION' && (
                <label
                  className={`manager-request-actions-card__agreement${directorAgreementConfirmed ? ' is-checked' : ''}`}
                >
                  <span className="manager-request-actions-card__agreement-check">
                    <input
                      type="checkbox"
                      checked={directorAgreementConfirmed}
                      onChange={(event) => setDirectorAgreementConfirmed(event.target.checked)}
                    />
                    <span className="manager-request-actions-card__agreement-box" aria-hidden="true">
                      <Icon name="check" size={14} />
                    </span>
                  </span>

                  <span className="manager-request-actions-card__agreement-content">
                    <span className="manager-request-actions-card__agreement-title">
                      <strong>Accord du Directeur obtenu</strong>
                      <span className="manager-request-actions-card__agreement-badge">
                        {directorAgreementConfirmed ? 'Confirmé' : 'Obligatoire'}
                      </span>
                    </span>
                    <small>Je confirme avoir obtenu l’accord du Directeur avant de valider cette demande.</small>
                  </span>
                </label>
              )}

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
              <span className={`manager-requests-badge manager-requests-badge--${status.tone}`}>
                <Icon name={status.icon} size={12} /> {status.label}
              </span>

              {request.employee?.role === 'RH' && request.status === 'EN_ATTENTE_VALIDATION' && (
                <p>Une demande déposée par la RH doit être traitée par le Directeur.</p>
              )}

              {request.status === 'EN_ATTENTE_VALIDATION' && request.employee?.role !== 'RH' && !isOwnRequest && !request.decisionAccess && (
                <p>Cette demande relève actuellement de son valideur prévu. Pour un service géré par un Responsable, la RH ne peut intervenir que si elle est désignée comme valideur temporaire ou valideur de secours.</p>
              )}

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
        title="Valider la demande en tant que RH"
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
