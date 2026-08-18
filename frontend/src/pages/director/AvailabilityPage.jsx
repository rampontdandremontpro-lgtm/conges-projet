import { useCallback, useEffect, useMemo, useState } from 'react'

import { HalfDaySelector } from '@/components/collab/new-request/HalfDaySelector'
import { LeaveCalendar } from '@/components/collab/new-request/LeaveCalendar'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import {
  createDirectorLeaveRequest,
  getHolidays,
  getLeaveTypes,
} from '@/services/leaveRequests'
import {
  createAbsenceDeclaration,
  deleteAbsenceDocument,
  submitAbsenceDeclaration,
  updateAbsenceDeclaration,
  uploadAbsenceDocument,
} from '@/services/absenceDeclarations'
import { calculateDeductedDaysPreview } from '@/utils/leaveDuration'
import { formatDateFR, formatDays, todayISO } from '@/utils/format'
import { currentMonth, errorMessage, nextMonthOf, prevMonthOf } from '@/utils/newRequest'
import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/collab/new-request/index.css'
import '@/styles/director/availability.css'

const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

function normalizedComment(value) {
  return String(value ?? '').trim()
}

function durationInDays(selection) {
  const { startDate, endDate, startPeriod, endPeriod } = selection
  if (!startDate || !endDate || endDate < startDate) return null

  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  let days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (startPeriod === 'APRES_MIDI') days -= 0.5
  if (endPeriod === 'MATIN') days -= 0.5
  return Math.max(days, 0)
}

