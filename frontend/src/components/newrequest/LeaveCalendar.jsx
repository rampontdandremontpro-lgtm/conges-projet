const WEEKDAY_LABELS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

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

function SunGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function MoonGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function LockGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
  const holidayMap = new Map()
  for (const holiday of holidays ?? []) {
    holidayMap.set(holiday.date, holiday)
  }

  const { startDate, endDate } = selection ?? {}
  const rangeMin = startDate && endDate
    ? startDate <= endDate ? startDate : endDate
    : null
  const rangeMax = startDate && endDate
    ? startDate <= endDate ? endDate : startDate
    : null

  const stateOf = (iso) => {
    const day = parseISODate(iso)
    const holiday = holidayMap.get(iso)
    const isSunday = day.getUTCDay() === 0
    const isNonDeductible = Boolean(holiday && holiday.deductible === false)
    const isBlocked = isSunday || isNonDeductible

    const inRange =
      rangeMin && rangeMax && iso > rangeMin && iso < rangeMax

    if (iso === startDate && iso === endDate) {
      return 'start'
    }
    if (iso === startDate) {
      return 'start'
    }
    if (iso === endDate) {
      return 'end'
    }
    if (inRange && isBlocked) {
      return 'range-blocked'
    }
    if (inRange) {
      return 'in-range'
    }
    if (isBlocked) {
      return isSunday ? 'blocked' : 'blocked-holiday'
    }
    return 'default'
  }

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
      <div className="nr-cal__header">
        <button
          type="button"
          className="nr-cal__nav-btn"
          onClick={onPrev}
          aria-label="Mois précédent"
        >
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
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="nr-cal__nav-spacer" aria-hidden="true" />
        <button
          type="button"
          className="nr-cal__nav-btn"
          onClick={onNext}
          aria-label="Mois suivant"
        >
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
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

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
                  const state = stateOf(cell.iso)
                  const holiday = holidayMap.get(cell.iso)
                  const isToday = cell.iso === todayIso
                  const isSaturday = parseISODate(cell.iso).getUTCDay() === 6
                  const title = holiday
                    ? `${cell.iso} — ${holiday.name}`
                    : undefined

                  return (
                    <button
                      type="button"
                      key={cell.iso}
                      data-iso={cell.iso}
                      className={`nr-cal__cell nr-cal__cell--${state}${
                        isSaturday ? ' nr-cal__cell--saturday' : ''
                      }${isToday ? ' nr-cal__cell--today' : ''}`}
                      onClick={() => handlePick(cell.iso)}
                      title={title}
                      disabled={state === 'blocked' || state === 'blocked-holiday'}
                    >
                      <span className="nr-cal__day-num">{cell.day}</span>
                      {state === 'start' && (
                        <span className="nr-cal__glyph">
                          <SunGlyph />
                        </span>
                      )}
                      {state === 'end' && (
                        <span className="nr-cal__glyph">
                          <MoonGlyph />
                        </span>
                      )}
                      {(state === 'blocked-holiday' ||
                        (state === 'range-blocked' && holiday)) && (
                        <span className="nr-cal__glyph nr-cal__glyph--lock">
                          <LockGlyph />
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

      <div className="nr-cal__legend">
        <span className="nr-cal__legend-item">
          <SunGlyph /> Début
        </span>
        <span className="nr-cal__legend-item">
          <MoonGlyph /> Fin
        </span>
        <span className="nr-cal__legend-item nr-cal__legend-item--range">
          <i className="nr-cal__legend-swatch" /> Période
        </span>
        <span className="nr-cal__legend-item nr-cal__legend-item--today">
          <i className="nr-cal__legend-ring" /> Aujourd'hui
        </span>
        <span className="nr-cal__legend-item nr-cal__legend-item--closed">
          <LockGlyph /> Non décompté
        </span>
      </div>
    </div>
  )
}

function parseISODate(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}
