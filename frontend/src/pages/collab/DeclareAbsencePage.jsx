import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AbsenceDocumentPicker } from '@/components/collab/absence/AbsenceDocumentPicker'
import { AbsenceTypeSelector } from '@/components/collab/absence/AbsenceTypeSelector'
import { Icon } from '@/components/ui/Icon'
import {
  createAbsenceDeclaration,
  deleteAbsenceDocument,
  getCollaboratorAbsenceTypes,
  submitAbsenceDeclaration,
  updateAbsenceDeclaration,
  uploadAbsenceDocument,
} from '@/services/absenceDeclarations'
import { formatDateNumericFR, todayISO } from '@/utils/format'
import { errorMessage } from '@/utils/newRequest'
import { getAbsenceDeclaration, getAbsenceDocuments } from '@/services/requestDetails'

import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/absence.css'

const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']


function normalizedComment(value) {
  return String(value ?? '').trim()
}

function sameDraftPayload(draft, payload) {
  if (!draft) return false
  return (
    Number(draft.leaveTypeId) === Number(payload.leaveTypeId) &&
    draft.startDate === payload.startDate &&
    draft.endDate === payload.endDate &&
    (draft.startPeriod ?? null) === (payload.startPeriod ?? null) &&
    (draft.endPeriod ?? null) === (payload.endPeriod ?? null) &&
    Number(draft.durationHours ?? 0) === Number(payload.durationHours ?? 0) &&
    normalizedComment(draft.comment) === normalizedComment(payload.comment)
  )
}

function durationInDays(startDate, endDate, startPeriod, endPeriod) {
  if (!startDate || !endDate || endDate < startDate) return null
  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  let days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (startPeriod === 'APRES_MIDI') days -= 0.5
  if (endPeriod === 'MATIN') days -= 0.5
  return Math.max(days, 0)
}

function formatDuration(value, unit) {
  if (value === null || value === undefined) return '—'
  return `${String(value).replace('.', ',')} ${unit}`
}

function Feedback({ feedback, onClose }) {
  if (!feedback) return null
  return (
    <div className={`absence-feedback absence-feedback--${feedback.kind}`} role="status">
      <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
      <span>{feedback.message}</span>
      <button type="button" aria-label="Fermer" onClick={onClose}>×</button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="absence-page absence-page--loading" aria-busy="true">
      <div className="absence-skeleton absence-skeleton--types" />
      <div className="absence-form-grid">
        <div className="absence-skeleton absence-skeleton--form" />
        <div className="absence-skeleton absence-skeleton--side" />
      </div>
    </div>
  )
}

