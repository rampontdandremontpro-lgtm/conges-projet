import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '@/components/ui/Icon'

import '@/styles/shared/statistic-info.css'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function StatisticInfoButton({ title, children, ariaLabel, portal = false }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const updatePosition = useCallback(() => {
    if (!open || !portal || !triggerRef.current || !popoverRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 16
    const width = Math.min(330, Math.max(240, window.innerWidth - viewportPadding * 2))
    const popoverHeight = popoverRef.current.offsetHeight
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - width / 2
    const left = clamp(centeredLeft, viewportPadding, window.innerWidth - width - viewportPadding)

    let top = triggerRect.bottom + 9
    let placement = 'bottom'
    if (top + popoverHeight > window.innerHeight - viewportPadding) {
      const above = triggerRect.top - popoverHeight - 9
      if (above >= viewportPadding) {
        top = above
        placement = 'top'
      }
    }

    setPosition({ top, left, width, placement })
  }, [open, portal])

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }

    const frame = portal ? window.requestAnimationFrame(updatePosition) : null
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      if (popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onViewportChange = () => updatePosition()

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    if (portal) {
      window.addEventListener('resize', onViewportChange)
      window.addEventListener('scroll', onViewportChange, true)
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      if (portal) {
        window.removeEventListener('resize', onViewportChange)
        window.removeEventListener('scroll', onViewportChange, true)
      }
    }
  }, [open, portal, updatePosition])

  const popoverNode = open ? (
    <div
      ref={popoverRef}
      className={`statistic-info-button__popover${portal ? ` statistic-info-button__popover--portal statistic-info-button__popover--${position?.placement ?? 'bottom'}` : ''}`}
      role="dialog"
      aria-label={title}
      style={portal ? {
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: position?.width ?? 330,
        visibility: position ? 'visible' : 'hidden',
      } : undefined}
    >
      <div className="statistic-info-button__popover-head">
        <strong>{title}</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Fermer l’explication">×</button>
      </div>
      <div className="statistic-info-button__content">{children}</div>
    </div>
  ) : null

  return (
    <div className="statistic-info-button" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="statistic-info-button__trigger"
        aria-label={ariaLabel ?? `Comprendre le calcul : ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="info" size={13} />
      </button>
      {portal && typeof document !== 'undefined' && popoverNode
        ? createPortal(popoverNode, document.body)
        : popoverNode}
    </div>
  )
}
