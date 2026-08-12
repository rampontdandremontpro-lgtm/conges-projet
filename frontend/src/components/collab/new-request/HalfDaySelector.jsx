const DAY_PERIODS = {
  MATIN: 'Matin',
  APRES_MIDI: 'Après-midi',
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

function PeriodButtons({ value, onChange }) {
  return (
    <div className="nr-halfdays__pills">
      {Object.entries(DAY_PERIODS).map(([period, label]) => (
        <button
          type="button"
          key={period}
          className={`nr-pill${value === period ? ' nr-pill--active' : ''}`}
          onClick={() => onChange(period)}
        >
          {period === 'MATIN' ? <SunPic size={12} /> : <MoonPic size={12} />}
          {label}
        </button>
      ))}
    </div>
  )
}

export function HalfDaySelector({ startPeriod, endPeriod, onStartChange, onEndChange }) {
  return (
    <section className="nr-halfdays">
      <p className="nr-halfdays__heading">Demi-journées</p>
      <div className="nr-halfdays__groups">
        <div className="nr-halfdays__group">
          <span className="nr-halfdays__label">Début de la période</span>
          <PeriodButtons value={startPeriod} onChange={onStartChange} />
        </div>
        <div className="nr-halfdays__group">
          <span className="nr-halfdays__label">Fin de la période</span>
          <PeriodButtons value={endPeriod} onChange={onEndChange} />
        </div>
      </div>
    </section>
  )
}
