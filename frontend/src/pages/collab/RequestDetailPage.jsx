import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { RequestStatusBadge } from '@/components/collab/requests/RequestStatusBadge'
import { Icon } from '@/components/ui/Icon'
import {
  cancelAbsenceDeclaration,
  cancelLeaveRequest,
  downloadCancellationPdf,
  downloadPendingSummaryPdf,
  downloadValidationPdf,
  getAbsenceDeclaration,
  getAbsenceDocuments,
  getLeaveDocuments,
  getLeaveRequest,
  requestLeaveCancellation,
  respondLeaveCancellation,
  uploadAbsenceJustificatif,
} from '@/services/collab/requestDetails'
import { formatDateNumericFR, formatDays, formatRangeNumericFR, todayISO } from '@/utils/format'
import { errorMessage } from '@/utils/newRequest'
import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/collab/request-detail/index.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

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
  if (value === 'MATIN') return 'Matin'
  if (value === 'APRES_MIDI') return 'Après-midi'
  return '—'
}

function formatDuration(request, source) {
  if (source === 'leave') return `${formatDays(Number(request.deductedDays) || 0)} j`
  if (request.durationHours !== null && request.durationHours !== undefined) {
    return `${formatDays(Number(request.durationHours) || 0)} h`
  }
  return `${formatDays(Number(request.durationDays) || 0)} j`
}

function InfoItem({ label, children }) {
  return (
    <div className="request-detail-info__item">
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  )
}

function Feedback({ feedback, onClose }) {
  if (!feedback) return null
  return (
    <div className={`request-detail-feedback request-detail-feedback--${feedback.kind}`} role="status">
      <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
      <span>{feedback.message}</span>
      <button type="button" onClick={onClose} aria-label="Fermer">×</button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="request-detail-page" aria-busy="true">
      <div className="request-detail-skeleton request-detail-skeleton--hero" />
      <div className="request-detail-grid">
        <div className="request-detail-skeleton request-detail-skeleton--main" />
        <div className="request-detail-skeleton request-detail-skeleton--side" />
      </div>
    </div>
  )
}

