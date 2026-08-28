import { useEffect, useMemo, useState } from 'react'

import { getMyPreferences } from '@/services/profile'

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

const pad = (value) => String(value).padStart(2, '0')

function isoOfDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function monthLabel(year, month) {
  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function buildMonthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))
  const leading = (first.getUTCDay() + 6) % 7
  const trailing = (7 - ((last.getUTCDay() + 6) % 7) - 1 + 7) % 7
  const start = addUtcDays(first, -leading)
  const total = leading + last.getUTCDate() + trailing

  return Array.from({ length: total }, (_, index) => {
    const date = addUtcDays(start, index)
    return {
      iso: isoOfDate(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCFullYear() === year && date.getUTCMonth() === month,
    }
  })
}

function SunPic({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="#F59E0B" />
      <path
        d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.4 3.4L4.4 4.4M11.6 11.6L12.6 12.6M12.6 3.4L11.6 4.4M4.4 11.6L3.4 12.6"
        stroke="#F59E0B"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonPic({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M14 10C12.8 12.6 10.1 14.3 7 14.3C3.7 14.3 1 11.6 1 8.3C1 5.2 3 2.8 5.8 2C5.1 3.1 4.7 4.4 4.7 5.8C4.7 9.5 7.7 12.5 11.4 12.5C12.3 12.5 13.2 12.3 14 10Z"
        fill="#6366F1"
        opacity="0.8"
      />
    </svg>
  )
}

function ChevronIcon({ direction }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  )
}

function parseISODate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

function formatCalendarDate(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseISODate(iso))
}

