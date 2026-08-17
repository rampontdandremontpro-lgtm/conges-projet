import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DocumentPreviewModal } from '@/components/collab/documents/DocumentPreviewModal'
import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  acceptRhAbsenceDocument,
  cancelRhAbsence,
  createRhAbsenceDraft,
  deleteRhAbsenceDraft,
  fetchRhAbsenceDocument,
  getRhAbsenceDeclaration,
  getRhAbsenceDeclarations,
  getRhAbsenceDocuments,
  getRhAbsenceEmployees,
  getRhAbsenceTypes,
  registerRhAbsence,
  rejectRhAbsenceDocument,
  submitRhAbsence,
  uploadRhAbsenceDocument,
} from '@/services/rhAbsences'
import { triggerBlobDownload } from '@/services/documents'
import { formatDateNumericFR, formatDays, todayISO } from '@/utils/format'

import '@/styles/documents.css'
import '@/styles/rh-absences.css'

const PAGE_SIZE = 8
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

const STATUS_META = {
  BROUILLON: { label: 'Brouillon RH', tone: 'draft' },
  DECLAREE: { label: 'Déclarée', tone: 'declared' },
  JUSTIFICATIF_EN_ATTENTE: { label: 'Justificatif attendu', tone: 'waiting' },
  A_VERIFIER_PAR_RH: { label: 'À vérifier', tone: 'pending' },
  JUSTIFICATIF_REJETE: { label: 'Refusée', tone: 'rejected' },
  ENREGISTREE: { label: 'Autorisée', tone: 'approved' },
  ANNULEE: { label: 'Annulée', tone: 'cancelled' },
}

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'À vérifier' },
  { id: 'waiting', label: 'À compléter' },
  { id: 'approved', label: 'Autorisées' },
  { id: 'rejected', label: 'Refusées' },
  { id: 'cancelled', label: 'Annulées' },
]

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function fullName(user) {
  if (!user) return '—'
  return `${user.prenom ?? ''} ${user.nom ?? ''}`.trim() || '—'
}

