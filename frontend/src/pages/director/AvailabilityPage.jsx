import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

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
  submitAbsenceDeclaration,
  updateAbsenceDeclaration,
} from '@/services/absenceDeclarations'
import { calculateDeductedDaysPreview } from '@/utils/leaveDuration'
import { changeLeaveBoundaryPeriod, selectLeaveDate } from '@/utils/leaveDateSelection'
import { isReservedDirectorLeaveType } from '@/utils/filterOptions'
import { formatDateFR, formatDays, todayISO } from '@/utils/format'
import { currentMonth, errorMessage, nextMonthOf, prevMonthOf } from '@/utils/newRequest'
import { notifyAppDataChanged } from '@/utils/dataRefresh'
import {
  getDirectorAbsence,
  getDirectorLeaveRequest,
  updateDirectorAbsence,
  updateDirectorLeaveRequest,
} from '@/services/director/directorUnavailability'

import '@/styles/collab/new-request/index.css'
import '@/styles/director/availability.css'

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
  const navigate = useNavigate()
  const { source: editSource, id: editIdParam } = useParams()
  const editId = editIdParam ? Number(editIdParam) : null
  const isEditing = Boolean(editId && ['leave', 'absence'].includes(editSource))
  const [mode, setMode] = useState('ABSENCE')
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
  const [durationMode, setDurationMode] = useState('PERIOD')
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

    const loadPage = async () => {
      const [typesData, existing] = await Promise.all([
        getLeaveTypes(),
        isEditing
          ? editSource === 'leave'
            ? getDirectorLeaveRequest(editId)
            : getDirectorAbsence(editId)
          : Promise.resolve(null),
      ])

      if (cancelled) return

      const available = (typesData ?? []).filter((type) => type.isActive)
      setTypes(available)

      const directorLeaveTypes = available.filter(
        (type) => type.category === 'DEMANDE_CONGE',
      )
      const preferredDirectorLeave = directorLeaveTypes.find(isReservedDirectorLeaveType) ?? null

      if (!existing) {
        setMode('LEAVE')
        setSelectedTypeId(preferredDirectorLeave?.id ?? null)
        setDurationMode('PERIOD')
        setDurationHours('')
        return
      }

      const start = String(existing.startDate ?? '').slice(0, 10)
      if (start) {
        const [year, monthNumber] = start.split('-').map(Number)
        if (year && monthNumber) setMonth({ year, month: monthNumber - 1 })
      }

      setComment(existing.comment ?? '')
      setSelection({
        startDate: existing.startDate ?? null,
        endDate: existing.endDate ?? existing.startDate ?? null,
        startPeriod: existing.startPeriod ?? 'MATIN',
        endPeriod: existing.endPeriod ?? 'APRES_MIDI',
      })

      if (editSource === 'leave') {
        setMode('LEAVE')
        setSelectedTypeId(existing.leaveTypeId ?? directorLeaveTypes[0]?.id ?? null)
        setDurationHours(existing.durationHours != null ? String(existing.durationHours) : '')
        setDurationMode(existing.durationHours != null ? 'HOURS' : 'PERIOD')
      } else {
        setMode('ABSENCE')
        setSelectedTypeId(existing.leaveTypeId ?? existing.leaveType?.id ?? null)
        setDurationHours(existing.durationHours != null ? String(existing.durationHours) : '')
        setDurationMode('PERIOD')
      }
    }

    loadPage()
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editId, editSource, isEditing])

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

  const singleDaySelected = Boolean(
    selection.startDate && selection.endDate && selection.startDate === selection.endDate,
  )
  const directorHoursMode = mode === 'LEAVE' && durationMode === 'HOURS'
  const absenceHoursOnly = Boolean(
    mode === 'ABSENCE' &&
      selectedType?.allowsHours &&
      !selectedType?.allowsDays &&
      !selectedType?.allowsHalfDays,
  )
  const hoursOnly = directorHoursMode || absenceHoursOnly
  const halfDaysAllowed = Boolean(selectedType?.allowsHalfDays) && !hoursOnly

  useEffect(() => {
    if (!selectedType || halfDaysAllowed || hoursOnly) return
    setSelection((current) => ({
      ...current,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    }))
  }, [halfDaysAllowed, hoursOnly, selectedType])

  const preferredDirectorLeaveType = useMemo(
    () => leaveTypes.find(isReservedDirectorLeaveType) ?? null,
    [leaveTypes],
  )

  const handlePick = (iso) => {
    if (hoursOnly) {
      setSelection((current) => ({
        ...current,
        startDate: iso,
        endDate: iso,
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
      }))
      return
    }

    setSelection((current) => selectLeaveDate(current, iso))
  }

  const chooseDurationMode = (nextMode) => {
    if (nextMode === 'HOURS' && !singleDaySelected) return
    setDurationMode(nextMode)
    if (nextMode === 'HOURS') {
      setSelection((current) => ({
        ...current,
        endDate: current.startDate,
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
      }))
    } else {
      setDurationHours('')
    }
  }

  const handleBoundaryPeriodChange = (change) => {
    setSelection((current) => changeLeaveBoundaryPeriod(current, change))
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
      return mode === 'LEAVE'
        ? 'Le type « Congé » réservé au Directeur est indisponible. Vérifiez son paramétrage.'
        : 'Aucun type d’absence utilisable n’est disponible pour enregistrer l’indisponibilité.'
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
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return mode === 'LEAVE' ? 'Indiquez une durée comprise entre 0,25 et 24 heures.' : 'Indiquez la durée de l’absence en heures.'
    }
    return null
  }, [durationHours, hoursOnly, mode, selectedType, selection])

  const resetForm = () => {
    setMode('LEAVE')
    setSelectedTypeId(preferredDirectorLeaveType?.id ?? null)
    setSelection({
      startDate: null,
      endDate: null,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    })
    setComment('')
    setDurationHours('')
    setDurationMode('PERIOD')
    setAbsenceDraft(null)
  }

  const handleSave = async () => {
    if (validationError) {
      showToast('error', validationError)
      return
    }

    setSaving(true)
    try {
      if (isEditing) {
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
                ...(mode === 'LEAVE' ? { durationHours: null } : {}),
              }),
        }

        if (editSource === 'leave') {
          await updateDirectorLeaveRequest(editId, payload)
        } else {
          await updateDirectorAbsence(editId, payload)
        }

        notifyAppDataChanged()
        navigate('/app/director-unavailability')
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
              ...(mode === 'LEAVE' ? { durationHours: null } : {}),
            }),
      }

      if (mode === 'LEAVE') {
        await createDirectorLeaveRequest(payload)
      } else {
        const draft = absenceDraft
          ? await updateAbsenceDeclaration(absenceDraft.id, payload)
          : await createAbsenceDeclaration(payload)
        setAbsenceDraft(draft)
        await submitAbsenceDeclaration(draft.id, { certifiedAccurate: true })
      }

      notifyAppDataChanged()
      resetForm()
      showToast('success', 'Votre indisponibilité a été enregistrée directement.')
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
          <p>Les paramètres nécessaires à l’enregistrement de votre indisponibilité sont momentanément indisponibles.</p>
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
                <h2>{isEditing ? 'Je modifie mon indisponibilité' : "J'enregistre mon indisponibilité"}</h2>
              </div>
            </div>

            <div className="director-availability-single-mode" aria-label="Nature de l'enregistrement">
              <span className="director-availability-mode__icon director-availability-mode__icon--absence">
                <Icon name="calendar" size={21} />
              </span>
              <span>
                <strong>Indisponibilité</strong>
                <small>Enregistrement direct de votre période d’indisponibilité</small>
              </span>
              <i><Icon name="check" size={13} /></i>
            </div>
          </section>

          {mode === 'LEAVE' && singleDaySelected && (
            <section className="director-availability-card director-availability-duration-card">
              <div className="director-availability-duration-heading">
                <span>Durée de l’indisponibilité</span>
                <small>Pour une journée sélectionnée, choisissez une journée/demi-journée ou indiquez un nombre d’heures.</small>
              </div>
              <div className="director-availability-duration-choice" role="group" aria-label="Mode de durée">
                <button type="button" className={durationMode === 'PERIOD' ? 'is-active' : ''} onClick={() => chooseDurationMode('PERIOD')}>
                  <Icon name="calendar" size={16} /> Journée / demi-journée
                </button>
                <button type="button" className={durationMode === 'HOURS' ? 'is-active' : ''} onClick={() => chooseDurationMode('HOURS')}>
                  <Icon name="clock" size={16} /> Nombre d’heures
                </button>
              </div>
              {directorHoursMode && (
                <label className="director-availability-field director-availability-hours-field">
                  <span>Nombre d’heures</span>
                  <div className="director-availability-hours">
                    <input type="number" min="0.25" max="24" step="0.25" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} placeholder="Ex. 2,5" />
                    <span>heures</span>
                  </div>
                </label>
              )}
            </section>
          )}

          {mode === 'ABSENCE' && absenceHoursOnly && (
            <section className="director-availability-card director-availability-duration-card">
              <label className="director-availability-field">
                <span>Durée de l’absence</span>
                <div className="director-availability-hours">
                  <input type="number" min="0.25" max="744" step="0.25" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} placeholder="Ex. 2" />
                  <span>heures</span>
                </div>
              </label>
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
                <span><small>Type</small><strong>Indisponibilité</strong></span>
                <span><small>Date</small><strong>{formatDateFR(selection.startDate)}{hoursOnly ? '' : ` · ${periodLabel(selection.startPeriod)}`}</strong></span>
                <span><small>Fin</small><strong>{hoursOnly ? 'Même journée' : `${formatDateFR(selection.endDate)} · ${periodLabel(selection.endPeriod)}`}</strong></span>
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
                <><span className="director-availability-spinner" /> {isEditing ? 'Modification…' : 'Enregistrement…'}</>
              ) : (
                <><Icon name="check" size={18} /> {isEditing ? 'Enregistrer les modifications' : 'Enregistrer'}</>
              )}
            </button>
            <p className="director-availability-certification">
              {isEditing ? 'Les RH et Responsables de service seront informés de cette modification.' : 'En enregistrant cette indisponibilité, vous certifiez l’exactitude des informations saisies.'}
            </p>
          </section>
        </div>

        <div className="director-availability-right">
          <section className="director-availability-card director-availability-calendar-card">
            <div className="director-availability-calendar-heading">
              <span>
                <strong>Sélectionnez votre période</strong>
                <small>Un clic sélectionne une journée ; cliquez sur une autre date pour étendre la période.</small>
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
                allowsHalfDays={halfDaysAllowed}
                onBoundaryPeriodChange={handleBoundaryPeriodChange}
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