export function RequestDetailPage() {
  const navigate = useNavigate()
  const { source, id } = useParams()
  const fileInputRef = useRef(null)
  const numericId = Number(id)
  const isLeave = source === 'leave'
  const isAbsence = source === 'absence'

  const [state, setState] = useState({ loading: true, request: null, documents: [], error: false })
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [cancellationReasonOpen, setCancellationReasonOpen] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')

  const load = useCallback(async () => {
    if ((!isLeave && !isAbsence) || !Number.isFinite(numericId)) {
      setState({ loading: false, request: null, documents: [], error: true })
      return
    }

    setState((current) => ({ ...current, loading: true, error: false }))
    try {
      if (isLeave) {
        const [request, documents] = await Promise.all([
          getLeaveRequest(numericId),
          getLeaveDocuments(numericId),
        ])
        setState({ loading: false, request, documents: documents ?? [], error: false })
      } else {
        const [request, documents] = await Promise.all([
          getAbsenceDeclaration(numericId),
          getAbsenceDocuments(numericId),
        ])
        setState({ loading: false, request, documents: documents ?? [], error: false })
      }
    } catch {
      setState({ loading: false, request: null, documents: [], error: true })
    }
  }, [isAbsence, isLeave, numericId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const request = state.request
  const title = request?.leaveType?.name || (isLeave ? 'Demande de congé' : "Déclaration d'absence")
  const canModifyPendingLeave = Boolean(
    isLeave &&
    request?.status === 'EN_ATTENTE_VALIDATION' &&
    request.modificationDeadline &&
    todayISO() <= String(request.modificationDeadline).slice(0, 10),
  )

  const rejectedDocument = useMemo(
    () => state.documents.find((document) => document.status === 'REJETE') ?? null,
    [state.documents],
  )

  const validationPdfAvailable = useMemo(
    () => state.documents.some((document) => document.documentKind === 'PDF_VALIDATION'),
    [state.documents],
  )

  const cancellationPdfAvailable = useMemo(
    () => state.documents.some((document) => document.documentKind === 'PDF_ANNULATION'),
    [state.documents],
  )

  const run = async (key, action, successMessage, reload = true) => {
    if (busy) return
    setBusy(key)
    try {
      await action()
      if (successMessage) setFeedback({ kind: 'success', message: successMessage })
      if (reload) {
        notifyAppDataChanged({ source, id: numericId })
        await load()
      }
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const handleCancelPendingLeave = () => {
    if (!window.confirm('Annuler cette demande de congé ?')) return
    run('cancel', () => cancelLeaveRequest(numericId), 'Demande annulée.')
  }

  const handleRequestCancellation = async () => {
    const reason = cancellationReason.trim()
    if (reason.length < 3) {
      setFeedback({ kind: 'error', message: 'Le motif doit contenir au moins 3 caractères.' })
      return
    }
    await run(
      'cancellation-request',
      () => requestLeaveCancellation(numericId, reason),
      'Demande d’annulation transmise à la RH.',
    )
    setCancellationReasonOpen(false)
    setCancellationReason('')
  }

  const handleCancellationResponse = (consent) => {
    const label = consent ? 'accepter' : 'refuser'
    if (!window.confirm(`Confirmer que vous souhaitez ${label} cette annulation ?`)) return
    run(
      `consent-${consent}`,
      () => respondLeaveCancellation(numericId, consent),
      consent ? 'Votre accord a été enregistré.' : 'L’annulation a été refusée.',
    )
  }

  const handleCancelAbsence = () => {
    if (!window.confirm('Annuler cette déclaration d’absence ?')) return
    run('cancel-absence', () => cancelAbsenceDeclaration(numericId), 'Déclaration annulée.')
  }

  const handleJustificatif = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const lowerName = file.name.toLocaleLowerCase('fr-FR')
    const validExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
    if (!ALLOWED_MIME_TYPES.has(file.type) || !validExtension) {
      setFeedback({ kind: 'error', message: 'Le justificatif doit être au format PDF, JPG ou PNG.' })
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFeedback({ kind: 'error', message: 'Le justificatif dépasse la limite de 10 Mo.' })
      return
    }
    await run(
      'upload-document',
      () => uploadAbsenceJustificatif(numericId, file),
      'Justificatif transmis à la RH.',
    )
  }

  if (state.loading) return <LoadingState />

  if (state.error || !request) {
    return (
      <div className="request-detail-page">
        <div className="request-detail-error" role="alert">
          <span><Icon name="alert" size={25} /></span>
          <strong>Impossible de charger cette demande</strong>
          <p>Elle n’existe peut-être plus ou vous n’êtes pas autorisé à la consulter.</p>
          <div>
            <button type="button" onClick={() => navigate('/app/my-requests')}>Retour à Mes demandes</button>
            <button type="button" onClick={load}>Réessayer</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="request-detail-page">
      <button type="button" className="request-detail-back" onClick={() => navigate('/app/my-requests')}>
        <Icon name="chevronLeft" size={17} />
        Mes demandes
      </button>

      <Feedback feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="request-detail-hero">
        <span className="request-detail-hero__icon" aria-hidden="true">
          <Icon name="calendar" size={22} />
        </span>
        <div className="request-detail-hero__main">
          <span className="request-detail-hero__eyebrow">
            {isLeave ? `Demande de congé n°${request.id}` : `Déclaration d’absence n°${request.id}`}
          </span>
          <div className="request-detail-hero__title-row">
            <h2>{title}</h2>
            <RequestStatusBadge status={request.status} />
          </div>
          <p>{formatRangeNumericFR(request.startDate, request.endDate)} · <strong>{formatDuration(request, source)}</strong></p>
        </div>
      </div>

      <div className="request-detail-grid">
        <div className="request-detail-main">
          <section className="request-detail-card">
            <div className="request-detail-card__heading">
              <span><Icon name="calendar" size={18} /></span>
              <div>
                <h3>Période</h3>
                <p>Détails enregistrés pour cette demande.</p>
              </div>
            </div>
            <dl className="request-detail-info">
              <InfoItem label="Date de début">{formatDateNumericFR(request.startDate)}</InfoItem>
              <InfoItem label="Date de fin">{formatDateNumericFR(request.endDate)}</InfoItem>
              <InfoItem label="Durée">{formatDuration(request, source)}</InfoItem>
              <InfoItem label="Service">{request.service?.name || '—'}</InfoItem>
              {request.startPeriod && <InfoItem label="Premier jour">{periodLabel(request.startPeriod)}</InfoItem>}
              {request.endPeriod && <InfoItem label="Dernier jour">{periodLabel(request.endPeriod)}</InfoItem>}
            </dl>
          </section>

          {(request.comment || request.refusalComment || request.cancellationReason || rejectedDocument?.rejectionReason) && (
            <section className="request-detail-card">
              <div className="request-detail-card__heading">
                <span><Icon name="file" size={18} /></span>
                <div>
                  <h3>Informations complémentaires</h3>
                  <p>Commentaires et motifs liés au traitement.</p>
                </div>
              </div>
              <div className="request-detail-notes">
                {request.comment && <div><strong>Commentaire</strong><p>{request.comment}</p></div>}
                {request.refusalComment && <div className="is-danger"><strong>Motif du refus</strong><p>{request.refusalComment}</p></div>}
                {request.cancellationReason && <div><strong>Motif de l’annulation</strong><p>{request.cancellationReason}</p></div>}
                {rejectedDocument?.rejectionReason && <div className="is-danger"><strong>Motif du rejet du justificatif</strong><p>{rejectedDocument.rejectionReason}</p></div>}
              </div>
            </section>
          )}

          <section className="request-detail-card">
            <div className="request-detail-card__heading">
              <span><Icon name="clock" size={18} /></span>
              <div>
                <h3>Suivi</h3>
                <p>Principales dates enregistrées par l’application.</p>
              </div>
            </div>
            <dl className="request-detail-info request-detail-info--timeline">
              <InfoItem label="Créée le">{formatDateTime(request.createdAt)}</InfoItem>
              {isLeave && <InfoItem label="Soumise le">{formatDateTime(request.submittedAt)}</InfoItem>}
              {isLeave && <InfoItem label="Décision le">{formatDateTime(request.decisionAt)}</InfoItem>}
              {!isLeave && <InfoItem label="Déclarée le">{formatDateTime(request.declaredAt)}</InfoItem>}
              {!isLeave && <InfoItem label="Vérifiée le">{formatDateTime(request.verifiedAt)}</InfoItem>}
              {isLeave && request.modificationDeadline && (
                <InfoItem label="Modification possible jusqu’au">{formatDateNumericFR(String(request.modificationDeadline).slice(0, 10))}</InfoItem>
              )}
            </dl>
          </section>
        </div>

        <aside className="request-detail-side">
          <section className="request-detail-actions">
            <div className="request-detail-actions__heading">
              <span>Actions disponibles</span>
              <strong>{title}</strong>
            </div>

            {isLeave && request.status === 'EN_ATTENTE_VALIDATION' && (
              <>
                <button type="button" className="request-detail-button request-detail-button--secondary" disabled={Boolean(busy)} onClick={() => run('download-summary', () => downloadPendingSummaryPdf(request.id), null, false)}>
                  <Icon name="download" size={16} /> {busy === 'download-summary' ? 'Téléchargement…' : 'Télécharger le récapitulatif'}
                </button>
                {canModifyPendingLeave && (
                  <button type="button" className="request-detail-button request-detail-button--primary" onClick={() => navigate(`/app/new-request/${request.id}`)}>
                    <Icon name="refresh" size={16} /> Modifier la demande
                  </button>
                )}
                <button type="button" className="request-detail-button request-detail-button--danger-outline" disabled={Boolean(busy)} onClick={handleCancelPendingLeave}>
                  <Icon name="trash" size={16} /> {busy === 'cancel' ? 'Annulation…' : 'Annuler la demande'}
                </button>
              </>
            )}

            {isLeave && validationPdfAvailable && ['VALIDEE', 'ANNULATION_EN_ATTENTE_ACCORD'].includes(request.status) && (
              <button type="button" className="request-detail-button request-detail-button--secondary" disabled={Boolean(busy)} onClick={() => run('download', () => downloadValidationPdf(request.id), null, false)}>
                <Icon name="download" size={16} /> {busy === 'download' ? 'Téléchargement…' : 'Télécharger le PDF'}
              </button>
            )}

            {isLeave && !validationPdfAvailable && ['VALIDEE', 'ANNULATION_EN_ATTENTE_ACCORD'].includes(request.status) && (
              <div className="request-detail-consent-note">
                Le PDF officiel n’est pas disponible pour cette ancienne donnée. Les nouvelles validations génèrent automatiquement le document signé.
              </div>
            )}

            {isLeave && request.status === 'VALIDEE' && (
              <button type="button" className="request-detail-button request-detail-button--orange" onClick={() => setCancellationReasonOpen((current) => !current)}>
                <Icon name="refresh" size={16} /> Demander l’annulation
              </button>
            )}

            {isLeave && request.status === 'ANNULATION_EN_ATTENTE_ACCORD' && request.employeeCancellationConsent === null && (
              <>
                <div className="request-detail-consent-note">La RH demande votre accord pour annuler ce congé validé.</div>
                <button type="button" className="request-detail-button request-detail-button--success" disabled={Boolean(busy)} onClick={() => handleCancellationResponse(true)}>
                  <Icon name="check" size={16} /> Accepter l’annulation
                </button>
                <button type="button" className="request-detail-button request-detail-button--danger-outline" disabled={Boolean(busy)} onClick={() => handleCancellationResponse(false)}>
                  Refuser l’annulation
                </button>
              </>
            )}

            {isLeave && request.status === 'ANNULATION_EN_ATTENTE_ACCORD' && request.employeeCancellationConsent === true && (
              <div className="request-detail-consent-note request-detail-consent-note--ok">
                <Icon name="check" size={15} /> Votre accord est enregistré. La RH doit finaliser l’annulation.
              </div>
            )}

            {isLeave && request.status === 'ANNULEE_APRES_VALIDATION' && (
              <>
                {validationPdfAvailable && (
                  <button type="button" className="request-detail-button request-detail-button--secondary" disabled={Boolean(busy)} onClick={() => run('download-original', () => downloadValidationPdf(request.id), null, false)}>
                    <Icon name="download" size={16} /> PDF de validation
                  </button>
                )}
                {cancellationPdfAvailable && (
                  <button type="button" className="request-detail-button request-detail-button--orange" disabled={Boolean(busy)} onClick={() => run('download-cancel', () => downloadCancellationPdf(request.id), null, false)}>
                    <Icon name="download" size={16} /> PDF d’annulation
                  </button>
                )}
                {!validationPdfAvailable && !cancellationPdfAvailable && (
                  <div className="request-detail-consent-note">
                    Aucun PDF officiel n’est disponible pour cette ancienne donnée.
                  </div>
                )}
              </>
            )}

            {isLeave && ['REFUSEE', 'ANNULEE', 'EXPIREE_NON_VALIDEE'].includes(request.status) && (
              <button type="button" className="request-detail-button request-detail-button--primary" onClick={() => navigate('/app/new-request')}>
                <Icon name="plus" size={16} /> Créer une nouvelle demande
              </button>
            )}

            {isAbsence && ['JUSTIFICATIF_EN_ATTENTE', 'JUSTIFICATIF_REJETE'].includes(request.status) && (
              <>
                <input ref={fileInputRef} type="file" className="request-detail-file-input" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={handleJustificatif} />
                <button type="button" className="request-detail-button request-detail-button--primary" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()}>
                  <Icon name="file" size={16} /> {busy === 'upload-document' ? 'Transmission…' : 'Ajouter un justificatif'}
                </button>
              </>
            )}

            {isAbsence && ['DECLAREE', 'JUSTIFICATIF_EN_ATTENTE', 'A_VERIFIER_PAR_RH', 'JUSTIFICATIF_REJETE'].includes(request.status) && (
              <button type="button" className="request-detail-button request-detail-button--danger-outline" disabled={Boolean(busy)} onClick={handleCancelAbsence}>
                <Icon name="trash" size={16} /> {busy === 'cancel-absence' ? 'Annulation…' : 'Annuler la déclaration'}
              </button>
            )}

            {isAbsence && ['ENREGISTREE', 'ANNULEE'].includes(request.status) && (
              <div className="request-detail-consent-note">
                Cette déclaration est en lecture seule dans son statut actuel.
              </div>
            )}

            {cancellationReasonOpen && request.status === 'VALIDEE' && (
              <div className="request-detail-cancellation-form">
                <label htmlFor="cancellation-reason">Motif de l’annulation</label>
                <textarea id="cancellation-reason" rows="4" maxLength="2000" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Expliquez la raison de votre demande…" />
                <small>{cancellationReason.trim().length}/2000 · minimum 3 caractères</small>
                <div>
                  <button type="button" onClick={() => { setCancellationReasonOpen(false); setCancellationReason('') }} disabled={Boolean(busy)}>Fermer</button>
                  <button type="button" onClick={handleRequestCancellation} disabled={Boolean(busy) || cancellationReason.trim().length < 3}>{busy === 'cancellation-request' ? 'Envoi…' : 'Envoyer'}</button>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  )
}
