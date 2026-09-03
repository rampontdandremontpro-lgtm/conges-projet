import { useEffect, useMemo, useState } from 'react'

import { LeaveCalendar } from '@/components/collab/new-request/LeaveCalendar'
import { Icon } from '@/components/ui/Icon'
import {
  createRhAbsenceDraft,
  registerRhAbsence,
  submitRhAbsence,
  updateRhAbsence,
  uploadRhAbsenceDocument,
} from '@/services/rh/rhAbsences'
import { createRhDirectLeave } from '@/services/rh/rhLeavesAndAbsences'
import { getHolidays } from '@/services/leaveRequests'
import { todayISO } from '@/utils/format'
import { changeLeaveBoundaryPeriod, selectLeaveDate } from '@/utils/leaveDateSelection'
import { isReservedDirectorLeaveType } from '@/utils/filterOptions'

import '@/styles/collab/new-request/01-page-types-calendar.css'
import '@/styles/rh/leave-absence-declaration.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

function fullName(user) {
  return `${user?.nom ?? ''} ${user?.prenom ?? ''}`.trim() || '—'
}

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function modeOptions(type) {
  if (!type) return []
  const result = []
  if (type.allowsDays) result.push({ id: 'days', label: 'Jours' })
  if (type.allowsHalfDays) result.push({ id: 'half-day', label: 'Demi-journée' })
  if (type.allowsHours) result.push({ id: 'hours', label: 'Heures' })
  return result
}

function defaultMode(type) {
  return modeOptions(type)[0]?.id ?? 'days'
}

function currentMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function shiftMonth(value, delta) {
  const date = new Date(Date.UTC(value.year, value.month + delta, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

function monthFromIso(iso) {
  if (!iso) return currentMonth()
  const [year, month] = String(iso).slice(0, 10).split('-').map(Number)
  if (!year || !month) return currentMonth()
  return { year, month: month - 1 }
}

function selectedTypeToken(category, id) {
  return `${category}:${id}`
}

function buildInitialForm(employees, editingDeclaration) {
  if (!editingDeclaration) {
    return {
      employeeId: employees[0]?.id ? String(employees[0].id) : '',
      typeToken: '',
      startDate: null,
      endDate: null,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
      mode: 'days',
      halfDayPeriod: 'MATIN',
      durationHours: '',
      comment: '',
      file: null,
    }
  }

  const declaration = editingDeclaration
  const hours = declaration.durationHours
  const mode = hours !== null && hours !== undefined
    ? 'hours'
    : declaration.startPeriod && declaration.startPeriod === declaration.endPeriod
      ? 'half-day'
      : 'days'

  return {
    employeeId: declaration.employeeId != null ? String(declaration.employeeId) : '',
    typeToken: selectedTypeToken('ABSENCE', declaration.leaveTypeId ?? declaration.leaveType?.id ?? ''),
    startDate: declaration.startDate ?? null,
    endDate: declaration.endDate ?? null,
    startPeriod: declaration.startPeriod ?? 'MATIN',
    endPeriod: declaration.endPeriod ?? 'APRES_MIDI',
    mode,
    halfDayPeriod: declaration.startPeriod ?? 'MATIN',
    durationHours: hours !== null && hours !== undefined ? String(hours) : '',
    comment: declaration.comment ?? '',
    file: null,
  }
}

export function RhLeaveAbsenceDeclarationDrawer({
  employees,
  leaveTypes,
  absenceTypes,
  editingDeclaration,
  onClose,
  onSaved,
}) {
  const isEditing = Boolean(editingDeclaration)
  const [form, setForm] = useState(() => buildInitialForm(employees, editingDeclaration))
  const [month, setMonth] = useState(() => (editingDeclaration?.startDate ? monthFromIso(editingDeclaration.startDate) : currentMonth()))
  const [holidays, setHolidays] = useState([])
  const [loadedHolidayYears, setLoadedHolidayYears] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const allTypes = useMemo(() => [
    ...(leaveTypes ?? []).filter((type) => !isReservedDirectorLeaveType(type)).map((type) => ({ ...type, declarationCategory: 'CONGE' })),
    ...(absenceTypes ?? []).map((type) => ({ ...type, declarationCategory: 'ABSENCE' })),
  ], [absenceTypes, leaveTypes])

  const selectedType = useMemo(
    () => allTypes.find((type) => selectedTypeToken(type.declarationCategory, type.id) === form.typeToken) ?? null,
    [allTypes, form.typeToken],
  )
  const isLeave = selectedType?.declarationCategory === 'CONGE'
  const isAbsence = selectedType?.declarationCategory === 'ABSENCE'
  const selectedEmployee = useMemo(
    () => employees.find((employee) => Number(employee.id) === Number(form.employeeId)) ?? null,
    [employees, form.employeeId],
  )
  const units = useMemo(() => modeOptions(selectedType), [selectedType])

  useEffect(() => {
    const year = month.year
    if (loadedHolidayYears.has(year)) return undefined
    let cancelled = false
    getHolidays(year)
      .then((items) => {
        if (cancelled) return
        setHolidays((current) => {
          const map = new Map(current.map((item) => [String(item.date).slice(0, 10), item]))
          items.forEach((item) => map.set(String(item.date).slice(0, 10), item))
          return [...map.values()]
        })
        setLoadedHolidayYears((current) => new Set([...current, year]))
      })
      .catch(() => {
        if (!cancelled) setLoadedHolidayYears((current) => new Set([...current, year]))
      })
    return () => { cancelled = true }
  }, [loadedHolidayYears, month.year])

  const changeType = (token) => {
    const next = allTypes.find((type) => selectedTypeToken(type.declarationCategory, type.id) === token) ?? null
    setError('')
    setForm((current) => ({
      ...current,
      employeeId: next?.declarationCategory === 'CONGE' && employees.find((employee) => Number(employee.id) === Number(current.employeeId))?.role !== 'COLLABORATEUR'
        ? String(employees.find((employee) => employee.role === 'COLLABORATEUR')?.id ?? '')
        : current.employeeId,
      typeToken: token,
      startDate: null,
      endDate: null,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
      mode: next?.declarationCategory === 'ABSENCE' ? defaultMode(next) : 'days',
      halfDayPeriod: 'MATIN',
      durationHours: '',
      comment: '',
      file: null,
    }))
    setMonth(currentMonth())
  }

  const handleLeavePick = (iso) => {
    setForm((previous) => selectLeaveDate(previous, iso))
  }

  const handleLeaveBoundary = (change) => {
    setForm((previous) => changeLeaveBoundaryPeriod(previous, change))
  }

  const handleAbsencePick = (iso) => {
    if (form.mode !== 'days') {
      setForm((current) => ({ ...current, startDate: iso, endDate: iso }))
      return
    }
    setForm((current) => {
      if (!current.startDate) return { ...current, startDate: iso, endDate: iso }
      if (current.startDate === current.endDate) {
        if (iso === current.startDate) return current
        return iso < current.startDate
          ? { ...current, startDate: iso, endDate: current.startDate }
          : { ...current, endDate: iso }
      }
      return { ...current, startDate: iso, endDate: iso }
    })
  }

  const changeMode = (mode) => {
    setForm((current) => ({
      ...current,
      mode,
      endDate: current.startDate,
      durationHours: '',
      halfDayPeriod: 'MATIN',
    }))
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0] ?? null
    if (!file) return setForm((current) => ({ ...current, file: null }))
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

  const validate = () => {
    if (!form.employeeId) return 'Sélectionnez un collaborateur.'
    if (!selectedType) return 'Sélectionnez un type.'
    if (!form.startDate) return 'Sélectionnez une date dans le calendrier.'
    if (!form.endDate) return 'Sélectionnez une date de fin.'
    if (form.endDate < form.startDate) return 'La date de fin doit être postérieure ou égale à la date de début.'
    if (isAbsence && form.mode === 'hours') {
      const hours = Number(form.durationHours)
      if (!Number.isFinite(hours) || hours <= 0) return 'Indiquez une durée en heures.'
    }
    if (!isEditing && isAbsence && selectedType.documentRequired && !selectedType.documentCanBeAddedLater && !form.file) {
      return 'Un justificatif est obligatoire pour ce type d’absence.'
    }
    return null
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
      if (isEditing) {
        const payload = {
          leaveTypeId: Number(selectedType.id),
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
        await updateRhAbsence(editingDeclaration.id, payload)
        onSaved(`L’absence de ${fullName(selectedEmployee)} a été modifiée.`)
        return
      }

      if (isLeave) {
        await createRhDirectLeave({
          employeeId: Number(form.employeeId),
          leaveTypeId: Number(selectedType.id),
          startDate: form.startDate,
          endDate: form.endDate,
          startPeriod: form.startPeriod,
          endPeriod: form.endPeriod,
        })
        onSaved(`Congé déclaré et validé pour ${fullName(selectedEmployee)}.`)
        return
      }

      const payload = {
        employeeId: Number(form.employeeId),
        leaveTypeId: Number(selectedType.id),
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
      if (form.file) await uploadRhAbsenceDocument(draft.id, form.file)
      let declaration = await submitRhAbsence(draft.id)
      if (declaration.status === 'A_VERIFIER_PAR_RH' && !selectedType.documentRequired) {
        declaration = await registerRhAbsence(declaration.id)
      }
      const needsReview = selectedType.documentRequired && declaration.status !== 'ENREGISTREE'
      onSaved(needsReview
        ? `Absence déclarée pour ${fullName(selectedEmployee)}. Le justificatif doit être vérifié avant l’autorisation.`
        : `Absence enregistrée pour ${fullName(selectedEmployee)}.`)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const selection = {
    startDate: form.startDate,
    endDate: form.endDate,
    startPeriod: form.startPeriod,
    endPeriod: form.endPeriod,
  }

  return (
    <div className="rh-declaration-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="rh-declaration-drawer" role="dialog" aria-modal="true" aria-labelledby="rh-declaration-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="rh-declaration-head">
          <div>
            <span>GESTION RH</span>
            <h2 id="rh-declaration-title">{isEditing ? 'Modifier l’absence' : 'Déclarer congés/absences'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <form className="rh-declaration-form" onSubmit={handleSubmit}>
          {error && <div className="rh-declaration-error"><Icon name="alert" size={17} /><span>{error}</span></div>}

          <div className="rh-declaration-top-grid">
            <label>
              <span>Collaborateur</span>
              <select value={form.employeeId} disabled={isEditing} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}>
                <option value="">Sélectionner un collaborateur</option>
                {employees.filter((employee) => !isLeave || employee.role === 'COLLABORATEUR').map((employee) => <option key={employee.id} value={employee.id}>{fullName(employee)} — {employee.service?.name ?? 'Sans service'}</option>)}
              </select>
            </label>
            <label>
              <span>Type</span>
              <select value={form.typeToken} disabled={isEditing} onChange={(event) => changeType(event.target.value)}>
                <option value="">Sélectionner un type</option>
                <optgroup label="Congés">
                  {leaveTypes.filter((type) => !isReservedDirectorLeaveType(type)).map((type) => <option key={`leave-${type.id}`} value={selectedTypeToken('CONGE', type.id)}>{type.name}</option>)}
                </optgroup>
                <optgroup label="Absences">
                  {absenceTypes.map((type) => <option key={`absence-${type.id}`} value={selectedTypeToken('ABSENCE', type.id)}>{type.name}</option>)}
                </optgroup>
              </select>
            </label>
          </div>

          {!selectedType && (
            <div className="rh-declaration-placeholder">
              <span><Icon name="calendar" size={24} /></span>
              <strong>Sélectionnez un type</strong>
              <p>Le formulaire et le calendrier s’adapteront automatiquement au congé ou à l’absence choisi.</p>
            </div>
          )}

          {isLeave && (
            <section className="rh-declaration-section">
              <div className="rh-declaration-section__title">
                <div><span>CONGÉ</span><h3>Sélectionner la période</h3></div>
              </div>
              <div className="rh-declaration-calendar nr-page">
                <LeaveCalendar
                  months={[month]}
                  todayIso={todayISO()}
                  selection={selection}
                  holidays={holidays}
                  onPick={handleLeavePick}
                  onPrev={() => setMonth((current) => shiftMonth(current, -1))}
                  onNext={() => setMonth((current) => shiftMonth(current, 1))}
                  allowsHalfDays={Boolean(selectedType.allowsHalfDays)}
                  onBoundaryPeriodChange={handleLeaveBoundary}
                />
              </div>
            </section>
          )}

          {isAbsence && (
            <section className="rh-declaration-section">
              <div className="rh-declaration-section__title">
                <div><span>ABSENCE</span><h3>Format de saisie</h3></div>
              </div>

              <div className="rh-declaration-units" role="group" aria-label="Format de saisie">
                {units.map((unit) => (
                  <button key={unit.id} type="button" className={form.mode === unit.id ? 'is-active' : ''} onClick={() => changeMode(unit.id)}>
                    <Icon name={unit.id === 'hours' ? 'clock' : 'calendar'} size={16} /> {unit.label}
                  </button>
                ))}
              </div>

              <div className="rh-declaration-calendar nr-page">
                <LeaveCalendar
                  months={[month]}
                  todayIso={todayISO()}
                  selection={selection}
                  holidays={holidays}
                  onPick={handleAbsencePick}
                  onPrev={() => setMonth((current) => shiftMonth(current, -1))}
                  onNext={() => setMonth((current) => shiftMonth(current, 1))}
                  allowsHalfDays={false}
                  blockNonDeductibleDates={false}
                  singleSelection={form.mode !== 'days'}
                />
              </div>

              {form.mode === 'half-day' && form.startDate && (
                <fieldset className="rh-declaration-half-day">
                  <legend>Demi-journée sélectionnée</legend>
                  <div>
                    <button type="button" className={form.halfDayPeriod === 'MATIN' ? 'is-active' : ''} onClick={() => setForm((current) => ({ ...current, halfDayPeriod: 'MATIN' }))}>Matin</button>
                    <button type="button" className={form.halfDayPeriod === 'APRES_MIDI' ? 'is-active' : ''} onClick={() => setForm((current) => ({ ...current, halfDayPeriod: 'APRES_MIDI' }))}>Après-midi</button>
                  </div>
                </fieldset>
              )}

              {form.mode === 'hours' && form.startDate && (
                <label className="rh-declaration-field">
                  <span>Durée en heures</span>
                  <input type="number" min="0.25" max="744" step="0.25" value={form.durationHours} placeholder="Ex. 2,5" onChange={(event) => setForm((current) => ({ ...current, durationHours: event.target.value }))} />
                </label>
              )}

              <label className="rh-declaration-field">
                <span>Commentaire <small>(optionnel)</small></span>
                <textarea rows="3" maxLength={1000} value={form.comment} placeholder="Informations complémentaires…" onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} />
              </label>

              {selectedType.documentRequired && !isEditing && (
                <label className="rh-declaration-upload">
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={handleFile} />
                  <span><Icon name="file" size={18} /></span>
                  <div><strong>{form.file ? form.file.name : 'Ajouter un justificatif'}</strong><small>PDF, JPG ou PNG — 10 Mo maximum{selectedType.documentCanBeAddedLater ? ' · peut être ajouté ultérieurement' : ''}</small></div>
                </label>
              )}
            </section>
          )}

          {selectedType && (
            <footer className="rh-declaration-actions">
              <button type="button" onClick={onClose}>Annuler</button>
              <button type="submit" className="is-primary" disabled={saving || !form.startDate}>
                <Icon name="check" size={17} />
                {saving ? 'Validation…' : isEditing ? 'Enregistrer les modifications' : isLeave ? 'Valider le congé' : 'Valider l’absence'}
              </button>
            </footer>
          )}
        </form>
      </aside>
    </div>
  )
}