function singleDayPeriodLabel(startPeriod, endPeriod) {
  if (startPeriod === 'MATIN' && endPeriod === 'MATIN') return 'Matin'
  if (startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI') return 'Après-midi'
  return 'Journée entière'
}

function selectionTimingLabel({ startDate, endDate, startPeriod, endPeriod }) {
  if (!startDate || !endDate) return ''
  if (startDate === endDate) {
    return `${formatCalendarDate(startDate)} · ${singleDayPeriodLabel(startPeriod, endPeriod)}`
  }
  const departure = startPeriod === 'APRES_MIDI' ? 'après-midi' : 'matin'
  const returnPeriod = endPeriod === 'MATIN' ? 'matin' : 'après-midi'
  return `Du ${formatCalendarDate(startDate)} (${departure}) au ${formatCalendarDate(endDate)} (${returnPeriod})`
}

export function LeaveCalendar({
  months,
  todayIso,
  selection,
  holidays,
  onPick,
  onPrev,
  onNext,
  allowsHalfDays = false,
  onBoundaryPeriodChange,
  blockNonDeductibleDates = true,
  singleSelection = false,
}) {
  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const [selectionEmojis, setSelectionEmojis] = useState({ startEmoji: '😊', endEmoji: '😔' })
  const [phase, setPhase] = useState(startDate && !endDate ? 'selecting' : 'idle')
  const [hovering, setHovering] = useState(null)
  const [hoverInfo, setHoverInfo] = useState(null)
  const [boundaryEditor, setBoundaryEditor] = useState(null)

  useEffect(() => {
    let active = true

    const applyPreferences = (data) => {
      if (!active) return
      setSelectionEmojis({
        startEmoji: data?.startEmoji ?? '😊',
        endEmoji: data?.endEmoji ?? '😔',
      })
    }

    getMyPreferences().then(applyPreferences).catch(() => {})

    const handlePreferenceUpdate = (event) => applyPreferences(event.detail)
    window.addEventListener('gmes:profile-preferences-updated', handlePreferenceUpdate)

    return () => {
      active = false
      window.removeEventListener('gmes:profile-preferences-updated', handlePreferenceUpdate)
    }
  }, [])

  const holidayMap = useMemo(() => {
    const map = new Map()
    for (const holiday of holidays ?? []) {
      const date = typeof holiday.date === 'string' ? holiday.date.slice(0, 10) : ''
      if (date) {
        map.set(date, holiday)
      }
    }
    return map
  }, [holidays])

  useEffect(() => {
    if (!startDate) {
      setPhase('idle')
      setHovering(null)
      return
    }

    if (!endDate) {
      setPhase('selecting')
      return
    }

    if (startDate !== endDate) {
      setPhase('idle')
      setHovering(null)
    }
  }, [startDate, endDate])

  const effectiveEnd = phase === 'selecting' && hovering ? hovering : endDate

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (!startDate || !effectiveEnd) {
      return [startDate ?? null, null]
    }
    return effectiveEnd < startDate
      ? [effectiveEnd, startDate]
      : [startDate, effectiveEnd]
  }, [startDate, effectiveEnd])

  const isSingle = Boolean(rangeStart && rangeEnd && rangeStart === rangeEnd)

  const isBlockedDate = (iso, inMonth) => {
    if (!inMonth) {
      return true
    }
    if (!blockNonDeductibleDates) return false
    const date = parseISODate(iso)
    const holiday = holidayMap.get(iso)
    return date.getUTCDay() === 0 || Boolean(holiday && holiday.deductible === false)
  }

  const handleDayClick = (iso, inMonth) => {
    if (isBlockedDate(iso, inMonth)) return

    if (singleSelection) {
      onPick(iso)
      setPhase('idle')
      setHovering(null)
      setBoundaryEditor(null)
      return
    }

    const selectedRangeStart = startDate && endDate
      ? (endDate < startDate ? endDate : startDate)
      : null
    const selectedRangeEnd = startDate && endDate
      ? (endDate < startDate ? startDate : endDate)
      : null
    const clickedSelectedDay = Boolean(
      selectedRangeStart && selectedRangeEnd && iso >= selectedRangeStart && iso <= selectedRangeEnd,
    )

    // Un clic sur une journée déjà bleue annule la sélection complète.
    // On ne rouvre jamais le choix des demi-journées sur un jour déjà sélectionné.
    if (clickedSelectedDay) {
      onPick(iso)
      setPhase('idle')
      setHovering(null)
      setBoundaryEditor(null)
      return
    }

    if (phase === 'selecting' && startDate) {
      const boundary = iso < startDate ? 'start' : 'end'
      onPick(iso)
      if (allowsHalfDays) setBoundaryEditor({ iso, boundary })
      setPhase('idle')
      setHovering(null)
      return
    }

    onPick(iso)
    setPhase('selecting')
    setHovering(null)
    if (allowsHalfDays) setBoundaryEditor({ iso, boundary: 'single' })
  }

  const chooseBoundaryPeriod = (boundary, value) => {
    onBoundaryPeriodChange?.({ boundary, value })
    setBoundaryEditor(null)
  }

  const currentBoundaryValue = (boundary) => {
    if (boundary === 'single') {
      if (startPeriod === 'MATIN' && endPeriod === 'MATIN') return 'MATIN'
      if (startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI') return 'APRES_MIDI'
      return 'FULL_DAY'
    }
    return boundary === 'start' ? startPeriod : endPeriod
  }

  const handleDayEnter = (iso, inMonth, holiday) => {
    if (isBlockedDate(iso, inMonth)) {
      return
    }
    if (phase === 'selecting') {
      setHovering(iso)
    }
    setHoverInfo(holiday?.name ?? null)
  }

  const handleDayLeave = () => {
    if (phase === 'selecting') {
      setHovering(null)
    }
    setHoverInfo(null)
  }

  return (
    <div className="nr-cal">
      <div className="nr-cal__body">
        <button
          type="button"
          className="nr-cal__nav-btn"
          onClick={onPrev}
          aria-label="Mois précédent"
        >
          <ChevronIcon direction="left" />
        </button>

        <div className="nr-cal__months">
          {months.map(({ year, month }) => {
            const cells = buildMonthGrid(year, month)
            return (
              <div className="nr-cal__month" key={`${year}-${month}`}>
                <div className="nr-cal__month-title">{monthLabel(year, month)}</div>
                <div className="nr-cal__weekdays">
                  {WEEKDAY_LABELS.map((label) => (
                    <span className="nr-cal__weekday" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
                <div className="nr-cal__grid">
                  {cells.map((cell) => {
                    const iso = cell.iso
                    const holiday = holidayMap.get(iso)
                    const date = parseISODate(iso)
                    const isSunday = date.getUTCDay() === 0
                    const isSaturday = date.getUTCDay() === 6
                    const isClosure = holiday?.holidayType === 'FERMETURE_GMES'
                    const isHoliday = Boolean(holiday && !isClosure)
                    const isBlocked = isBlockedDate(iso, cell.inMonth)
                    const isStart = Boolean(rangeStart && iso === rangeStart)
                    const isEnd = Boolean(rangeEnd && iso === rangeEnd)
                    const single = isStart && isSingle
                    const inRange = Boolean(
                      cell.inMonth &&
                        rangeStart &&
                        rangeEnd &&
                        iso >= rangeStart &&
                        iso <= rangeEnd,
                    )
                    const isMid = inRange && !isStart && !isEnd
                    const showLeftBand = inRange && !isStart
                    const showRightBand = inRange && !isEnd
                    const showFace = (isStart || isEnd) && !single && cell.inMonth
                    const startPm = isStart && !isSingle && startPeriod === 'APRES_MIDI'
                    const endAm = isEnd && !isSingle && endPeriod === 'MATIN'
                    const singleAm = single && startPeriod === 'MATIN' && endPeriod === 'MATIN'
                    const singlePm = single && startPeriod === 'APRES_MIDI' && endPeriod === 'APRES_MIDI'
                    const activeEditor = allowsHalfDays && boundaryEditor?.iso === iso ? boundaryEditor : null
                    const today = iso === todayIso
                    const showDot = (isHoliday || isClosure) && cell.inMonth

                    const cellClassName = [
                      'nr-cal__cell',
                      cell.inMonth ? '' : 'nr-cal__cell--outside',
                      isSunday && cell.inMonth ? 'nr-cal__cell--sunday' : '',
                      isSaturday && cell.inMonth ? 'nr-cal__cell--saturday' : '',
                      isHoliday && cell.inMonth ? 'nr-cal__cell--holiday' : '',
                      isClosure && cell.inMonth ? 'nr-cal__cell--closure' : '',
                      today && !inRange ? 'nr-cal__cell--today' : '',
                      isMid ? 'nr-cal__cell--in-range' : '',
                      (isStart || isEnd) && cell.inMonth ? 'nr-cal__cell--edge' : '',
                      isStart ? 'nr-cal__cell--start' : '',
                      isEnd ? 'nr-cal__cell--end' : '',
                      single ? 'nr-cal__cell--single' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <div className="nr-cal__cell-wrap" key={`${year}-${month}-${iso}`}>
                      <button
                        type="button"
                        className={cellClassName}
                        onClick={() => handleDayClick(iso, cell.inMonth)}
                        onMouseEnter={() => handleDayEnter(iso, cell.inMonth, holiday)}
                        onMouseLeave={handleDayLeave}
                        title={holiday ? `${iso} — ${holiday.name}` : undefined}
                        disabled={isBlocked}
                        aria-label={holiday ? `${iso}, ${holiday.name}` : iso}
                      >
                        {showLeftBand && <span className="nr-cal__band nr-cal__band--left" />}
                        {showRightBand && <span className="nr-cal__band nr-cal__band--right" />}
                        {startPm && <span className="nr-cal__band nr-cal__band--right nr-cal__band--half" />}
                        {endAm && <span className="nr-cal__band nr-cal__band--left nr-cal__band--half" />}

                        <span className="nr-cal__day-circle">
                          {showFace && isStart ? (
                            <>
                              <span className="nr-cal__selection-emoji" aria-hidden="true">{selectionEmojis.startEmoji}</span>
                              <span className="nr-cal__face-day">{cell.day}</span>
                            </>
                          ) : showFace && isEnd ? (
                            <>
                              <span className="nr-cal__selection-emoji" aria-hidden="true">{selectionEmojis.endEmoji}</span>
                              <span className="nr-cal__face-day">{cell.day}</span>
                            </>
                          ) : (
                            <span className="nr-cal__day-num">{cell.day}</span>
                          )}
                        </span>

                        {showDot && (
                          <span
                            className={`nr-cal__day-dot ${
                              isHoliday ? 'nr-cal__day-dot--holiday' : 'nr-cal__day-dot--closure'
                            }`}
                          />
                        )}
                        {startPm && (
                          <span className="nr-cal__half-ico nr-cal__half-ico--pm">
                            <MoonPic size={8} />
                          </span>
                        )}
                        {(endAm || singleAm) && (
                          <span className="nr-cal__half-ico nr-cal__half-ico--am">
                            <SunPic size={8} />
                          </span>
                        )}
                        {singlePm && (
                          <span className="nr-cal__half-ico nr-cal__half-ico--pm">
                            <MoonPic size={8} />
                          </span>
                        )}
                      </button>
                      {activeEditor && (
                        <div className="nr-cal__boundary-popover" role="dialog" aria-label="Choisir la demi-journée">
                          <strong>
                            {activeEditor.boundary === 'start'
                              ? 'Je pars quand ?'
                              : activeEditor.boundary === 'end'
                                ? 'Je rentre quand ?'
                                : 'Quelle demi-journée ?'}
                          </strong>
                          <p>{activeEditor.boundary === 'single' ? 'Choisissez la durée de cette journée.' : 'Choisissez matin ou après-midi.'}</p>
                          <div className="nr-cal__boundary-actions">
                            {activeEditor.boundary === 'single' && (
                              <button
                                type="button"
                                className={currentBoundaryValue('single') === 'FULL_DAY' ? 'is-active' : ''}
                                aria-pressed={currentBoundaryValue('single') === 'FULL_DAY'}
                                onClick={() => chooseBoundaryPeriod('single', 'FULL_DAY')}
                              >
                                Journée entière
                              </button>
                            )}
                            <button
                              type="button"
                              className={currentBoundaryValue(activeEditor.boundary) === 'MATIN' ? 'is-active' : ''}
                              aria-pressed={currentBoundaryValue(activeEditor.boundary) === 'MATIN'}
                              onClick={() => chooseBoundaryPeriod(activeEditor.boundary, 'MATIN')}
                            >
                              Matin
                            </button>
                            <button
                              type="button"
                              className={currentBoundaryValue(activeEditor.boundary) === 'APRES_MIDI' ? 'is-active' : ''}
                              aria-pressed={currentBoundaryValue(activeEditor.boundary) === 'APRES_MIDI'}
                              onClick={() => chooseBoundaryPeriod(activeEditor.boundary, 'APRES_MIDI')}
                            >
                              Après-midi
                            </button>
                          </div>
                        </div>
                      )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className="nr-cal__nav-btn"
          onClick={onNext}
          aria-label="Mois suivant"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      {hoverInfo && <div className="nr-cal__hover-info">{hoverInfo}</div>}

      {allowsHalfDays && startDate && endDate && (
        <div className="nr-cal__selection-confirmation" aria-live="polite">
          <span className="nr-cal__selection-confirmation-mark">✓</span>
          <span><strong>Sélection :</strong> {selectionTimingLabel({ startDate, endDate, startPeriod, endPeriod })}</span>
        </div>
      )}

      <div className="nr-cal__legend">
        <span className="nr-cal__legend-item">
          <i className="nr-cal__legend-dot nr-cal__legend-dot--sel" /> Sélection
        </span>
        <span className="nr-cal__legend-item">
          <i className="nr-cal__legend-dot nr-cal__legend-dot--today" /> Aujourd'hui
        </span>
        <span className="nr-cal__legend-item">
          <i className="nr-cal__legend-dot nr-cal__legend-dot--holiday" /> Jour férié
        </span>
        <span className="nr-cal__legend-item">
          <i className="nr-cal__legend-dot nr-cal__legend-dot--saturday" /> Samedi
        </span>
        <span className="nr-cal__legend-item">
          <i className="nr-cal__legend-dot nr-cal__legend-dot--closure" /> Fermeture GMES
        </span>
      </div>
    </div>
  )
}