export function DeclareAbsencePage() {
  const navigate = useNavigate()
  const { id: editId } = useParams()
  const isEditMode = Boolean(editId)
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState(null)
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadedDocuments, setUploadedDocuments] = useState([])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [form, setForm] = useState({
    leaveTypeId: null,
    startDate: todayISO(),
    endDate: todayISO(),
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
    durationHours: '',
    comment: '',
    certifiedAccurate: false,
  })

  const loadTypes = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await getCollaboratorAbsenceTypes()
      setTypes(data)

      if (isEditMode) {
        const [declaration, documents] = await Promise.all([
          getAbsenceDeclaration(editId),
          getAbsenceDocuments(editId),
        ])

        if (declaration.status !== 'BROUILLON') {
          navigate(`/app/my-requests/absence/${declaration.id}`, { replace: true })
          return
        }

        setDraft(declaration)
        setUploadedDocuments(documents ?? [])
        setForm({
          leaveTypeId: Number(declaration.leaveTypeId),
          startDate: declaration.startDate,
          endDate: declaration.endDate,
          startPeriod: declaration.startPeriod || 'MATIN',
          endPeriod: declaration.endPeriod || 'APRES_MIDI',
          durationHours: declaration.durationHours ?? '',
          comment: declaration.comment || '',
          certifiedAccurate: false,
        })
      } else {
        setForm((current) => ({
          ...current,
          leaveTypeId: current.leaveTypeId ?? data[0]?.id ?? null,
        }))
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [editId, isEditMode, navigate])

  useEffect(() => {
    loadTypes()
  }, [loadTypes])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const selectedType = useMemo(
    () => types.find((type) => Number(type.id) === Number(form.leaveTypeId)) ?? null,
    [form.leaveTypeId, types],
  )

  const hoursOnly = Boolean(
    selectedType?.allowsHours && !selectedType?.allowsDays && !selectedType?.allowsHalfDays,
  )

  const validationError = useMemo(() => {
    if (!form.leaveTypeId) return 'Sélectionnez un type d’absence.'
    if (!form.startDate) return 'Indiquez la date de début.'
    if (hoursOnly) {
      const hours = Number(form.durationHours)
      if (!Number.isFinite(hours) || hours <= 0) return 'Indiquez une durée en heures.'
      return null
    }
    if (!form.endDate) return 'Indiquez la date de fin.'
    if (form.endDate < form.startDate) return 'La date de fin ne peut pas précéder la date de début.'
    if (
      form.startDate === form.endDate &&
      form.startPeriod === 'APRES_MIDI' &&
      form.endPeriod === 'MATIN'
    ) {
      return 'La période de fin ne peut pas précéder la période de début.'
    }
    return null
  }, [form, hoursOnly])

  const duration = useMemo(() => {
    if (hoursOnly) {
      const hours = Number(form.durationHours)
      return Number.isFinite(hours) && hours > 0 ? { value: hours, unit: 'h' } : null
    }
    const value = durationInDays(
      form.startDate,
      form.endDate,
      form.startPeriod,
      form.endPeriod,
    )
    return value === null ? null : { value, unit: 'j' }
  }, [form, hoursOnly])

  const buildPayload = useCallback(() => {
    const base = {
      leaveTypeId: Number(form.leaveTypeId),
      startDate: form.startDate,
      endDate: hoursOnly ? form.startDate : form.endDate,
      comment: normalizedComment(form.comment),
    }

    if (hoursOnly) {
      return { ...base, durationHours: Number(form.durationHours) }
    }

    return {
      ...base,
      startPeriod: form.startPeriod,
      endPeriod: form.endPeriod,
    }
  }, [form, hoursOnly])

  const showFeedback = useCallback((kind, message) => {
    setFeedback({ kind, message })
  }, [])

  const persistDraft = useCallback(async () => {
    if (validationError) {
      throw new Error(validationError)
    }

    const payload = buildPayload()
    if (sameDraftPayload(draft, payload)) return draft

    const saved = draft
      ? await updateAbsenceDeclaration(draft.id, payload)
      : await createAbsenceDeclaration(payload)

    setDraft(saved)
    return saved
  }, [buildPayload, draft, validationError])

  const uploadPendingFiles = useCallback(async (declarationId) => {
    if (pendingFiles.length === 0) return []

    const uploaded = []
    const failed = []

    for (const file of pendingFiles) {
      try {
        const document = await uploadAbsenceDocument(declarationId, file)
        uploaded.push(document)
      } catch {
        failed.push(file)
      }
    }

    if (uploaded.length > 0) {
      setUploadedDocuments((current) => [...current, ...uploaded])
    }
    setPendingFiles(failed)

    if (failed.length > 0) {
      throw new Error(
        failed.length === 1
          ? `Le fichier « ${failed[0].name} » n’a pas pu être enregistré.`
          : `${failed.length} justificatifs n’ont pas pu être enregistrés.`,
      )
    }

    return uploaded
  }, [pendingFiles])

  const handleFiles = (files) => {
    const existingCount = pendingFiles.length + uploadedDocuments.length
    const availableSlots = Math.max(0, MAX_FILES - existingCount)
    if (availableSlots === 0) {
      showFeedback('error', 'Vous avez déjà atteint la limite de 5 justificatifs.')
      return
    }

    const accepted = []
    for (const file of files.slice(0, availableSlots)) {
      const lowerName = file.name.toLocaleLowerCase('fr-FR')
      const validExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
      if (!ALLOWED_MIME_TYPES.has(file.type) || !validExtension) {
        showFeedback('error', `« ${file.name} » n’est pas un PDF, JPG ou PNG valide.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        showFeedback('error', `« ${file.name} » dépasse la limite de 10 Mo.`)
        continue
      }
      accepted.push(file)
    }

    if (files.length > availableSlots) {
      showFeedback('error', 'Une déclaration ne peut contenir que 5 justificatifs maximum.')
    }

    setPendingFiles((current) => [...current, ...accepted])
  }

  const handleRemoveUploaded = async (document) => {
    if (saving || submitting) return
    try {
      await deleteAbsenceDocument(document.id)
      setUploadedDocuments((current) => current.filter((item) => item.id !== document.id))
      showFeedback('success', 'Justificatif supprimé.')
    } catch (error) {
      showFeedback('error', errorMessage(error))
    }
  }

  const handleSaveDraft = async () => {
    if (saving || submitting) return
    if (validationError) {
      showFeedback('error', validationError)
      return
    }

    setSaving(true)
    try {
      const saved = await persistDraft()
      await uploadPendingFiles(saved.id)
      showFeedback('success', draft ? 'Brouillon mis à jour.' : 'Brouillon enregistré.')
    } catch (error) {
      showFeedback('error', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (saving || submitting) return
    if (validationError) {
      showFeedback('error', validationError)
      return
    }
    if (!form.certifiedAccurate) {
      showFeedback('error', 'Vous devez certifier l’exactitude des informations avant la transmission.')
      return
    }

    const documentCount = uploadedDocuments.length + pendingFiles.length
    if (
      selectedType?.documentRequired &&
      !selectedType.documentCanBeAddedLater &&
      documentCount === 0
    ) {
      showFeedback('error', 'Ajoutez le justificatif obligatoire avant de transmettre la déclaration.')
      return
    }

    setSubmitting(true)
    try {
      const saved = await persistDraft()
      await uploadPendingFiles(saved.id)
      await submitAbsenceDeclaration(saved.id, { certifiedAccurate: true })
      notifyAppDataChanged({ source: 'absence-declaration', action: 'submitted', id: saved.id })
      showFeedback('success', 'Absence transmise à la RH.')
      window.setTimeout(() => navigate('/app/my-requests'), 900)
    } catch (error) {
      showFeedback('error', errorMessage(error))
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingState />

  if (loadError) {
    return (
      <div className="absence-page">
        <div className="absence-load-error">
          <span><Icon name="alert" size={24} /></span>
          <strong>Impossible de charger les types d’absence</strong>
          <p>Les informations nécessaires sont momentanément indisponibles.</p>
          <button type="button" onClick={loadTypes}>Réessayer</button>
        </div>
      </div>
    )
  }

  if (types.length === 0) {
    return (
      <div className="absence-page">
        <div className="absence-load-error absence-load-error--empty">
          <span><Icon name="calendar" size={24} /></span>
          <strong>Aucun type d’absence disponible</strong>
          <p>La RH n’a actuellement activé aucun type d’absence déclarable par un collaborateur.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="absence-page">
      <Feedback feedback={feedback} onClose={() => setFeedback(null)} />

      <AbsenceTypeSelector
        types={types}
        selectedId={form.leaveTypeId}
        onSelect={(leaveTypeId) =>
          setForm((current) => ({ ...current, leaveTypeId }))
        }
      />

      <div className="absence-form-grid">
        <div className="absence-form-main">
          <section className="absence-card">
            <div className="absence-card__heading">
              <div>
                <span className="absence-card__eyebrow">Étape 2</span>
                <h2>Période de l’absence</h2>
                <p>Indiquez la date et, si nécessaire, les demi-journées concernées.</p>
              </div>
            </div>

            {hoursOnly ? (
              <div className="absence-fields absence-fields--hours">
                <label className="absence-field">
                  <span>Date</span>
                  <div className="absence-input-wrap">
                    <Icon name="calendar" size={17} />
                    <input
                      type="date"
                      value={form.startDate}
                      disabled={saving || submitting}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          startDate: event.target.value,
                          endDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                </label>
                <label className="absence-field">
                  <span>Durée totale</span>
                  <div className="absence-input-wrap">
                    <Icon name="clock" size={17} />
                    <input
                      type="number"
                      min="0.25"
                      max="744"
                      step="0.25"
                      placeholder="Ex. 4"
                      value={form.durationHours}
                      disabled={saving || submitting}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, durationHours: event.target.value }))
                      }
                    />
                    <span className="absence-input-suffix">heures</span>
                  </div>
                </label>
              </div>
            ) : (
              <>
                <div className="absence-fields">
                  <label className="absence-field">
                    <span>Date de début</span>
                    <div className="absence-input-wrap">
                      <Icon name="calendar" size={17} />
                      <input
                        type="date"
                        value={form.startDate}
                        disabled={saving || submitting}
                        onChange={(event) => {
                          const startDate = event.target.value
                          setForm((current) => ({
                            ...current,
                            startDate,
                            endDate: current.endDate && current.endDate < startDate ? startDate : current.endDate,
                          }))
                        }}
                      />
                    </div>
                  </label>
                  <label className="absence-field">
                    <span>Date de fin</span>
                    <div className="absence-input-wrap">
                      <Icon name="calendar" size={17} />
                      <input
                        type="date"
                        min={form.startDate || undefined}
                        value={form.endDate}
                        disabled={saving || submitting}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, endDate: event.target.value }))
                        }
                      />
                    </div>
                  </label>
                </div>

                {selectedType?.allowsHalfDays && (
                  <div className="absence-half-days">
                    <div className="absence-half-day-group">
                      <span>Premier jour</span>
                      <div className="absence-segmented">
                        {[
                          ['MATIN', 'Matin'],
                          ['APRES_MIDI', 'Après-midi'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={form.startPeriod === value ? 'is-active' : ''}
                            disabled={saving || submitting}
                            onClick={() => setForm((current) => ({ ...current, startPeriod: value }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="absence-half-day-group">
                      <span>Dernier jour</span>
                      <div className="absence-segmented">
                        {[
                          ['MATIN', 'Matin'],
                          ['APRES_MIDI', 'Après-midi'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={form.endPeriod === value ? 'is-active' : ''}
                            disabled={saving || submitting}
                            onClick={() => setForm((current) => ({ ...current, endPeriod: value }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {validationError && form.leaveTypeId && (
              <div className="absence-inline-error">
                <Icon name="alert" size={15} />
                <span>{validationError}</span>
              </div>
            )}
          </section>

          <AbsenceDocumentPicker
            required={Boolean(selectedType?.documentRequired)}
            canAddLater={Boolean(selectedType?.documentCanBeAddedLater)}
            pendingFiles={pendingFiles}
            uploadedDocuments={uploadedDocuments}
            onFiles={handleFiles}
            onRemovePending={(index) =>
              setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
            }
            onRemoveUploaded={handleRemoveUploaded}
            disabled={saving || submitting}
          />

          <section className="absence-card">
            <div className="absence-card__heading">
              <div>
                <span className="absence-card__eyebrow">Étape 4</span>
                <h2>Informations complémentaires</h2>
                <p>Ajoutez un commentaire si une précision peut être utile à la RH.</p>
              </div>
            </div>
            <label className="absence-field absence-field--textarea">
              <span>Commentaire <small>facultatif</small></span>
              <textarea
                rows="4"
                maxLength="1000"
                placeholder="Ajouter une précision…"
                value={form.comment}
                disabled={saving || submitting}
                onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
              />
              <small className="absence-character-count">{form.comment.length}/1000</small>
            </label>
          </section>
        </div>

        <aside className="absence-form-side">
          <section className="absence-summary">
            <div className="absence-summary__header">
              <span className="absence-summary__icon"><Icon name="calendar" size={20} /></span>
              <div>
                <span>Récapitulatif</span>
                <strong>{selectedType?.name || 'Absence'}</strong>
              </div>
            </div>

            <dl className="absence-summary__details">
              <div>
                <dt>Début</dt>
                <dd>{form.startDate ? formatDateNumericFR(form.startDate) : '—'}</dd>
              </div>
              <div>
                <dt>Fin</dt>
                <dd>{hoursOnly
                  ? form.startDate
                    ? formatDateNumericFR(form.startDate)
                    : '—'
                  : form.endDate
                    ? formatDateNumericFR(form.endDate)
                    : '—'}</dd>
              </div>
              <div>
                <dt>Durée</dt>
                <dd>{duration ? formatDuration(duration.value, duration.unit) : '—'}</dd>
              </div>
              <div>
                <dt>Justificatif</dt>
                <dd>{selectedType?.documentRequired ? 'Obligatoire' : 'Facultatif'}</dd>
              </div>
            </dl>

            {selectedType?.documentRequired && pendingFiles.length + uploadedDocuments.length === 0 && (
              <div className="absence-summary__notice">
                <Icon name="info" size={16} />
                <span>
                  {selectedType.documentCanBeAddedLater
                    ? 'Vous pourrez transmettre le justificatif plus tard. La déclaration restera en attente du document.'
                    : 'Ajoutez le justificatif avant de transmettre la déclaration.'}
                </span>
              </div>
            )}

            <label className="absence-certification">
              <input
                type="checkbox"
                checked={form.certifiedAccurate}
                disabled={saving || submitting}
                onChange={(event) =>
                  setForm((current) => ({ ...current, certifiedAccurate: event.target.checked }))
                }
              />
              <span>
                Je certifie l’exactitude des informations renseignées dans cette déclaration.
              </span>
            </label>

            <div className="absence-summary__actions">
              <button
                type="button"
                className="absence-button absence-button--secondary"
                disabled={Boolean(validationError) || saving || submitting}
                onClick={handleSaveDraft}
              >
                {saving ? 'Enregistrement…' : isEditMode ? 'Enregistrer les modifications' : 'Enregistrer en brouillon'}
              </button>
              <button
                type="button"
                className="absence-button absence-button--primary"
                disabled={Boolean(validationError) || saving || submitting}
                onClick={handleSubmit}
              >
                <Icon name="arrowRight" size={17} />
                {submitting ? 'Transmission…' : 'Transmettre à la RH'}
              </button>
            </div>

            <p className="absence-summary__footnote">
              Après transmission, la RH contrôlera votre déclaration et le justificatif lorsqu’il est requis.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
