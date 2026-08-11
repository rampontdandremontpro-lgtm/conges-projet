import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'

const INITIALS_PATTERN = /^[\p{L}.\-\s]+$/u

function initialsValid(value) {
  const letters = (value.match(/\p{L}/gu) ?? []).length
  return letters >= 2 && letters <= 6 && INITIALS_PATTERN.test(value)
}

export function SignatureModal({ open, requestLabel, submitting, onClose, onConfirm }) {
  const [mode, setMode] = useState('INITIALS')
  const [initials, setInitials] = useState('')
  const [hasDrawing, setHasDrawing] = useState(false)
  const [error, setError] = useState(null)

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    if (!open || mode !== 'DRAWN' || !canvasRef.current) {
      return undefined
    }
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const context = canvas.getContext('2d')
    context.scale(dpr, dpr)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, rect.width, rect.height)
    context.strokeStyle = '#0a55b0'
    context.lineWidth = 2.4
    context.lineCap = 'round'
    context.lineJoin = 'round'
    drawingRef.current = false
    setHasDrawing(false)

    const pointerPosition = (event) => {
      const canvasRect = canvas.getBoundingClientRect()
      return {
        x: event.clientX - canvasRect.left,
        y: event.clientY - canvasRect.top,
      }
    }

    const startStroke = (event) => {
      event.preventDefault()
      const position = pointerPosition(event)
      context.beginPath()
      context.moveTo(position.x, position.y)
      drawingRef.current = true
    }

    const moveStroke = (event) => {
      if (!drawingRef.current) {
        return
      }
      event.preventDefault()
      const position = pointerPosition(event)
      context.lineTo(position.x, position.y)
      context.stroke()
    }

    const endStroke = () => {
      if (drawingRef.current) {
        drawingRef.current = false
        setHasDrawing(true)
      }
    }

    const element = containerRef.current
    element.addEventListener('pointerdown', startStroke)
    element.addEventListener('pointermove', moveStroke)
    window.addEventListener('pointerup', endStroke)
    window.addEventListener('pointercancel', endStroke)

    return () => {
      element?.removeEventListener('pointerdown', startStroke)
      element?.removeEventListener('pointermove', moveStroke)
      window.removeEventListener('pointerup', endStroke)
      window.removeEventListener('pointercancel', endStroke)
    }
  }, [open, mode])

  if (!open) {
    return null
  }

  const handleConfirm = () => {
    setError(null)
    if (mode === 'INITIALS') {
      if (!initialsValid(initials)) {
        setError('Les initiales doivent contenir entre 2 et 6 lettres.')
        return
      }
      onConfirm('INITIALS', initials.trim().toUpperCase())
      return
    }

    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const hasInk = imageData.data.some(
      (value, index) => index % 4 === 3 && value > 0,
    )
    if (!hasInk) {
      setError('Veuillez dessiner votre signature dans le cadre.')
      return
    }
    onConfirm('DRAWN', canvas.toDataURL('image/png'))
  }

  return (
    <div className="nr-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="nr-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Signer et soumettre la demande"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="nr-modal__header">
          <div>
            <h3 className="nr-modal__title">Signer et soumettre</h3>
            <p className="nr-modal__subtitle">{requestLabel}</p>
          </div>
          <button
            type="button"
            className="nr-modal__close"
            onClick={onClose}
            aria-label="Fermer"
            disabled={submitting}
          >
            ×
          </button>
        </div>

        <div className="nr-sig__mode-tabs">
          <button
            type="button"
            className={`nr-sig__tab${mode === 'INITIALS' ? ' nr-sig__tab--active' : ''}`}
            onClick={() => setMode('INITIALS')}
            disabled={submitting}
          >
            Initiales
          </button>
          <button
            type="button"
            className={`nr-sig__tab${mode === 'DRAWN' ? ' nr-sig__tab--active' : ''}`}
            onClick={() => setMode('DRAWN')}
            disabled={submitting}
          >
            Signature dessinée
          </button>
        </div>

        {mode === 'INITIALS' ? (
          <div className="nr-sig__initials">
            <label className="nr-sig__label" htmlFor="signature-initials">
              Saisissez vos initiales (2 à 6 lettres)
            </label>
            <input
              id="signature-initials"
              className="nr-sig__input"
              type="text"
              value={initials}
              maxLength={10}
              onChange={(event) => setInitials(event.target.value)}
              placeholder="Ex. TD"
              autoFocus
              disabled={submitting}
            />
            <p className="nr-sig__hint">
              Elles seront enregistrées en majuscules et serviront de signature
              officielle de votre demande.
            </p>
          </div>
        ) : (
          <div className="nr-sig__drawn">
            <p className="nr-sig__label">Dessinez votre signature dans le cadre</p>
            <div
              ref={containerRef}
              className="nr-sig__canvas-wrap"
              role="application"
              aria-label="Zone de signature dessinée"
            >
              <canvas ref={canvasRef} className="nr-sig__canvas" />
            </div>
            <button
              type="button"
              className="nr-btn nr-btn--ghost nr-sig__clear"
              onClick={() => {
                const context = canvasRef.current.getContext('2d')
                context.fillStyle = '#ffffff'
                context.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                setHasDrawing(false)
              }}
              disabled={submitting}
            >
              Effacer
            </button>
            {hasDrawing && (
              <p className="nr-sig__drawn-ok">
                <Icon name="check" size={13} /> Signature capturée
              </p>
            )}
          </div>
        )}

        {error && <p className="nr-sig__error">{error}</p>}

        <div className="nr-modal__footer">
          <button
            type="button"
            className="nr-btn nr-btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="nr-btn nr-btn--primary"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="nr-spinner" /> Soumission…
              </>
            ) : (
              <>
                <Icon name="check" size={16} /> Confirmer et soumettre
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