function initials(user) {
  return `${user?.prenom?.[0] ?? ''}${user?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status || '—', tone: 'neutral' }
}

function statusMatches(status, filter) {
  if (filter === 'all') return true
  if (filter === 'pending') return ['A_VERIFIER_PAR_RH', 'DECLAREE'].includes(status)
  if (filter === 'waiting') return status === 'JUSTIFICATIF_EN_ATTENTE'
  if (filter === 'approved') return status === 'ENREGISTREE'
  if (filter === 'rejected') return status === 'JUSTIFICATIF_REJETE'
  if (filter === 'cancelled') return status === 'ANNULEE'
  return true
}

function declarationMatchesSearch(declaration, query) {
  const needle = normalize(query)
  if (!needle) return true

  const haystack = [
    declaration.id,
    declaration.employee?.prenom,
    declaration.employee?.nom,
    declaration.employee?.email,
    declaration.service?.name,
    declaration.leaveType?.name,
    declaration.startDate,
    declaration.endDate,
    statusMeta(declaration.status).label,
    declaration.createdBy?.prenom,
    declaration.createdBy?.nom,
  ].map(normalize).join(' ')

  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

function formatDuration(declaration) {
  if (declaration.durationHours !== null && declaration.durationHours !== undefined) {
    return `${formatDays(Number(declaration.durationHours))} h`
  }
  if (declaration.durationDays !== null && declaration.durationDays !== undefined) {
    return `${formatDays(Number(declaration.durationDays))} j`
  }
  return '—'
}

function modeOptions(type) {
  if (!type) return []
  const options = []
  if (type.allowsDays) options.push({ id: 'days', label: 'Jours' })
  if (type.allowsHalfDays) options.push({ id: 'half-day', label: 'Demi-journée' })
  if (type.allowsHours) options.push({ id: 'hours', label: 'Heures' })
  return options
}

function getDefaultMode(type) {
  return modeOptions(type)[0]?.id ?? 'days'
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function CreateAbsenceDrawer({ employees, types, onClose, onSaved }) {
  const firstType = types[0] ?? null
  const [form, setForm] = useState({
    employeeId: employees[0]?.id ?? '',
    leaveTypeId: firstType?.id ?? '',
    mode: getDefaultMode(firstType),
    startDate: todayISO(),
    endDate: todayISO(),
    halfDayPeriod: 'MATIN',
    durationHours: '',
    comment: '',
    file: null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedType = useMemo(
    () => types.find((type) => Number(type.id) === Number(form.leaveTypeId)) ?? null,
    [form.leaveTypeId, types],
  )
  const selectedEmployee = useMemo(
    () => employees.find((user) => Number(user.id) === Number(form.employeeId)) ?? null,
    [employees, form.employeeId],
  )
  const modes = useMemo(() => modeOptions(selectedType), [selectedType])

  const updateType = (value) => {
    const type = types.find((item) => Number(item.id) === Number(value)) ?? null
    setForm((current) => ({
      ...current,
      leaveTypeId: value,
      mode: getDefaultMode(type),
      durationHours: '',
      file: null,
    }))
  }

  const validate = () => {
    if (!form.employeeId) return 'Sélectionnez un collaborateur.'
    if (!selectedType) return 'Sélectionnez un type d’absence.'
    if (!form.startDate) return 'Indiquez une date de début.'
    if (form.mode === 'days' && (!form.endDate || form.endDate < form.startDate)) {
      return 'La date de fin doit être postérieure ou égale à la date de début.'
    }
    if (form.mode === 'hours') {
      const hours = Number(form.durationHours)
      if (!Number.isFinite(hours) || hours <= 0) return 'Indiquez une durée en heures.'
    }
    if (selectedType.documentRequired && !selectedType.documentCanBeAddedLater && !form.file) {
      return 'Un justificatif est obligatoire pour ce type d’absence.'
    }
    return null
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      setForm((current) => ({ ...current, file: null }))
      return
    }
    if (!ACCEPTED_FILE_TYPES.has(file.type)) {
      setError('Le justificatif doit être un fichier PDF, JPG ou PNG.')
      event.target.value = ''
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Le justificatif ne doit pas dépasser 10 Mo.')
      event.target.value = ''
      return
    }
    setError('')
    setForm((current) => ({ ...current, file }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        employeeId: Number(form.employeeId),
        leaveTypeId: Number(form.leaveTypeId),
        startDate: form.startDate,
        endDate: form.mode === 'days' ? form.endDate : form.startDate,
        comment: form.comment.trim() || undefined,
      }

      if (form.mode === 'hours') {
        payload.durationHours = Number(form.durationHours)
      } else if (form.mode === 'half-day') {
        payload.startPeriod = form.halfDayPeriod
        payload.endPeriod = form.halfDayPeriod
      } else {
        payload.startPeriod = 'MATIN'
        payload.endPeriod = 'APRES_MIDI'
      }

      const draft = await createRhAbsenceDraft(payload)
      if (form.file) {
        await uploadRhAbsenceDocument(draft.id, form.file)
      }

      let declaration = await submitRhAbsence(draft.id)
      if (
        declaration.status === 'A_VERIFIER_PAR_RH' &&
        !selectedType.documentRequired
      ) {
        declaration = await registerRhAbsence(declaration.id)
      }

      const needsDocumentReview = selectedType.documentRequired && declaration.status !== 'ENREGISTREE'
      onSaved(
        needsDocumentReview
          ? `Déclaration enregistrée pour ${fullName(selectedEmployee)}. Le justificatif doit être vérifié avant l’autorisation.`
          : `Absence enregistrée pour ${fullName(selectedEmployee)}.`,
      )
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rh-absence-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="rh-absence-drawer" role="dialog" aria-modal="true" aria-labelledby="rh-absence-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rh-absence-drawer__header">
          <div>
            <span className="rh-absence-drawer__eyebrow">GESTION RH</span>
            <h2 id="rh-absence-create-title">Enregistrer une absence</h2>
            <p>Renseignez l’absence à enregistrer pour un membre de l’organisation.</p>
          </div>
          <button type="button" className="rh-absence-drawer__close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <form className="rh-absence-form" onSubmit={handleSubmit}>
          {error && <div className="rh-absence-form__error"><Icon name="alert" size={16} /><span>{error}</span></div>}

          <label className="rh-absence-field rh-absence-field--full">
            <span>Collaborateur</span>
            <select value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}>
              <option value="">Sélectionner un collaborateur</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{fullName(employee)} — {employee.service?.name ?? 'Sans service'}</option>
              ))}
            </select>
          </label>

          <label className="rh-absence-field rh-absence-field--full">
            <span>Type d’absence</span>
            <select value={form.leaveTypeId} onChange={(event) => updateType(event.target.value)}>
              <option value="">Sélectionner un type</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>

          {selectedType && (
            <div className="rh-absence-type-info">
              <Icon name="info" size={16} />
              <span>
                {selectedType.documentRequired
                  ? `Justificatif obligatoire${selectedType.documentCanBeAddedLater ? ' — il peut être ajouté ultérieurement.' : '.'}`
                  : 'Aucun justificatif obligatoire pour ce type.'}
              </span>
            </div>
          )}

          <fieldset className="rh-absence-mode rh-absence-field--full">
            <legend>Unité de déclaration</legend>
            <div>
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={form.mode === mode.id ? 'is-active' : ''}
                  onClick={() => setForm((current) => ({ ...current, mode: mode.id }))}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </fieldset>

          {form.mode === 'days' && (
            <>
              <label className="rh-absence-field">
                <span>Date de début</span>
                <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label className="rh-absence-field">
                <span>Date de fin</span>
                <input type="date" value={form.endDate} min={form.startDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
              </label>
            </>
          )}

          {form.mode === 'half-day' && (
            <>
              <label className="rh-absence-field">
                <span>Date</span>
                <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label className="rh-absence-field">
                <span>Demi-journée</span>
                <select value={form.halfDayPeriod} onChange={(event) => setForm((current) => ({ ...current, halfDayPeriod: event.target.value }))}>
                  <option value="MATIN">Matin</option>
                  <option value="APRES_MIDI">Après-midi</option>
                </select>
              </label>
            </>
          )}

          {form.mode === 'hours' && (
            <>
              <label className="rh-absence-field">
                <span>Date</span>
                <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label className="rh-absence-field">
                <span>Durée en heures</span>
                <input type="number" min="0.25" max="744" step="0.25" value={form.durationHours} placeholder="Ex. 2,5" onChange={(event) => setForm((current) => ({ ...current, durationHours: event.target.value }))} />
              </label>
            </>
          )}

          <label className="rh-absence-field rh-absence-field--full">
            <span>Commentaire <small>(optionnel)</small></span>
            <textarea rows="4" value={form.comment} placeholder="Informations complémentaires…" maxLength={1000} onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} />
          </label>

          {selectedType?.documentRequired && (
            <label className="rh-absence-upload rh-absence-field--full">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={handleFile} />
              <span className="rh-absence-upload__icon"><Icon name="file" size={18} /></span>
              <span>
                <strong>{form.file ? form.file.name : 'Ajouter un justificatif'}</strong>
                <small>PDF, JPG ou PNG — 10 Mo maximum</small>
              </span>
            </label>
          )}

          <div className="rh-absence-form__actions rh-absence-field--full">
            <button type="button" className="rh-absence-button rh-absence-button--secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="rh-absence-button rh-absence-button--primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer l’absence'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

function documentStatusMeta(status) {
  if (status === 'ACCEPTE') return { label: 'Validé', tone: 'accepted' }
  if (status === 'REJETE') return { label: 'Refusé', tone: 'rejected' }
  return { label: 'À vérifier', tone: 'pending' }
}

function DetailDrawer({
  declaration,
  busy,
  onClose,
  onRegister,
  onCancel,
  onDeleteDraft,
  onDeclarationChanged,
  onFeedback,
}) {
  const meta = statusMeta(declaration.status)
  const isOwnRhDraft = declaration.status === 'BROUILLON' && declaration.createdBy?.role === 'RH'
  const [documentsState, setDocumentsState] = useState({ loading: true, error: '', items: [] })
  const [documentBusy, setDocumentBusy] = useState(false)
  const [rejectingDocumentId, setRejectingDocumentId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [preview, setPreview] = useState({
    document: null,
    blob: null,
    blobUrl: '',
    mimeType: '',
    loading: false,
    error: '',
  })

  const loadDocuments = useCallback(async () => {
    setDocumentsState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const items = await getRhAbsenceDocuments(declaration.id)
      setDocumentsState({ loading: false, error: '', items })
      return items
    } catch (error) {
      setDocumentsState({ loading: false, error: errorMessage(error), items: [] })
      return []
    }
  }, [declaration.id])

  useEffect(() => {
    const timer = window.setTimeout(loadDocuments, 0)
    return () => window.clearTimeout(timer)
  }, [loadDocuments])

  useEffect(() => () => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
  }, [preview.blobUrl])

  const activeDocuments = documentsState.items
  const documentRequired = Boolean(declaration.leaveType?.documentRequired)
  const documentsAccepted = !documentRequired || (
    activeDocuments.length > 0 &&
    activeDocuments.every((document) => document.status === 'ACCEPTE')
  )
  const canAuthorize = (
    declaration.status === 'A_VERIFIER_PAR_RH' &&
    !documentsState.loading &&
    !documentsState.error &&
    documentsAccepted
  )

  const refreshDeclaration = async () => {
    const refreshed = await getRhAbsenceDeclaration(declaration.id)
    onDeclarationChanged?.(refreshed)
    return refreshed
  }

  const openPreview = async (document) => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)

    setPreview({
      document,
      blob: null,
      blobUrl: '',
      mimeType: document.mimeType || '',
      loading: true,
      error: '',
    })

    try {
      const { blob, mimeType } = await fetchRhAbsenceDocument(document.id)
      const blobUrl = URL.createObjectURL(blob)
      setPreview({
        document,
        blob,
        blobUrl,
        mimeType,
        loading: false,
        error: '',
      })
    } catch (error) {
      setPreview({
        document,
        blob: null,
        blobUrl: '',
        mimeType: document.mimeType || '',
        loading: false,
        error: errorMessage(error),
      })
    }
  }

  const closePreview = () => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
    setPreview({
      document: null,
      blob: null,
      blobUrl: '',
      mimeType: '',
      loading: false,
      error: '',
    })
  }

  const handlePreviewDownload = () => {
    if (!preview.blob || !preview.document) return
    triggerBlobDownload(
      preview.blob,
      preview.document.originalName || `justificatif-${preview.document.id}`,
    )
  }

  const handleAcceptDocument = async (document) => {
    if (documentBusy) return
    setDocumentBusy(true)
    try {
      await acceptRhAbsenceDocument(document.id)
      await loadDocuments()
      await refreshDeclaration()
      onFeedback?.('success', 'Justificatif validé. Vous pouvez maintenant autoriser l’absence.')
    } catch (error) {
      onFeedback?.('error', errorMessage(error))
    } finally {
      setDocumentBusy(false)
    }
  }

  const handleRejectDocument = async (document) => {
    const reason = rejectionReason.trim()
    if (documentBusy) return
    if (reason.length < 3) {
      onFeedback?.('error', 'Indiquez un motif de refus d’au moins 3 caractères.')
      return
    }

    setDocumentBusy(true)
    try {
      await rejectRhAbsenceDocument(document.id, reason)
      await loadDocuments()
      await refreshDeclaration()
      setRejectingDocumentId(null)
      setRejectionReason('')
      closePreview()
      onFeedback?.(
        'success',
        'Justificatif refusé. L’absence passe automatiquement au statut Refusée.',
      )
    } catch (error) {
      onFeedback?.('error', errorMessage(error))
    } finally {
      setDocumentBusy(false)
    }
  }

  return (
    <>
      <div className="rh-absence-drawer-backdrop" role="presentation" onMouseDown={onClose}>
        <aside className="rh-absence-drawer rh-absence-drawer--detail" role="dialog" aria-modal="true" aria-labelledby="rh-absence-detail-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="rh-absence-drawer__header">
            <div>
              <span className="rh-absence-drawer__eyebrow">ABSENCE N°{declaration.id}</span>
              <h2 id="rh-absence-detail-title">{fullName(declaration.employee)}</h2>
              <p>{declaration.service?.name ?? 'Service non renseigné'}</p>
            </div>
            <button type="button" className="rh-absence-drawer__close" onClick={onClose} aria-label="Fermer">×</button>
          </div>

          <div className="rh-absence-detail-status">
            <span className={`rh-absence-status rh-absence-status--${meta.tone}`}>{meta.label}</span>
            <strong>{declaration.leaveType?.name ?? 'Absence'}</strong>
          </div>

          <div className="rh-absence-detail-grid">
            <div><small>Début</small><strong>{formatDateNumericFR(declaration.startDate)}</strong></div>
            <div><small>Fin</small><strong>{formatDateNumericFR(declaration.endDate)}</strong></div>
            <div><small>Durée</small><strong>{formatDuration(declaration)}</strong></div>
            <div><small>Enregistrée par</small><strong>{fullName(declaration.createdBy)}</strong></div>
            <div><small>Vérifiée par</small><strong>{fullName(declaration.verifiedByRh)}</strong></div>
            <div><small>Service</small><strong>{declaration.service?.name ?? '—'}</strong></div>
          </div>

          {declaration.comment && (
            <div className="rh-absence-detail-comment">
              <small>Commentaire</small>
              <p>{declaration.comment}</p>
            </div>
          )}

          {documentRequired && (
            <section className="rh-absence-documents">
              <div className="rh-absence-documents__heading">
                <div>
                  <span className="rh-absence-documents__icon"><Icon name="file" size={18} /></span>
                  <div>
                    <h3>Justificatif</h3>
                    <p>Consultez et validez le document avant d’autoriser l’absence.</p>
                  </div>
                </div>
                {documentsAccepted && !documentsState.loading && (
                  <span className="rh-absence-documents__ready"><Icon name="check" size={14} /> Justificatif validé</span>
                )}
              </div>

              {documentsState.loading ? (
                <div className="rh-absence-documents__state">Chargement du justificatif…</div>
              ) : documentsState.error ? (
                <div className="rh-absence-documents__state rh-absence-documents__state--error">
                  <Icon name="alert" size={16} />
                  <span>{documentsState.error}</span>
                  <button type="button" onClick={loadDocuments}>Réessayer</button>
                </div>
              ) : activeDocuments.length === 0 ? (
                <div className="rh-absence-documents__state">
                  <Icon name="clock" size={16} />
                  <span>Aucun justificatif n’a encore été fourni.</span>
                </div>
              ) : (
                <div className="rh-absence-documents__list">
                  {activeDocuments.map((document) => {
                    const documentMeta = documentStatusMeta(document.status)
                    const isRejecting = rejectingDocumentId === document.id

                    return (
                      <article className="rh-absence-document-card" key={document.id}>
                        <div className="rh-absence-document-card__main">
                          <span className="rh-absence-document-card__file"><Icon name="doc" size={18} /></span>
                          <div>
                            <strong>{document.originalName || `Justificatif ${document.id}`}</strong>
                            <small>
                              {document.mimeType === 'application/pdf' ? 'PDF' : 'Image'}
                              {document.fileSize ? ` · ${(Number(document.fileSize) / 1024 / 1024).toFixed(1)} Mo` : ''}
                            </small>
                          </div>
                          <span className={`rh-absence-document-status rh-absence-document-status--${documentMeta.tone}`}>
                            {documentMeta.label}
                          </span>
                        </div>

                        {document.rejectionReason && (
                          <div className="rh-absence-document-card__reason">
                            <strong>Motif du refus :</strong> {document.rejectionReason}
                          </div>
                        )}

                        <div className="rh-absence-document-card__actions">
                          <button type="button" className="rh-absence-button rh-absence-button--secondary" onClick={() => openPreview(document)}>
                            <Icon name="eye" size={15} /> Voir le justificatif
                          </button>

                          {declaration.status === 'A_VERIFIER_PAR_RH' && document.status === 'EN_ATTENTE' && (
                            <>
                              <button
                                type="button"
                                className="rh-absence-button rh-absence-button--document-accept"
                                disabled={documentBusy}
                                onClick={() => handleAcceptDocument(document)}
                              >
                                <Icon name="check" size={15} /> Valider
                              </button>
                              <button
                                type="button"
                                className="rh-absence-button rh-absence-button--document-reject"
                                disabled={documentBusy}
                                onClick={() => {
                                  setRejectingDocumentId(isRejecting ? null : document.id)
                                  setRejectionReason('')
                                }}
                              >
                                <Icon name="alert" size={15} /> Refuser
                              </button>
                            </>
                          )}
                        </div>

                        {isRejecting && (
                          <div className="rh-absence-document-reject-form">
                            <label htmlFor={`rh-absence-document-reason-${document.id}`}>Motif du refus</label>
                            <textarea
                              id={`rh-absence-document-reason-${document.id}`}
                              rows="3"
                              maxLength={1000}
                              value={rejectionReason}
                              placeholder="Expliquez pourquoi le justificatif est refusé…"
                              onChange={(event) => setRejectionReason(event.target.value)}
                            />
                            <div>
                              <button type="button" className="rh-absence-button rh-absence-button--secondary" onClick={() => { setRejectingDocumentId(null); setRejectionReason('') }}>
                                Annuler
                              </button>
                              <button type="button" className="rh-absence-button rh-absence-button--danger" disabled={documentBusy || rejectionReason.trim().length < 3} onClick={() => handleRejectDocument(document)}>
                                Confirmer le refus
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {declaration.status === 'A_VERIFIER_PAR_RH' && !documentRequired && (
            <div className="rh-absence-detail-notice rh-absence-detail-notice--blue">
              <Icon name="info" size={17} />
              <span>Cette absence ne nécessite pas de justificatif. Elle peut être autorisée directement.</span>
            </div>
          )}
          {declaration.status === 'A_VERIFIER_PAR_RH' && documentRequired && !documentsAccepted && (
            <div className="rh-absence-detail-notice rh-absence-detail-notice--orange">
              <Icon name="clock" size={17} />
              <span>L’autorisation sera disponible après validation de tous les justificatifs obligatoires.</span>
            </div>
          )}
          {declaration.status === 'JUSTIFICATIF_EN_ATTENTE' && (
            <div className="rh-absence-detail-notice rh-absence-detail-notice--orange">
              <Icon name="clock" size={17} />
              <span>Le collaborateur doit encore fournir le justificatif demandé.</span>
            </div>
          )}
          {declaration.status === 'JUSTIFICATIF_REJETE' && (
            <div className="rh-absence-detail-notice rh-absence-detail-notice--red">
              <Icon name="alert" size={17} />
              <span>Le justificatif a été refusé : cette absence est automatiquement considérée comme refusée.</span>
            </div>
          )}

          <div className="rh-absence-detail-actions">
            {declaration.status === 'A_VERIFIER_PAR_RH' && (
              <button
                type="button"
                className="rh-absence-button rh-absence-button--primary"
                disabled={busy || !canAuthorize}
                title={!canAuthorize && documentRequired ? 'Validez d’abord le justificatif.' : undefined}
                onClick={() => onRegister(declaration)}
              >
                <Icon name="check" size={16} /> Autoriser l’absence
              </button>
            )}
            {declaration.status === 'ENREGISTREE' && (
              <button type="button" className="rh-absence-button rh-absence-button--danger" disabled={busy} onClick={() => onCancel(declaration)}>
                Annuler l’absence
              </button>
            )}
            {isOwnRhDraft && (
              <button type="button" className="rh-absence-button rh-absence-button--danger" disabled={busy} onClick={() => onDeleteDraft(declaration)}>
                <Icon name="trash" size={16} /> Supprimer le brouillon
              </button>
            )}
            <button type="button" className="rh-absence-button rh-absence-button--secondary" onClick={onClose}>Fermer</button>
          </div>
        </aside>
      </div>

      <DocumentPreviewModal
        document={preview.document}
        blobUrl={preview.blobUrl}
        mimeType={preview.mimeType}
        loading={preview.loading}
        error={preview.error}
        onClose={closePreview}
        onDownload={handlePreviewDownload}
      />
    </>
  )
}

export function RhAbsencesPage() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const [state, setState] = useState({ loading: true, error: false, declarations: [], employees: [], types: [] })
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: false }))
    }

    try {
      const [declarations, employees, types] = await Promise.all([
        getRhAbsenceDeclarations(),
        getRhAbsenceEmployees(),
        getRhAbsenceTypes(),
      ])
      setState({ loading: false, error: false, declarations, employees, types })
    } catch {
      if (!silent) {
        setState((current) => ({ ...current, loading: false, error: true }))
      }
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0)
    const refreshSilently = () => load({ silent: true })

    window.addEventListener('gmes:data-changed', refreshSilently)
    window.addEventListener('focus', refreshSilently)

    return () => {
      window.clearTimeout(initialLoad)
      window.removeEventListener('gmes:data-changed', refreshSilently)
      window.removeEventListener('focus', refreshSilently)
    }
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const managedDeclarations = useMemo(
    () => state.declarations.filter((declaration) => (
      declaration.status !== 'BROUILLON' || declaration.createdBy?.role === 'RH'
    )),
    [state.declarations],
  )

  const counts = useMemo(() => ({
    all: managedDeclarations.length,
    pending: managedDeclarations.filter((item) => statusMatches(item.status, 'pending')).length,
    waiting: managedDeclarations.filter((item) => statusMatches(item.status, 'waiting')).length,
    approved: managedDeclarations.filter((item) => statusMatches(item.status, 'approved')).length,
    rejected: managedDeclarations.filter((item) => statusMatches(item.status, 'rejected')).length,
    cancelled: managedDeclarations.filter((item) => statusMatches(item.status, 'cancelled')).length,
  }), [managedDeclarations])

  const filtered = useMemo(
    () => managedDeclarations.filter((declaration) => (
      statusMatches(declaration.status, statusFilter) && declarationMatchesSearch(declaration, search)
    )),
    [managedDeclarations, search, statusFilter],
  )


  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const showFeedback = (kind, message) => setFeedback({ kind, message })

  const handleSaved = async (message) => {
    setCreateOpen(false)
    showFeedback('success', message)
    await load()
  }

  const handleRegister = async (declaration) => {
    if (busy) return
    setBusy(true)
    try {
      await registerRhAbsence(declaration.id)
      setSelected(null)
      showFeedback('success', `L’absence de ${fullName(declaration.employee)} a été autorisée.`)
      await load()
    } catch (error) {
      showFeedback('error', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async (declaration) => {
    if (busy || !window.confirm(`Annuler l’absence de ${fullName(declaration.employee)} ?`)) return
    setBusy(true)
    try {
      await cancelRhAbsence(declaration.id)
      setSelected(null)
      showFeedback('success', 'L’absence a été annulée.')
      await load()
    } catch (error) {
      showFeedback('error', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteDraft = async (declaration) => {
    if (busy || !window.confirm('Supprimer définitivement ce brouillon RH ?')) return
    setBusy(true)
    try {
      await deleteRhAbsenceDraft(declaration.id)
      setSelected(null)
      showFeedback('success', 'Le brouillon RH a été supprimé.')
      await load()
    } catch (error) {
      showFeedback('error', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDeclarationChanged = async (declaration) => {
    setSelected(declaration)
    await load()
  }

  return (
    <PageContainer className="rh-absences-page">
      {feedback && (
        <div className={`rh-absences-feedback rh-absences-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

      <section className="rh-absences-card">
        <div className="rh-absences-toolbar">
          <div>
            <h2>Gestion des absences</h2>
            <p>Déclarations à vérifier et absences autorisées au même endroit.</p>
          </div>
          <button type="button" className="rh-absences-create" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={17} /> Enregistrer une absence
          </button>
        </div>

        <div className="rh-absences-tabs" role="tablist" aria-label="Statut des absences">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === filter.id}
              className={`rh-absences-tab ${statusFilter === filter.id ? 'is-active' : ''}`}
              onClick={() => { setStatusFilter(filter.id); setPage(1) }}
            >
              {filter.label} <span>{counts[filter.id]}</span>
            </button>
          ))}
        </div>

        <div className="rh-absences-table-wrap">
          <div className="rh-absences-table">
            <div className="rh-absences-row rh-absences-row--header">
              <span>Collaborateur</span><span>Type</span><span>Début</span><span>Fin</span><span>Durée</span><span>Statut</span><span>Enregistrée par</span><span />
            </div>

            {state.loading ? (
              Array.from({ length: 5 }, (_, index) => <div className="rh-absences-skeleton" key={index} />)
            ) : state.error ? (
              <div className="rh-absences-empty">
                <span className="rh-absences-empty__icon"><Icon name="alert" size={22} /></span>
                <strong>Impossible de charger les absences.</strong>
                <button type="button" onClick={load}>Réessayer</button>
              </div>
            ) : visible.length === 0 ? (
              <div className="rh-absences-empty">
                <span className="rh-absences-empty__icon"><Icon name="calendar" size={22} /></span>
                <strong>Aucune absence dans cette vue.</strong>
                <span>Modifiez le filtre ou enregistrez une nouvelle absence.</span>
              </div>
            ) : visible.map((declaration) => {
              const meta = statusMeta(declaration.status)
              return (
                <button key={declaration.id} type="button" className="rh-absences-row rh-absences-row--data" onClick={() => setSelected(declaration)}>
                  <span className="rh-absences-person">
                    <span className="rh-absences-avatar">{initials(declaration.employee)}</span>
                    <span><strong>{fullName(declaration.employee)}</strong><small>{declaration.service?.name ?? 'Service non renseigné'}</small></span>
                  </span>
                  <span className="rh-absences-type">{declaration.leaveType?.name ?? '—'}</span>
                  <span>{formatDateNumericFR(declaration.startDate)}</span>
                  <span>{formatDateNumericFR(declaration.endDate)}</span>
                  <span className="rh-absences-duration">{formatDuration(declaration)}</span>
                  <span><span className={`rh-absence-status rh-absence-status--${meta.tone}`}>{meta.label}</span></span>
                  <span className="rh-absences-created-by">{fullName(declaration.createdBy)}</span>
                  <span className="rh-absences-eye"><Icon name="eye" size={17} /></span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rh-absences-footer">
          <span>{filtered.length} absence{filtered.length > 1 ? 's' : ''}</span>
          {totalPages > 1 && (
            <div className="rh-absences-pagination">
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><Icon name="chevronLeft" size={16} /></button>
              <span>{safePage} / {totalPages}</span>
              <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><Icon name="chevronRight" size={16} /></button>
            </div>
          )}
        </div>
      </section>

      {createOpen && (
        <CreateAbsenceDrawer
          employees={state.employees}
          types={state.types}
          onClose={() => setCreateOpen(false)}
          onSaved={handleSaved}
        />
      )}
      {selected && (
        <DetailDrawer
          declaration={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onRegister={handleRegister}
          onCancel={handleCancel}
          onDeleteDraft={handleDeleteDraft}
          onDeclarationChanged={handleDeclarationChanged}
          onFeedback={showFeedback}
        />
      )}
    </PageContainer>
  )
}
