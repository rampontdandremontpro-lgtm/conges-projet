import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  getRhSummerPeriodConfiguration,
  updateRhSummerPeriodConfiguration,
} from '@/services/rh/rhSummerPeriod'
import '@/styles/rh/summer-period.css'

const SLIDER_MIN = 0
const SLIDER_MAX = 90

const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function numberSetting(settings, key, fallback) {
  const value = Number(settings?.[key])
  return Number.isFinite(value) ? value : fallback
}

function monthDayToIso(monthDay, year) {
  const [month, day] = String(monthDay ?? '').split('-')
  if (!month || !day) return `${year}-05-01`
  return `${year}-${month}-${day}`
}

function isoToMonthDay(value) {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}-${match[2]}` : ''
}

function parseLocalIso(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLongDate(value) {
  const date = parseLocalIso(value)
  if (!date) return '—'

  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`
}

function periodStatus(startIso, endIso, today = new Date()) {
  const start = parseLocalIso(startIso)
  const end = parseLocalIso(endIso)
  if (!start || !end) return { label: 'À configurer', tone: 'neutral', progress: 0 }

  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startTime = start.getTime()
  const endTime = end.getTime()
  const currentTime = current.getTime()

  if (currentTime < startTime) {
    return { label: 'À venir', tone: 'upcoming', progress: 0 }
  }

  if (currentTime > endTime) {
    return { label: 'Terminée', tone: 'finished', progress: 100 }
  }

  const duration = Math.max(1, endTime - startTime)
  const progress = Math.min(100, Math.max(0, ((currentTime - startTime) / duration) * 100))

  return { label: 'En cours', tone: 'active', progress }
}

function loadStateToForm(payload, year) {
  const settings = payload?.settings ?? {}
  const seasonal = payload?.seasonal ?? {}

  return {
    startDate: monthDayToIso(seasonal.summerPeriodStart ?? '05-01', year),
    endDate: monthDayToIso(seasonal.summerPeriodEnd ?? '10-31', year),
    specialDeadlineDays: numberSetting(settings, 'SPECIAL_REQUEST_DEADLINE_DAYS', 60),
    normalDeadlineDays: numberSetting(settings, 'NORMAL_REQUEST_DEADLINE_DAYS', 30),
    longLeaveThreshold: numberSetting(settings, 'SPECIAL_DURATION_THRESHOLD_DAYS', 21),
  }
}

