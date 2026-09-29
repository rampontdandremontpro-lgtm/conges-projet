import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { LeaveCalendar } from '@/components/collab/new-request/LeaveCalendar'
import { LeaveTypeSelector } from '@/components/collab/new-request/LeaveTypeSelector'
import { HalfDaySelector } from '@/components/collab/new-request/HalfDaySelector'
import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { Toast } from '@/components/ui/Toast'
import {
  createAbsenceDeclaration,
  getCollaboratorAbsenceTypes,
} from '@/services/absenceDeclarations'
import { getHolidays } from '@/services/leaveRequests'
import {
  changeLeaveBoundaryPeriod,
  selectLeaveDate,
} from '@/utils/leaveDateSelection'
import {
  currentMonth,
  errorMessage,
  nextMonthOf,
  prevMonthOf,
} from '@/utils/newRequest'
import { todayISO } from '@/utils/format'
import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/collab/new-request/index.css'

export function NewAbsencePage() {
  const navigate = useNavigate()
  const today = todayISO()

  const [types, setTypes] = useState([])
  const [selectedTypeId, setSelectedTypeId] = useState(null)
  const [months, setMonths] = useState(() => {
    const first = currentMonth()
    return [first, nextMonthOf(first)]
  })
  const [holidays, setHolidays] = useState([])
  const [loadedYears, setLoadedYears] = useState(() => new Set())
  const [selection, setSelection] = useState({
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  })
  const [durationMode, setDurationMode] = useState('PERIOD')
  const [durationHours, setDurationHours] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let cancelled = false

    getCollaboratorAbsenceTypes()
      .then((data) => {
        if (cancelled) return
        setTypes(data ?? [])
        setSelectedTypeId((current) => current ?? data?.[0]?.id ?? null)
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
  }, [reloadKey])

  useEffect(() => {
    let cancelled = false
    const years = new Set(months.map((month) => month.year))
    const missing = [...years].filter((year) => !loadedYears.has(year))
    if (missing.length === 0) return undefined

    Promise.all(missing.map((year) => getHolidays(year)))
      .then((results) => {
        if (cancelled) return
        setHolidays((current) => [...current, ...results.flat()])
        setLoadedYears((current) => {
          const next = new Set(current)
          missing.forEach((year) => next.add(year))
          return next
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [months, loadedYears])

  const retry = () => {
    setLoading(true)
    setLoadError(false)
    setReloadKey((key) => key + 1)
  }

  const selectedType = useMemo(
    () => types.find((type) => type.id === selectedTypeId) ?? null,
    [selectedTypeId, types],
  )

  const canSave = Boolean(
    selectedTypeId &&
    selection.startDate &&
    selection.endDate &&
    !saving,
  )

  const handlePrev = () => {
    const first = prevMonthOf(months[0])
    setMonths([first, months[0]])
  }

  const handleNext = () => {
    const last = months[months.length - 1]
    setMonths([last, nextMonthOf(last)])
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        leaveTypeId: selectedTypeId,
        startDate: selection.startDate,
        endDate: selection.endDate,
        comment: comment.trim() || undefined,
      }
      if (durationMode === 'HOURS' && durationHours) {
        payload.durationHours = Number(durationHours)
      } else {
        payload.startPeriod = selection.startPeriod ?? 'MATIN'
        payload.endPeriod = selection.endPeriod ?? 'APRES_MIDI'
      }
      const saved = await createAbsenceDeclaration(payload)
      notifyAppDataChanged({ source: 'absence', action: 'draft-saved', id: saved.id })
      navigate('/app/my-requests', {
        replace: true,
        state: {
          flash: {
            kind: 'success',
            message: 'Brouillon d’absence enregistré.',
          },
        },
      })
    } catch (error) {
      setToast({ kind: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer className="nr-page">
      <button type="button" className="request-detail-back" onClick={() => navigate('/app/my-requests')}>
        <Icon name="chevronLeft" size={17} />
        Mes demandes
      </button>

      <header className="nr-page__header">
        <div>
          <h1>Déclarer une absence</h1>
          <p>Créez un brouillon que vous pourrez soumettre à la RH.</p>
        </div>
      </header>

      {loading ? (
        <div className="dash-card" aria-busy="true">Chargement…</div>
      ) : loadError ? (
        <div className="dash-card" role="alert">
          <strong>Impossible de charger les types d’absence.</strong>
          <div>
            <button type="button" onClick={retry}>Réessayer</button>
          </div>
        </div>
      ) : (
        <div className="nr-grid">
          <div className="nr-col nr-col--main">
            <LeaveTypeSelector
              leaveTypes={types}
              selectedId={selectedTypeId}
              onSelect={setSelectedTypeId}
            />

            <section className="nr-cal-card">
              <LeaveCalendar
                months={months}
                todayIso={today}
                selection={selection}
                holidays={holidays}
                allowsHalfDays
                onPick={(iso) => setSelection((current) => selectLeaveDate(current, iso))}
                onPrev={handlePrev}
                onNext={handleNext}
                onBoundaryPeriodChange={(change) =>
                  setSelection((current) => changeLeaveBoundaryPeriod(current, change))
                }
              />
            </section>

            <section className="nr-cal-card">
              <div className="nr-halfdays__heading" style={{ marginTop: 0 }}>
                Mode de saisie
              </div>
              <div className="nr-halfdays__pills">
                <button
                  type="button"
                  className={`nr-pill${durationMode === 'PERIOD' ? ' nr-pill--active' : ''}`}
                  onClick={() => setDurationMode('PERIOD')}
                >
                  Demi-journées
                </button>
                <button
                  type="button"
                  className={`nr-pill${durationMode === 'HOURS' ? ' nr-pill--active' : ''}`}
                  onClick={() => setDurationMode('HOURS')}
                >
                  Heures
                </button>
              </div>

              {durationMode === 'HOURS' ? (
                <div className="nr-halfdays__group" style={{ marginTop: 12 }}>
                  <span className="nr-halfdays__label">Durée en heures</span>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    max="744"
                    value={durationHours}
                    onChange={(event) => setDurationHours(event.target.value)}
                    placeholder="Ex. 4"
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', width: '100%', maxWidth: 200 }}
                  />
                </div>
              ) : (
                <HalfDaySelector
                  startPeriod={selection.startPeriod ?? 'MATIN'}
                  endPeriod={selection.endPeriod ?? 'APRES_MIDI'}
                  onStartChange={(value) =>
                    setSelection((current) =>
                      changeLeaveBoundaryPeriod(current, { boundary: 'start', value }),
                    )
                  }
                  onEndChange={(value) =>
                    setSelection((current) =>
                      changeLeaveBoundaryPeriod(current, { boundary: 'end', value }),
                    )
                  }
                />
              )}
            </section>

            <section className="nr-cal-card">
              <span className="nr-halfdays__label">Commentaire (optionnel)</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Informations complémentaires pour la RH."
                style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1' }}
              />
            </section>
          </div>

          <div className="nr-col nr-col--side">
            <section className="nr-recap">
              <div className="nr-recap__header">
                <h2>Récapitulatif</h2>
              </div>
              <div className="nr-recap__block">
                <span className="nr-recap__type">{selectedType ? selectedType.name : 'Aucun type sélectionné'}</span>
                <p className="nr-recap__period-line">
                  {selection.startDate ? `Du ${selection.startDate} au ${selection.endDate ?? '…'}` : 'Période non définie'}
                </p>
                {durationMode === 'HOURS' && durationHours ? (
                  <p className="nr-recap__halfday">{durationHours} h</p>
                ) : (
                  selection.startDate && selection.endDate && (
                    <p className="nr-recap__halfday">
                      {selection.startPeriod === 'APRES_MIDI' ? 'Après-midi' : 'Matin'} →{' '}
                      {selection.endPeriod === 'MATIN' ? 'Matin' : 'Après-midi'}
                    </p>
                  )
                )}
              </div>
              <div className="nr-recap__actions">
                <button
                  type="button"
                  className="nr-btn nr-btn--primary"
                  disabled={!canSave}
                  onClick={handleSave}
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {toast && <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
    </PageContainer>
  )
}