function periodLabel(period) {
  return period === 'APRES_MIDI' ? 'après-midi' : 'matin'
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

function LoadingState() {
  return (
    <div className="director-availability director-availability--loading" aria-busy="true">
      <div className="director-availability-layout">
        <div className="director-availability-skeleton director-availability-skeleton--left" />
        <div className="director-availability-skeleton director-availability-skeleton--calendar" />
      </div>
    </div>
  )
}

export function DirectorAvailabilityPage() {
  const [mode, setMode] = useState('LEAVE')
  const [types, setTypes] = useState([])
  const [selectedTypeId, setSelectedTypeId] = useState(null)
  const [month, setMonth] = useState(() => currentMonth())
  const [holidays, setHolidays] = useState([])
  const [loadedHolidayYears, setLoadedHolidayYears] = useState(() => new Set())
  const [selection, setSelection] = useState({
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  })
  const [comment, setComment] = useState('')
  const [durationHours, setDurationHours] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadedDocuments, setUploadedDocuments] = useState([])
  const [absenceDraft, setAbsenceDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((kind, message) => {
    setToast({ kind, message })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)

    getLeaveTypes()
      .then((data) => {
        if (cancelled) return
        const available = (data ?? []).filter(
          (type) => type.isActive && type.employeeCanCreate && !type.rhOnly,
        )
        setTypes(available)
        const leaveTypes = available.filter((type) => type.category === 'DEMANDE_CONGE')
        const preferred =
          leaveTypes.find((type) => type.deductsPaidLeaveBalance) ?? leaveTypes[0] ?? null
        setSelectedTypeId(preferred?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loadedHolidayYears.has(month.year)) return undefined

    let cancelled = false
    getHolidays(month.year)
      .then((data) => {
        if (cancelled) return
        setHolidays((current) => {
          const byDate = new Map(current.map((holiday) => [String(holiday.date).slice(0, 10), holiday]))
          for (const holiday of data ?? []) {
            byDate.set(String(holiday.date).slice(0, 10), holiday)
          }
          return [...byDate.values()]
        })
        setLoadedHolidayYears((current) => new Set([...current, month.year]))
      })
      .catch(() => {
        if (!cancelled) {
          showToast('error', `Les jours fériés ${month.year} n’ont pas pu être chargés.`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [loadedHolidayYears, month.year, showToast])

  const leaveTypes = useMemo(
    () => types.filter((type) => type.category === 'DEMANDE_CONGE'),
    [types],
  )
  const absenceTypes = useMemo(
    () => types.filter((type) => type.category === 'DECLARATION_ABSENCE'),
    [types],
  )
  const availableTypes = mode === 'LEAVE' ? leaveTypes : absenceTypes
  const selectedType = useMemo(
    () => availableTypes.find((type) => Number(type.id) === Number(selectedTypeId)) ?? null,
    [availableTypes, selectedTypeId],
  )

  const hoursOnly = Boolean(
    mode === 'ABSENCE' &&
      selectedType?.allowsHours &&
      !selectedType?.allowsDays &&
      !selectedType?.allowsHalfDays,
  )
  const halfDaysAllowed = Boolean(selectedType?.allowsHalfDays) && !hoursOnly

  useEffect(() => {
    if (!selectedType || halfDaysAllowed || hoursOnly) return
    setSelection((current) => ({
      ...current,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    }))
  }, [halfDaysAllowed, hoursOnly, selectedType])

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return
    const nextTypes = nextMode === 'LEAVE' ? leaveTypes : absenceTypes
    const preferred =
      nextMode === 'LEAVE'
        ? nextTypes.find((type) => type.deductsPaidLeaveBalance) ?? nextTypes[0] ?? null
        : nextTypes[0] ?? null

    setMode(nextMode)
    setSelectedTypeId(preferred?.id ?? null)
    setDurationHours('')
    setPendingFiles([])
    setUploadedDocuments([])
    setAbsenceDraft(null)
  }

  const handleTypeChange = (event) => {
    setSelectedTypeId(Number(event.target.value))
    setDurationHours('')
    setPendingFiles([])
    setUploadedDocuments([])
    setAbsenceDraft(null)
  }

  const handlePick = (iso) => {
    if (hoursOnly) {
      setSelection((current) => ({ ...current, startDate: iso, endDate: iso }))
      return
    }

    setSelection((current) => {
      if (current.startDate && iso === current.startDate) {
        return { ...current, startDate: null, endDate: null }
      }
      if (!current.startDate || current.endDate) {
        return { ...current, startDate: iso, endDate: null }
      }
      if (iso < current.startDate) {
        return { ...current, startDate: iso, endDate: current.startDate }
      }
      return { ...current, endDate: iso }
    })
  }

  const handleFiles = (files) => {
    const availableSlots = Math.max(0, MAX_FILES - pendingFiles.length - uploadedDocuments.length)
    if (availableSlots === 0) {
      showToast('error', 'Vous avez déjà atteint la limite de 5 justificatifs.')
      return
    }

    const accepted = []
    for (const file of files.slice(0, availableSlots)) {
      const lowerName = file.name.toLocaleLowerCase('fr-FR')
      const validExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
      if (!ALLOWED_MIME_TYPES.has(file.type) || !validExtension) {
        showToast('error', `« ${file.name} » n’est pas un PDF, JPG ou PNG valide.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast('error', `« ${file.name} » dépasse la limite de 10 Mo.`)
        continue
      }
      accepted.push(file)
    }

    if (files.length > availableSlots) {
      showToast('error', 'Une absence ne peut contenir que 5 justificatifs maximum.')
    }
    setPendingFiles((current) => [...current, ...accepted])
  }

  const handleRemoveUploaded = async (document) => {
    if (saving) return
    try {
      await deleteAbsenceDocument(document.id)
      setUploadedDocuments((current) => current.filter((item) => item.id !== document.id))
    } catch (error) {
      showToast('error', errorMessage(error))
    }
  }

  const duration = useMemo(() => {
    if (!selection.startDate || !selection.endDate || !selectedType) return null
    if (hoursOnly) {
      const hours = Number(durationHours)
      return Number.isFinite(hours) && hours > 0 ? { value: hours, unit: 'h' } : null
    }
    if (mode === 'LEAVE') {
      const value = calculateDeductedDaysPreview(selection, holidays)
      return value == null ? null : { value, unit: 'j' }
    }
    const value = durationInDays(selection)
    return value == null ? null : { value, unit: 'j' }
  }, [durationHours, holidays, hoursOnly, mode, selectedType, selection])

  const validationError = useMemo(() => {
    if (!selectedType) {
      return mode === 'LEAVE' ? 'Aucun type de congé disponible.' : 'Aucun type d’absence disponible.'
    }
    if (!selection.startDate) return 'Sélectionnez la date de début.'
    if (!selection.endDate) return 'Sélectionnez la date de fin.'
    if (selection.endDate < selection.startDate) return 'La date de fin doit suivre la date de début.'
    if (
      selection.startDate === selection.endDate &&
      selection.startPeriod === 'APRES_MIDI' &&
      selection.endPeriod === 'MATIN'
    ) {
      return 'La période de fin ne peut pas précéder la période de début.'
    }
    if (hoursOnly) {
      const hours = Number(durationHours)
      if (!Number.isFinite(hours) || hours <= 0) return 'Indiquez la durée de l’absence en heures.'
    }
    if (
      mode === 'ABSENCE' &&
      selectedType.documentRequired &&
      !selectedType.documentCanBeAddedLater &&
      pendingFiles.length + uploadedDocuments.length === 0
    ) {
      return 'Ajoutez le justificatif obligatoire avant l’enregistrement.'
    }
    return null
  }, [durationHours, hoursOnly, mode, pendingFiles.length, selectedType, selection, uploadedDocuments.length])

  const resetForm = () => {
    const leavePreferred =
      leaveTypes.find((type) => type.deductsPaidLeaveBalance) ?? leaveTypes[0] ?? null
    setMode('LEAVE')
    setSelectedTypeId(leavePreferred?.id ?? null)
    setSelection({
      startDate: null,
      endDate: null,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    })
    setComment('')
    setDurationHours('')
    setPendingFiles([])
    setUploadedDocuments([])
    setAbsenceDraft(null)
  }

  const handleSave = async () => {
    if (validationError) {
      showToast('error', validationError)
      return
    }

    setSaving(true)
    try {
      if (mode === 'LEAVE') {
        await createDirectorLeaveRequest({
          leaveTypeId: Number(selectedType.id),
          startDate: selection.startDate,
          endDate: selection.endDate,
          startPeriod: selection.startPeriod,
          endPeriod: selection.endPeriod,
          comment: normalizedComment(comment),
        })
        notifyAppDataChanged()
        resetForm()
        showToast('success', 'Votre congé a été enregistré directement.')
        return
      }

      const payload = {
        leaveTypeId: Number(selectedType.id),
        startDate: selection.startDate,
        endDate: hoursOnly ? selection.startDate : selection.endDate,
        comment: normalizedComment(comment),
        ...(hoursOnly
          ? { durationHours: Number(durationHours) }
          : {
              startPeriod: selection.startPeriod,
              endPeriod: selection.endPeriod,
            }),
      }

      const draft = absenceDraft
        ? await updateAbsenceDeclaration(absenceDraft.id, payload)
        : await createAbsenceDeclaration(payload)
      setAbsenceDraft(draft)

      const filesToUpload = [...pendingFiles]
      for (const file of filesToUpload) {
        const document = await uploadAbsenceDocument(draft.id, file)
        setUploadedDocuments((current) => [...current, document])
        setPendingFiles((current) => current.filter((item) => item !== file))
      }

      const registered = await submitAbsenceDeclaration(draft.id, { certifiedAccurate: true })
      notifyAppDataChanged()
      resetForm()
      showToast(
        'success',
        registered.status === 'ENREGISTREE'
          ? 'Votre absence a été enregistrée directement.'
          : 'Votre absence a été transmise avec son justificatif.',
      )
    } catch (error) {
      showToast('error', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />

  if (loadError) {
    return (
      <div className="director-availability director-availability--error">
        <div className="director-availability-error-card">
          <span><Icon name="alert" size={24} /></span>
          <h2>Impossible de charger la page</h2>
          <p>Les types de congés et d’absences sont momentanément indisponibles.</p>
          <button type="button" onClick={() => window.location.reload()}>Réessayer</button>
        </div>
      </div>
    )
  }

  return (
    <div className="nr-page director-availability">
      <div className="director-availability-layout">
        <div className="director-availability-left">
          <section className="director-availability-card director-availability-type-card">
            <div className="director-availability-card__heading">
              <div>
                <span className="director-availability-eyebrow">Mon indisponibilité</span>
                <h2>Que souhaitez-vous enregistrer ?</h2>
              </div>
            </div>

            <div className="director-availability-mode-grid">
              <button
                type="button"
                className={`director-availability-mode${mode === 'LEAVE' ? ' is-active' : ''}`}
                onClick={() => handleModeChange('LEAVE')}
                aria-pressed={mode === 'LEAVE'}
              >
                <span className="director-availability-mode__icon director-availability-mode__icon--leave">
                  <Icon name="sun" size={21} />
                </span>
                <span>
                  <strong>Congé</strong>
                  <small>Décompté selon le type sélectionné</small>
                </span>
                <i><Icon name="check" size={13} /></i>
              </button>

              <button
                type="button"
                className={`director-availability-mode${mode === 'ABSENCE' ? ' is-active' : ''}`}
                onClick={() => handleModeChange('ABSENCE')}
                aria-pressed={mode === 'ABSENCE'}
              >
                <span className="director-availability-mode__icon director-availability-mode__icon--absence">
                  <Icon name="calendar" size={21} />
                </span>
                <span>
                  <strong>Absence</strong>
                  <small>Maladie ou autre absence autorisée</small>
                </span>
                <i><Icon name="check" size={13} /></i>
              </button>
            </div>

            <label className="director-availability-field">
              <span>{mode === 'LEAVE' ? 'Type de congé' : 'Type d’absence'}</span>
              <select value={selectedTypeId ?? ''} onChange={handleTypeChange} disabled={availableTypes.length === 0}>
                {availableTypes.length === 0 && <option value="">Aucun type disponible</option>}
                {availableTypes.map((type) => (
                  <option value={type.id} key={type.id}>{type.name}</option>
                ))}
              </select>
            </label>
          </section>

          {(halfDaysAllowed || hoursOnly) && (
            <section className="director-availability-card director-availability-duration-card">
              {halfDaysAllowed ? (
                <HalfDaySelector
                  startPeriod={selection.startPeriod}
                  endPeriod={selection.endPeriod}
                  onStartChange={(value) => setSelection((current) => ({ ...current, startPeriod: value }))}
                  onEndChange={(value) => setSelection((current) => ({ ...current, endPeriod: value }))}
                />
              ) : (
                <label className="director-availability-field">
                  <span>Durée de l’absence</span>
                  <div className="director-availability-hours">
                    <input
                      type="number"
                      min="0.25"
                      max="744"
                      step="0.25"
                      value={durationHours}
                      onChange={(event) => setDurationHours(event.target.value)}
                      placeholder="Ex. 2"
                    />
                    <span>heures</span>
                  </div>
                </label>
              )}
            </section>
          )}

          <section className="director-availability-card director-availability-comment-card">
            <label className="director-availability-field director-availability-field--textarea">
              <span>Motif <em>(optionnel)</em></span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={1000}
                placeholder="Précisez le motif si nécessaire…"
              />
            </label>
          </section>

          {mode === 'ABSENCE' && selectedType?.documentRequired && (
            <section className="director-availability-card director-availability-document-card">
              <div className="director-availability-document-heading">
                <span>
                  <strong>Justificatif</strong>
                  <small>
                    {selectedType.documentCanBeAddedLater
                      ? 'Obligatoire, mais il peut être ajouté ultérieurement.'
                      : 'Obligatoire avant l’enregistrement.'}
                  </small>
                </span>
                <span className="director-availability-required">Obligatoire</span>
              </div>

              <label className="director-availability-dropzone">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  multiple
                  disabled={saving || pendingFiles.length + uploadedDocuments.length >= MAX_FILES}
                  onChange={(event) => {
                    handleFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
                <Icon name="file" size={20} />
                <span>
                  <strong>Ajouter un justificatif</strong>
                  <small>PDF, JPG ou PNG · 10 Mo maximum</small>
                </span>
              </label>

              {(pendingFiles.length > 0 || uploadedDocuments.length > 0) && (
                <div className="director-availability-files">
                  {uploadedDocuments.map((document) => (
                    <div key={`uploaded-${document.id}`} className="director-availability-file">
                      <Icon name="check" size={14} />
                      <span>
                        <strong>{document.originalName || `Justificatif ${document.id}`}</strong>
                        <small>Enregistré · {fileSize(Number(document.fileSize))}</small>
                      </span>
                      <button type="button" onClick={() => handleRemoveUploaded(document)} aria-label="Supprimer le justificatif">×</button>
                    </div>
                  ))}
                  {pendingFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}`} className="director-availability-file">
                      <Icon name="clock" size={14} />
                      <span>
                        <strong>{file.name}</strong>
                        <small>À enregistrer · {fileSize(file.size)}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`Retirer ${file.name}`}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="director-availability-card director-availability-recap-card">
            <div className="director-availability-card__heading director-availability-card__heading--recap">
              <div>
                <span className="director-availability-eyebrow">Récapitulatif</span>
                <h2>Votre indisponibilité</h2>
              </div>
            </div>

            {!selection.startDate || !selection.endDate ? (
              <div className="director-availability-recap-empty">
                <Icon name="calendar" size={19} />
                <span>Sélectionnez vos dates dans le calendrier.</span>
              </div>
            ) : (
              <div className="director-availability-recap-grid">
                <span><small>Type</small><strong>{selectedType?.name ?? '—'}</strong></span>
                <span><small>Début</small><strong>{formatDateFR(selection.startDate)} · {periodLabel(selection.startPeriod)}</strong></span>
                <span><small>Fin</small><strong>{formatDateFR(selection.endDate)} · {periodLabel(selection.endPeriod)}</strong></span>
                <span><small>Durée</small><strong>{duration ? `${formatDays(duration.value)} ${duration.unit}` : '—'}</strong></span>
              </div>
            )}

            <button
              type="button"
              className="director-availability-save"
              disabled={saving || Boolean(validationError)}
              onClick={handleSave}
            >
              {saving ? (
                <><span className="director-availability-spinner" /> Enregistrement…</>
              ) : (
                <><Icon name="check" size={18} /> Enregistrer</>
              )}
            </button>
            <p className="director-availability-certification">
              En enregistrant cette indisponibilité, vous certifiez l’exactitude des informations saisies.
            </p>
          </section>
        </div>

        <div className="director-availability-right">
          <section className="director-availability-card director-availability-calendar-card">
            <div className="director-availability-calendar-heading">
              <span>
                <strong>Sélectionnez votre période</strong>
                <small>Cliquez sur le premier puis le dernier jour.</small>
              </span>
              <button type="button" onClick={() => setMonth(currentMonth())}>Aujourd’hui</button>
            </div>
            <div className="director-availability-calendar">
              <LeaveCalendar
                months={[month]}
                todayIso={todayISO()}
                selection={selection}
                holidays={holidays}
                onPick={handlePick}
                onPrev={() => setMonth((current) => prevMonthOf(current))}
                onNext={() => setMonth((current) => nextMonthOf(current))}
              />
            </div>
          </section>
        </div>
      </div>

      <Toast kind={toast?.kind} message={toast?.message} onClose={() => setToast(null)} />
    </div>
  )
}
