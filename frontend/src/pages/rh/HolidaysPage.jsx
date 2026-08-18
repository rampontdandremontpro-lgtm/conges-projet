import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  createRhClosure,
  disableRhClosure,
  getRhHolidays,
  updateRhClosure,
} from '@/services/rhHolidays'
import '@/styles/rh/holidays.css'

const MARTINIQUE_TIME_ZONE = 'America/Martinique'
const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'official', label: 'Jours fériés' },
  { id: 'closures', label: 'Fermetures' },
]

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: MARTINIQUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`
}

function initialMonth() {
  return martiniqueToday().slice(0, 7)
}

function monthParts(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  return { year, monthNumber }
}

function shiftMonth(month, delta) {
  const { year, monthNumber } = monthParts(month)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function monthLabel(month) {
  const { year, monthNumber } = monthParts(month)
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`
}

function holidayCategory(holiday) {
  return holiday.holidayType === 'FERMETURE_GMES' ? 'closures' : 'official'
}

function holidayTypeLabel(holiday) {
  if (holiday.holidayType === 'FERMETURE_GMES') return 'Fermeture GMES'
  if (holiday.holidayType === 'MARTINIQUE') return 'Férié Martinique'
  return 'Jour férié national'
}

function calendarCells(month) {
  const { year, monthNumber } = monthParts(month)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const last = new Date(Date.UTC(year, monthNumber, 0))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const cells = []

  for (let index = 0; index < mondayOffset; index += 1) {
    cells.push(null)
  }

  for (let day = 1; day <= last.getUTCDate(); day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`)
  }

  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function HolidayBadge({ holiday }) {
  const category = holidayCategory(holiday)
  return (
    <span className={`rh-holidays-badge rh-holidays-badge--${category}`}>
      {holidayTypeLabel(holiday)}
    </span>
  )
}

export function RhHolidaysPage() {
  const [month, setMonth] = useState(initialMonth)
  const [filter, setFilter] = useState('all')
  const [state, setState] = useState({ loading: true, error: false, holidays: [] })
  const [drawer, setDrawer] = useState(null)
  const [form, setForm] = useState({ name: '', date: martiniqueToday() })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const year = Number(month.slice(0, 4))
  const today = martiniqueToday()

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: false }))
    try {
      const holidays = await getRhHolidays(year)
      setState({ loading: false, error: false, holidays })
    } catch {
      if (!silent) setState((current) => ({ ...current, loading: false, error: true }))
    }
  }, [year])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    const refresh = () => load({ silent: true })
    window.addEventListener('gmes:data-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('gmes:data-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 4200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const monthHolidays = useMemo(
    () => state.holidays.filter((holiday) => holiday.isActive !== false && holiday.date?.startsWith(month)),
    [month, state.holidays],
  )

  const counts = useMemo(() => ({
    all: monthHolidays.length,
    official: monthHolidays.filter((holiday) => holidayCategory(holiday) === 'official').length,
    closures: monthHolidays.filter((holiday) => holidayCategory(holiday) === 'closures').length,
  }), [monthHolidays])

  const visibleHolidays = useMemo(
    () => monthHolidays.filter((holiday) => filter === 'all' || holidayCategory(holiday) === filter),
    [filter, monthHolidays],
  )

  const holidaysByDate = useMemo(() => {
    const map = new Map()
    monthHolidays.forEach((holiday) => {
      const items = map.get(holiday.date) ?? []
      items.push(holiday)
      map.set(holiday.date, items)
    })
    return map
  }, [monthHolidays])

  const cells = useMemo(() => calendarCells(month), [month])

  const openCreate = (date = `${month}-01`) => {
    setForm({ name: '', date })
    setDrawer({ mode: 'create', holiday: null })
  }

  const openHoliday = (holiday) => {
    if (holiday.holidayType === 'FERMETURE_GMES') {
      setForm({ name: holiday.name, date: holiday.date })
      setDrawer({ mode: 'edit', holiday })
      return
    }
    setDrawer({ mode: 'official', holiday })
  }

  const closeDrawer = () => {
    if (saving) return
    setDrawer(null)
  }

  const submitClosure = async (event) => {
    event.preventDefault()
    const name = form.name.trim()
    if (name.length < 2 || !form.date) return

    setSaving(true)
    try {
      if (drawer?.mode === 'edit') {
        await updateRhClosure(drawer.holiday.id, { date: form.date, name })
        setFeedback('Fermeture mise à jour.')
      } else {
        await createRhClosure({ date: form.date, name })
        setFeedback('Fermeture ajoutée.')
      }
      setMonth(form.date.slice(0, 7))
      setDrawer(null)
      await load({ silent: true })
    } catch (error) {
      setFeedback(error?.response?.data?.message || 'Impossible d’enregistrer la fermeture.')
    } finally {
      setSaving(false)
    }
  }

  const removeClosure = async () => {
    if (!confirmDelete?.id) return
    setSaving(true)
    try {
      await disableRhClosure(confirmDelete.id)
      setFeedback('Fermeture supprimée du calendrier actif.')
      setConfirmDelete(null)
      if (drawer?.holiday?.id === confirmDelete.id) setDrawer(null)
      await load({ silent: true })
    } catch (error) {
      setFeedback(error?.response?.data?.message || 'Impossible de supprimer cette fermeture.')
    } finally {
      setSaving(false)
    }
  }

  const goToday = () => setMonth(today.slice(0, 7))

  return (
    <div className="page-container rh-holidays-page">
      {feedback && <div className="rh-holidays-feedback"><Icon name="info" size={16} />{feedback}</div>}

      <div className="rh-holidays-actions-bar">
        <button type="button" className="rh-holidays-add" onClick={() => openCreate()}>
          <Icon name="plus" size={18} /> Ajouter une fermeture
        </button>
      </div>

      <div className="rh-holidays-layout">
        <section className="rh-holidays-calendar-card">
          <div className="rh-holidays-calendar-head">
            <button type="button" aria-label="Mois précédent" onClick={() => setMonth((current) => shiftMonth(current, -1))}>
              <Icon name="chevronLeft" size={17} />
            </button>
            <div>
              <strong>{monthLabel(month)}</strong>
              <span>Calendrier des jours non ouvrés</span>
            </div>
            <button type="button" aria-label="Mois suivant" onClick={() => setMonth((current) => shiftMonth(current, 1))}>
              <Icon name="chevronRight" size={17} />
            </button>
          </div>

          <button type="button" className="rh-holidays-today" onClick={goToday}>Aujourd’hui</button>

          <div className="rh-holidays-weekdays">
            {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>

          <div className="rh-holidays-calendar-grid">
            {cells.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} className="rh-holidays-day is-empty" />
              const holidays = holidaysByDate.get(date) ?? []
              const hasClosure = holidays.some((holiday) => holiday.holidayType === 'FERMETURE_GMES')
              const hasOfficial = holidays.some((holiday) => holiday.holidayType !== 'FERMETURE_GMES')
              const classes = [
                'rh-holidays-day',
                hasOfficial ? 'is-official' : '',
                hasClosure ? 'is-closure' : '',
                date === today ? 'is-today' : '',
              ].filter(Boolean).join(' ')

              return (
                <button
                  key={date}
                  type="button"
                  className={classes}
                  title={holidays.map((holiday) => holiday.name).join(' • ') || 'Ajouter une fermeture'}
                  onClick={() => {
                    const closure = holidays.find((holiday) => holiday.holidayType === 'FERMETURE_GMES')
                    const official = holidays.find((holiday) => holiday.holidayType !== 'FERMETURE_GMES')
                    if (closure) openHoliday(closure)
                    else if (official) openHoliday(official)
                    else openCreate(date)
                  }}
                >
                  <span>{Number(date.slice(-2))}</span>
                  {(hasOfficial || hasClosure) && <i />}
                </button>
              )
            })}
          </div>

          <div className="rh-holidays-legend">
            <span><i className="is-official" />Jour férié officiel</span>
            <span><i className="is-closure" />Fermeture GMES</span>
            <span><i className="is-today" />Aujourd’hui</span>
          </div>

          <div className="rh-holidays-source">
            <Icon name="shield" size={15} />
            <span>Référence Martinique centralisée côté serveur, avec repli légal automatique en cas d’indisponibilité de la source officielle.</span>
          </div>
        </section>

        <section className="rh-holidays-list-card">
          <div className="rh-holidays-list-head">
            <div>
              <h3>{counts.all} jour{counts.all > 1 ? 's' : ''} non ouvré{counts.all > 1 ? 's' : ''} en {MONTH_NAMES[monthParts(month).monthNumber - 1].toLowerCase()}</h3>
              <p>Jours fériés officiels et fermetures GMES actives.</p>
            </div>
            <span className="rh-holidays-total">{counts.all} au total</span>
          </div>

          <div className="rh-holidays-tabs" role="tablist" aria-label="Filtrer les jours non ouvrés">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`rh-holidays-tab${filter === item.id ? ' is-active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}<span>{counts[item.id]}</span>
              </button>
            ))}
          </div>

          {state.loading ? (
            <div className="rh-holidays-state"><span className="rh-holidays-spinner" /><strong>Chargement du calendrier…</strong></div>
          ) : state.error ? (
            <div className="rh-holidays-state rh-holidays-state--error">
              <Icon name="alert" size={24} /><strong>Impossible de charger les jours fériés.</strong>
              <button type="button" onClick={() => load()}>Réessayer</button>
            </div>
          ) : visibleHolidays.length === 0 ? (
            <div className="rh-holidays-state">
              <Icon name="calendar" size={25} />
              <strong>Aucun jour à afficher</strong>
              <span>Aucun élément ne correspond au filtre pour {monthLabel(month)}.</span>
            </div>
          ) : (
            <div className="rh-holidays-table-wrap">
              <div className="rh-holidays-table">
                <div className="rh-holidays-row rh-holidays-row--head">
                  <span>Date</span><span>Désignation</span><span>Type</span><span>Statut</span><span>Actions</span>
                </div>
                {visibleHolidays.map((holiday) => (
                  <div
                    key={`${holiday.date}-${holiday.holidayType}-${holiday.id ?? holiday.name}`}
                    className={`rh-holidays-row rh-holidays-row--body${holiday.holidayType === 'FERMETURE_GMES' ? ' is-editable' : ' is-official'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openHoliday(holiday)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openHoliday(holiday)
                    }}
                  >
                    <strong>{formatDate(holiday.date)}</strong>
                    <span className="rh-holidays-name">{holiday.name}</span>
                    <HolidayBadge holiday={holiday} />
                    <span className={`rh-holidays-status${holiday.holidayType === 'FERMETURE_GMES' ? ' is-active' : ' is-protected'}`}>
                      {holiday.holidayType === 'FERMETURE_GMES' ? 'Active' : 'Officiel'}
                    </span>
                    <span className="rh-holidays-actions">
                      {holiday.holidayType === 'FERMETURE_GMES' ? (
                        <button
                          type="button"
                          title="Supprimer la fermeture"
                          onClick={(event) => {
                            event.stopPropagation()
                            setConfirmDelete(holiday)
                          }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      ) : (
                        <span title="Jour officiel protégé"><Icon name="shield" size={15} /></span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {drawer && (
        <div className="rh-holidays-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDrawer()}>
          <aside className="rh-holidays-drawer" role="dialog" aria-modal="true" aria-label={drawer.mode === 'create' ? 'Ajouter une fermeture' : 'Détail du jour'}>
            <div className="rh-holidays-drawer__head">
              <div>
                <small>{drawer.mode === 'official' ? 'JOUR FÉRIÉ OFFICIEL' : drawer.mode === 'edit' ? 'FERMETURE GMES' : 'NOUVELLE FERMETURE'}</small>
                <h2>{drawer.mode === 'create' ? 'Ajouter une fermeture' : drawer.holiday?.name}</h2>
                <p>{drawer.mode === 'official' ? 'Ce jour provient du calendrier officiel Martinique et ne peut pas être modifié ici.' : 'Les fermetures GMES sont exclues automatiquement du décompte des congés.'}</p>
              </div>
              <button type="button" className="rh-holidays-close" onClick={closeDrawer} aria-label="Fermer">×</button>
            </div>

            {drawer.mode === 'official' ? (
              <div className="rh-holidays-drawer__body">
                <section className="rh-holidays-detail-card">
                  <div><small>Date</small><strong>{formatDate(drawer.holiday.date)}</strong></div>
                  <div><small>Type</small><HolidayBadge holiday={drawer.holiday} /></div>
                  <div><small>Statut</small><span className="rh-holidays-status is-protected">Officiel · protégé</span></div>
                  <div><small>Source</small><strong>{drawer.holiday.source || 'Calendrier officiel Martinique'}</strong></div>
                </section>
                <div className="rh-holidays-protected-note"><Icon name="shield" size={17} />Les jours fériés officiels sont gérés automatiquement et restent en lecture seule dans cet écran.</div>
              </div>
            ) : (
              <form className="rh-holidays-form" onSubmit={submitClosure}>
                <section className="rh-holidays-form-card">
                  <label>
                    <span>Désignation</span>
                    <input
                      type="text"
                      value={form.name}
                      maxLength={180}
                      placeholder="Ex. Fermeture exceptionnelle"
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    <span>Date de fermeture</span>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                      required
                    />
                  </label>
                  <div className="rh-holidays-form-info"><Icon name="info" size={16} />Cette fermeture s’applique actuellement à toute la société et ne sera pas décomptée comme jour travaillé.</div>
                </section>
                <div className="rh-holidays-form-actions">
                  <button type="button" className="rh-holidays-secondary" onClick={closeDrawer}>Annuler</button>
                  <button type="submit" className="rh-holidays-primary" disabled={saving || form.name.trim().length < 2 || !form.date}>
                    {saving ? 'Enregistrement…' : drawer.mode === 'edit' ? 'Enregistrer les modifications' : 'Enregistrer la fermeture'}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}

      {confirmDelete && (
        <div className="rh-holidays-confirm-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && setConfirmDelete(null)}>
          <div className="rh-holidays-confirm" role="dialog" aria-modal="true">
            <span className="rh-holidays-confirm__icon"><Icon name="trash" size={20} /></span>
            <h3>Supprimer cette fermeture ?</h3>
            <p><strong>{confirmDelete.name}</strong> — {formatDate(confirmDelete.date)}. Elle ne sera plus considérée comme un jour non ouvré.</p>
            <div>
              <button type="button" onClick={() => setConfirmDelete(null)} disabled={saving}>Annuler</button>
              <button type="button" className="is-danger" onClick={removeClosure} disabled={saving}>{saving ? 'Suppression…' : 'Supprimer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
