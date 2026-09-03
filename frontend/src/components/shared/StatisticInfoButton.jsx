import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'

import '@/styles/shared/statistic-info.css'

export function StatisticInfoButton({ title, children, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="statistic-info-button" ref={rootRef}>
      <button
        type="button"
        className="statistic-info-button__trigger"
        aria-label={ariaLabel ?? `Comprendre le calcul : ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="info" size={13} />
      </button>

      {open && (
        <div className="statistic-info-button__popover" role="dialog" aria-label={title}>
          <div className="statistic-info-button__popover-head">
            <strong>{title}</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer l’explication">×</button>
          </div>
          <div className="statistic-info-button__content">{children}</div>
        </div>
      )}
    </div>
  )
}
