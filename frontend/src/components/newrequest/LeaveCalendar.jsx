import { useEffect, useMemo, useState } from 'react'

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

function FaceHappy({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#FEF3C7" stroke="#FCD34D" strokeWidth="1.5" />
      <path d="M7.5 8.5L8.5 7.5L9.5 8.5L8.5 9.5Z" fill="#92400E" />
      <path d="M12.5 8.5L13.5 7.5L14.5 8.5L13.5 9.5Z" fill="#92400E" />
      <path
        d="M7 13C7.5 15.5 9 16 11 16C13 16 14.5 15.5 15 13"
        stroke="#92400E"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="7.5" cy="12" r="1.5" fill="#FCA5A5" opacity="0.6" />
      <circle cx="14.5" cy="12" r="1.5" fill="#FCA5A5" opacity="0.6" />
    </svg>
  )
}

function FaceRelaxed({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#ECFDF5" stroke="#6EE7B7" strokeWidth="1.5" />
      <path d="M7.5 9.5Q9 7.5 10.5 9.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.5 9.5Q13 7.5 14.5 9.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 13.5Q11 16.5 14.5 13.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="12.5" r="1.5" fill="#A7F3D0" opacity="0.7" />
      <circle cx="14.5" cy="12.5" r="1.5" fill="#A7F3D0" opacity="0.7" />
    </svg>
  )
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

export function LeaveCalendar({
  months,
  todayIso,
  selection,
  holidays,
  onPick,
  onPrev,
  onNext,
}) {
  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const [phase, setPhase] = useState(startDate && !endDate ? 'selecting' : 'idle')
  const [hovering, setHovering] = useState(null)
  const [hoverInfo, setHoverInfo] = useState(null)

  const holidayMap = useMemo(() => {
    const map = new Map()
    for (const holiday of holidays ?? []) {
      map.set(holiday.date, holiday)
    }
    return map
  }, [holidays])

  useEffect(() => {
    if (startDate && !endDate) {
      setPhase('selecting')
      return
    }
    setPhase('idle')
    setHovering(null)
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
    const date = parseISODate(iso)
    const holiday = holidayMap.get(iso)
    return date.getUTCDay() === 0 || Boolean(holiday && holiday.deductible === false)
  }

  const handleDayClick = (iso, inMonth) => {
    if (isBlockedDate(iso, inMonth)) {
      return
    }

    if (phase === 'selecting' && startDate && iso === startDate) {
      onPick(iso)
      setPhase('idle')
      setHovering(null)
      return
    }

    if (phase === 'idle' || !startDate || endDate) {
      onPick(iso)
      setPhase('selecting')
      setHovering(null)
      return
    }

    onPick(iso)
    setPhase('idle')
    setHovering(null)
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
                      rangeStart && rangeEnd && iso >= rangeStart && iso <= rangeEnd,
                    )
                    const isMid = inRange && !isStart && !isEnd
                    const showLeftBand = inRange && !isStart
                    const showRightBand = inRange && !isEnd
                    const showFace = (isStart || isEnd) && !single && cell.inMonth
                    const startPm = isStart && !isSingle && startPeriod === 'APRES_MIDI'
                    const endAm = isEnd && !isSingle && endPeriod === 'MATIN'
                    const today = iso === todayIso
                    const showDot = (isHoliday || isClosure) && !inRange && cell.inMonth

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
                      <button
                        type="button"
                        key={`${year}-${month}-${iso}`}
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
                              <FaceHappy size={15} />
                              <span className="nr-cal__face-day">{cell.day}</span>
                            </>
                          ) : showFace && isEnd ? (
                            <>
                              <FaceRelaxed size={15} />
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
                        {endAm && (
                          <span className="nr-cal__half-ico nr-cal__half-ico--am">
                            <SunPic size={8} />
                          </span>
                        )}
                      </button>
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
