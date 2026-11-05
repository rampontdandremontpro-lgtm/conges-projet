import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'

import '@/styles/shared/statistic-info.css'

const EDGE = 12
const GAP = 8

export function StatisticInfoButton({ title, children, ariaLabel, wide = false }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const rootRef = useRef(null)
  const popRef = useRef(null)

  // Positionne le popover (rendu dans un portail sur document.body) par rapport
  // au bouton réel, avec retournement au-dessus et ajustement horizontal.
  useLayoutEffect(() => {
    if (!open) return undefined

    const measure = () => {
      const trigger = rootRef.current
      const pop = popRef.current
      if (!trigger || !pop) return
      const tr = trigger.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const isMobile = vw <= 620

      const width = isMobile
        ? `min(340px, ${vw - EDGE * 2}px)`
        : `min(${wide ? 400 : 330}px, ${vw - EDGE * 2}px)`
      pop.style.width = width

      const pr = pop.getBoundingClientRect()

      let left
      let top
      let above = false

      if (isMobile) {
        left = Math.round((vw - pr.width) / 2)
        top = Math.round((vh - pr.height) / 2)
      } else {
        left = Math.round(tr.left + tr.width / 2 - pr.width / 2)
        left = Math.max(EDGE, Math.min(left, vw - pr.width - EDGE))

        top = Math.round(tr.bottom + GAP)
        if (top + pr.height > vh - EDGE) {
          top = Math.round(tr.top - GAP - pr.height)
          above = true
        }
        if (top < EDGE) top = EDGE
      }

      setPos({ left, top, above })
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  // Fermeture : clic extérieur, Échap. Focus déplacé vers la fenêtre à
  // l'ouverture puis restitué au bouton à la fermeture.
  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (popRef.current?.contains(event.target)) return
      if (rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    const closeButton = popRef.current?.querySelector('[data-close]')
    closeButton?.focus()

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      rootRef.current?.querySelector('button')?.focus()
    }
  }, [open])

  return (
    <div className="statistic-info-button" ref={rootRef}>
      <button
        type="button"
        className="statistic-info-button__trigger"
        aria-label={ariaLabel ?? `Comprendre : ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="info" size={13} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            className={`statistic-info-button__popover${wide ? ' statistic-info-button__popover--wide' : ''}${pos?.above ? ' statistic-info-button__popover--above' : ''}`}
            style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
            role="dialog"
            aria-label={title}
          >
            <div className="statistic-info-button__popover-head">
              <strong>{title}</strong>
              <button type="button" data-close onClick={() => setOpen(false)} aria-label="Fermer l’explication">
                ×
              </button>
            </div>
            <div className="statistic-info-button__content">{children}</div>
          </div>,
          document.body,
        )}
    </div>
  )
}
