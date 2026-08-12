import { useState } from 'react'

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

const pad = (value) => String(value).padStart(2, '0')

function isoOf(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function buildMonthGrid(year, month) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const startWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const leadingBlanks = (startWeekday + 6) % 7

  const cells = []
  for (let i = 0; i < leadingBlanks; i += 1) {
    cells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: isoOf(year, month, day), day })
  }
  while (cells.length % 7 !== 0) {
    cells.push(null)
  }
  return cells
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

export function LeaveCalendar({
  months,
  todayIso,
  selection,
  holidays,
  onPick,
  onPrev,
  onNext,
}) {
  const [hoverInfo, setHoverInfo] = useState(null)
  const holidayMap = new Map()
  for (const holiday of holidays ?? []) {
    holidayMap.set(holiday.date, holiday)
  }

  const { startDate, endDate, startPeriod, endPeriod } = selection ?? {}
  const rangeMin = startDate && endDate
    ? startDate <= endDate ? startDate : endDate
    : null
  const rangeMax = startDate && endDate
    ? startDate <= endDate ? endDate : startDate
    : null
  const isSingle = Boolean(startDate && endDate && startDate === endDate)

  const handlePick = (iso) => {
    const day = parseISODate(iso)
    const holiday = holidayMap.get(iso)
    const isSunday = day.getUTCDay() === 0
    const isNonDeductible = Boolean(holiday && holiday.deductible === false)
    if (isSunday || isNonDeductible) {
      return
    }
    onPick(iso)
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
          {months.map(({ year, month }, index) => {
            const cells = buildMonthGrid(year, month)
            return (
              <div className="nr-cal__month" key={`${year}-${month}`}>
                <div className="nr-cal__month-title">
                  {monthLabel(year, month)}
                </div>
                <div className="nr-cal__weekdays">
                  {WEEKDAY_LABELS.map((label) => (
                    <span className="nr-cal__weekday" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
                <div className="nr-cal__grid">
                  {cells.map((cell, cellIndex) => {
                    if (!cell) {
                      return (
                        <span
                          className="nr-cal__cell nr-cal__cell--blank"
                          key={`blank-${index}-${cellIndex}`}
                        />
                      )
                    }
                    const iso = cell.iso
                    const holiday = holidayMap.get(iso)
                    const day = parseISODate(iso)
                    const isSunday = day.getUTCDay() === 0
                    const isSaturday = day.getUTCDay() === 6
                    const isNonDeductible = Boolean(
                      holiday && holiday.deductible === false,
                    )
                    const isBlocked = isSunday || isNonDeductible

                    const inRangeInc = Boolean(
                      rangeMin && rangeMax && iso >= rangeMin && iso <= rangeMax,
                    )
                    const isStart = Boolean(startDate && rangeMin && iso === rangeMin)
                    const isEnd = Boolean(endDate && rangeMax && iso === rangeMax)
                    const isMid = inRangeInc && !isStart && !isEnd

                    let state = 'default'
                    if (isStart) {
                      state = 'start'
                    } else if (isEnd) {
                      state = 'end'
                    } else if (isMid && isBlocked) {
                      state = 'range-blocked'
                    } else if (isMid) {
                      state = 'in-range'
                    } else if (isBlocked) {
                      state = isSunday ? 'blocked' : 'blocked-holiday'
                    }

                    const distFromStart = rangeMin
                      ? Math.round(
                          (Date.parse(iso) - Date.parse(rangeMin)) / 86_400_000,
                        )
                      : 0
                    const sweepDelay = inRangeInc
                      ? Math.min(Math.max(distFromStart, 0), 8) * 6
                      : 0
                    const bandStyle = sweepDelay
                      ? { transitionDelay: `${sweepDelay}ms` }
                      : undefined
                    const popDelay = isEnd ? sweepDelay : 0
                    const isPMst =
                      isStart && !isSingle && startPeriod === 'APRES_MIDI'
                    const isAMen =
                      isEnd && !isSingle && endPeriod === 'MATIN'
                    const todayRing = iso === todayIso && !inRangeInc
                    const isHoliday = Boolean(holiday && holiday.deductible !== false)
                    const isClosure = isNonDeductible
                    const showDot = (isHoliday || isClosure) && !inRangeInc

                    return (
                      <button
                        type="button"
                        key={iso}
                        data-iso={iso}
                        className={`nr-cal__cell nr-cal__cell--${state}${
                          isSunday ? ' nr-cal__cell--sunday' : ''
                        }${isSaturday ? ' nr-cal__cell--saturday' : ''}${
                          isHoliday ? ' nr-cal__cell--holiday' : ''
                        }${isClosure ? ' nr-cal__cell--closure' : ''}${
                          todayRing ? ' nr-cal__cell--today' : ''
                        }${isSingle ? ' nr-cal__cell--single' : ''}`}
                        onClick={() => handlePick(iso)}
                        onMouseEnter={() => {
                          if (!isBlocked && holiday) {
                            setHoverInfo(holiday.name)
                          }
                        }}
                        onMouseLeave={() => setHoverInfo(null)}
                        title={holiday ? `${iso} — ${holiday.name}` : undefined}
                        disabled={state === 'blocked' || state === 'blocked-holiday'}
                      >
                        <span
                          className="nr-cal__band nr-cal__band--l"
                          style={bandStyle}
                        />
                        <span
                          className="nr-cal__band nr-cal__band--r"
                          style={bandStyle}
                        />
                        {isPMst && (
                          <span
                            className="nr-cal__band nr-cal__band--r nr-cal__band--half"
                            style={bandStyle}
                          />
                        )}
                        {isAMen && (
                          <span
                            className="nr-cal__band nr-cal__band--l nr-cal__band--half"
                            style={bandStyle}
                          />
                        )}
                        {isSingle && (
                          <span
                            className="nr-cal__band nr-cal__band--full"
                            style={bandStyle}
                          />
                        )}
                        <span
                          className={`nr-cal__day-circle ${isStart || isEnd ? 'nr-cal__day-circle--pop' : ''}`}
                          style={
                            popDelay
                              ? { animationDelay: `${popDelay}ms` }
                              : undefined
                          }
                        >
                          <span className="nr-cal__day-num">{cell.day}</span>
                          <span className="nr-cal__day-face">
                            {(isStart || isEnd) && !isSingle ? (
                              isStart ? <FaceHappy /> : <FaceRelaxed />
                            ) : null}
                            <span className="nr-cal__day-face-num">
                              {cell.day}
                            </span>
                          </span>
                        </span>
                        {showDot && (
                          <span
                            className={`nr-cal__day-dot${
                              isHoliday
                                ? ' nr-cal__day-dot--holiday'
                                : ' nr-cal__day-dot--closure'
                            }`}
                          />
                        )}
                        {isPMst && (
                          <span className="nr-cal__half-ico nr-cal__half-ico--pm">
                            <MoonPic size={8} />
                          </span>
                        )}
                        {isAMen && (
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

function parseISODate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}