export function RhSummerPeriodPage() {
  const year = new Date().getFullYear()
  const [state, setState] = useState({ loading: true, error: null, payload: null })
  const [form, setForm] = useState({
    startDate: `${year}-05-01`,
    endDate: `${year}-10-31`,
    specialDeadlineDays: 60,
    normalDeadlineDays: 30,
    longLeaveThreshold: 21,
  })
  const [savedForm, setSavedForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))

    try {
      const payload = await getRhSummerPeriodConfiguration()
      const nextForm = loadStateToForm(payload, year)
      setState({ loading: false, error: null, payload })
      setForm(nextForm)
      setSavedForm(nextForm)
    } catch (error) {
      setState({
        loading: false,
        error: error?.response?.data?.message ?? 'Impossible de charger les paramètres de la période estivale.',
        payload: null,
      })
    }
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const settings = state.payload?.settings ?? {}
  const normalDeadlineDays = form.normalDeadlineDays
  const longLeaveThreshold = form.longLeaveThreshold
  const sliderMin = SLIDER_MIN

  const status = useMemo(
    () => periodStatus(form.startDate, form.endDate),
    [form.endDate, form.startDate],
  )

  const sliderProgress = useMemo(
    () => ((form.specialDeadlineDays - sliderMin) / (SLIDER_MAX - sliderMin)) * 100,
    [form.specialDeadlineDays, sliderMin],
  )

  const isDirty = useMemo(() => {
    if (!savedForm) return false
    return (
      form.startDate !== savedForm.startDate ||
      form.endDate !== savedForm.endDate ||
      form.specialDeadlineDays !== savedForm.specialDeadlineDays ||
      form.normalDeadlineDays !== savedForm.normalDeadlineDays ||
      form.longLeaveThreshold !== savedForm.longLeaveThreshold
    )
  }, [form, savedForm])

  const datesAreValid = useMemo(() => {
    const start = parseLocalIso(form.startDate)
    const end = parseLocalIso(form.endDate)
    return Boolean(start && end && start.getTime() <= end.getTime())
  }, [form.endDate, form.startDate])

  const handleReset = () => {
    if (!savedForm) return
    setForm(savedForm)
    setFeedback(null)
  }

  const handleSave = async () => {
    if (!datesAreValid || saving) return

    setSaving(true)
    setFeedback(null)

    try {
      const payload = await updateRhSummerPeriodConfiguration({
        summerPeriodStart: isoToMonthDay(form.startDate),
        summerPeriodEnd: isoToMonthDay(form.endDate),
        specialDeadlineDays: form.specialDeadlineDays,
        normalDeadlineDays: form.normalDeadlineDays,
        longLeaveThreshold: form.longLeaveThreshold,
      })
      const nextForm = loadStateToForm(payload, year)
      setState({ loading: false, error: null, payload })
      setForm(nextForm)
      setSavedForm(nextForm)
      setFeedback({ kind: 'success', message: 'Paramètres de la période estivale enregistrés.' })
      window.dispatchEvent(new CustomEvent('gmes:data-changed'))
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error?.response?.data?.message ?? 'Impossible d’enregistrer les paramètres.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (state.loading) {
    return (
      <main className="page-container rh-summer-period-page">
        <div className="rh-summer-period-skeleton" aria-label="Chargement de la période estivale">
          <span />
          <span />
          <span />
        </div>
      </main>
    )
  }

  if (state.error) {
    return (
      <main className="page-container rh-summer-period-page">
        <section className="rh-summer-period-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger la période estivale</strong>
          <span>{state.error}</span>
          <button type="button" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container rh-summer-period-page">
      {feedback && (
        <div className={`rh-summer-period-feedback rh-summer-period-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="rh-summer-period-card">
        <div className="rh-summer-period-hero">
          <div className="rh-summer-period-hero__top">
            <div className="rh-summer-period-hero__title">
              <span className="rh-summer-period-hero__icon"><Icon name="sun" size={24} /></span>
              <div>
                <small>Période estivale {year}</small>
                <h2>{formatLongDate(form.startDate)} → {formatLongDate(form.endDate)}</h2>
              </div>
            </div>
            <span className={`rh-summer-period-status rh-summer-period-status--${status.tone}`}>
              {status.label}
            </span>
          </div>

          <div className="rh-summer-period-date-fields">
            <label>
              <span>Date de début</span>
              <input
                type="date"
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                value={form.startDate}
                onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>
            <label>
              <span>Date de fin</span>
              <input
                type="date"
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                value={form.endDate}
                onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
              />
            </label>
          </div>

          <div className="rh-summer-period-progress">
            <div className="rh-summer-period-progress__labels">
              <span>{formatLongDate(form.startDate)}</span>
              <span>{formatLongDate(form.endDate)}</span>
            </div>
            <div className="rh-summer-period-progress__track" aria-hidden="true">
              <span
                key={`${form.startDate}-${form.endDate}-${status.progress}`}
                className="rh-summer-period-progress__fill"
                style={{ '--summer-progress': `${status.progress}%` }}
              />
              {status.tone === 'active' && (
                <span className="rh-summer-period-progress__today" style={{ left: `${status.progress}%` }}>
                  <i />
                  <em>Aujourd’hui</em>
                </span>
              )}
            </div>
            <div className="rh-summer-period-progress__caption">
              {status.tone === 'active' && 'Période estivale en cours'}
              {status.tone === 'upcoming' && 'La période estivale n’a pas encore commencé'}
              {status.tone === 'finished' && 'Période estivale terminée'}
            </div>
          </div>
        </div>

        {!datesAreValid && (
          <div className="rh-summer-period-inline-error">
            <Icon name="alert" size={16} />
            La date de fin doit être postérieure ou égale à la date de début.
          </div>
        )}

        <div className="rh-summer-period-rules">
          <section className="rh-summer-period-delay-card">
            <div className="rh-summer-period-section-title">
              <span><Icon name="clock" size={20} /></span>
              <div>
                <h3>Délai de prévenance étendu</h3>
              </div>
            </div>

            <div className="rh-summer-period-delay-value">
              <strong>{form.specialDeadlineDays}</strong>
              <div>
                <span>jours calendaires</span>
                <small>au lieu de {normalDeadlineDays} jours habituellement</small>
              </div>
            </div>

            <div className="rh-summer-period-range-wrap">
              <input
                className="rh-summer-period-range"
                type="range"
                min={sliderMin}
                max={SLIDER_MAX}
                step="1"
                value={form.specialDeadlineDays}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  specialDeadlineDays: Number(event.target.value),
                }))}
                style={{ '--range-progress': `${sliderProgress}%` }}
                aria-label="Délai de prévenance étendu"
              />
              <div className="rh-summer-period-range-labels">
                <span>{sliderMin} j</span>
                <span>{SLIDER_MAX} j</span>
              </div>
            </div>
          </section>

          <section className="rh-summer-period-info-card">
            <div className="rh-summer-period-section-title rh-summer-period-section-title--orange">
              <span><Icon name="info" size={20} /></span>
              <div>
                <h3>Fonctionnement de la période estivale</h3>
                <p>Les règles sont utilisées automatiquement lors de la préparation d’une demande.</p>
              </div>
            </div>

            <ul>
              <li>Toute demande qui chevauche la période du <b>{formatLongDate(form.startDate)}</b> au <b>{formatLongDate(form.endDate)}</b> doit respecter un délai de <b>{form.specialDeadlineDays} jours</b>.</li>
              <li>Le même délai étendu s’applique aux congés d’au moins <b>{longLeaveThreshold} jours calendaires</b>, même hors période estivale.</li>
              <li>Le délai standard reste fixé à <b>{normalDeadlineDays} jours</b> lorsque la demande n’entre dans aucun de ces cas.</li>
              <li>Lorsque le délai de prévenance n’est pas respecté, une dérogation peut être demandée jusqu’au début du congé.</li>
            </ul>
          </section>
        </div>

        <div className="rh-summer-period-kpis rh-summer-period-kpis--editable">
          <article>
            <label>
              <span>Délai standard</span>
              <div><input type="number" min="0" max="90" value={form.normalDeadlineDays} onChange={(event) => setForm((current) => ({ ...current, normalDeadlineDays: Math.max(0, Math.min(90, Number(event.target.value) || 0)) }))} /><b>j</b></div>
              <small>hors règle spéciale</small>
            </label>
          </article>
          <article>
            <label>
              <span>Congé long</span>
              <div><input type="number" min="1" max="90" value={form.longLeaveThreshold} onChange={(event) => setForm((current) => ({ ...current, longLeaveThreshold: Math.max(1, Math.min(90, Number(event.target.value) || 1)) }))} /><b>j</b></div>
              <small>déclenche le délai étendu</small>
            </label>
          </article>
        </div>

        <div className="rh-summer-period-actions">
          <button
            type="button"
            className="rh-summer-period-save"
            onClick={handleSave}
            disabled={!isDirty || !datesAreValid || saving}
          >
            <Icon name="check" size={17} />
            {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
          </button>
          <button
            type="button"
            className="rh-summer-period-reset"
            onClick={handleReset}
            disabled={!isDirty || saving}
          >
            <Icon name="refresh" size={16} />
            Réinitialiser
          </button>
        </div>
      </section>
    </main>
  )
}