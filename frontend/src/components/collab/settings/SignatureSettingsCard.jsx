import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'

const INITIALS_PATTERN = /^[\p{L}.\-\s]+$/u

function initialsValid(value) {
  const letters = (value.match(/\p{L}/gu) ?? []).length
  return letters >= 2 && letters <= 6 && INITIALS_PATTERN.test(value)
}

function SignaturePreview({ signature }) {
  if (!signature?.configured) return null

  return (
    <div className="settings-signature-preview">
      <div className="settings-signature-preview__paper">
        {signature.signatureType === 'DRAWN' ? (
          <img src={signature.signatureData} alt="Signature enregistrée" />
        ) : (
          <span>{signature.signatureData}</span>
        )}
      </div>
      <div className="settings-signature-preview__meta">
        <strong>{signature.signatureType === 'DRAWN' ? 'Signature dessinée' : 'Initiales'}</strong>
        <span>
          {signature.updatedAt
            ? `Mise à jour le ${new Date(signature.updatedAt).toLocaleDateString('fr-FR')}`
            : 'Signature enregistrée'}
        </span>
      </div>
    </div>
  )
}

export function SignatureSettingsCard({ signature, loading, saving, onSave, onDelete }) {
  const [editing, setEditing] = useState(() => !signature?.configured)
  const [mode, setMode] = useState('INITIALS')
  const [initials, setInitials] = useState('')
  const [hasDrawing, setHasDrawing] = useState(false)
  const [localError, setLocalError] = useState(null)
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const canvasSizeRef = useRef({ width: 0, height: 0 })

  useAutoDismiss(localError, setLocalError)

  useEffect(() => {
    if (!signature?.configured) {
      setEditing(true)
      return
    }
    setEditing(false)
    setMode(signature.signatureType === 'INITIALS' ? 'INITIALS' : 'DRAWN')
    setInitials(signature.signatureType === 'INITIALS' ? signature.signatureData ?? '' : '')
  }, [signature])

  useEffect(() => {
    if (!editing || mode !== 'DRAWN' || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    canvasSizeRef.current = { width: rect.width, height: rect.height }
    const context = canvas.getContext('2d')
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, rect.width, rect.height)
    context.strokeStyle = '#0a55b0'
    context.lineWidth = 2.4
    context.lineCap = 'round'
    context.lineJoin = 'round'
    drawingRef.current = false
    setHasDrawing(false)
  }, [editing, mode])

  const pointerPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handlePointerDown = (event) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const context = canvasRef.current.getContext('2d')
    const position = pointerPosition(event)
    context.beginPath()
    context.moveTo(position.x, position.y)
    drawingRef.current = true
  }

  const handlePointerMove = (event) => {
    if (!drawingRef.current) return
    event.preventDefault()
    const context = canvasRef.current.getContext('2d')
    const position = pointerPosition(event)
    context.lineTo(position.x, position.y)
    context.stroke()
  }

  const handlePointerUp = () => {
    if (drawingRef.current) {
      drawingRef.current = false
      setHasDrawing(true)
    }
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    const { width, height } = canvasSizeRef.current
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    setHasDrawing(false)
  }

  const handleSave = async () => {
    setLocalError(null)
    if (mode === 'INITIALS') {
      if (!initialsValid(initials.trim())) {
        setLocalError('Les initiales doivent contenir entre 2 et 6 lettres.')
        return
      }
      await onSave({
        signatureType: 'INITIALS',
        signatureData: initials.trim().toUpperCase(),
      })
      return
    }

    if (!hasDrawing || !canvasRef.current) {
      setLocalError('Dessinez votre signature dans le cadre avant de l’enregistrer.')
      return
    }

    await onSave({
      signatureType: 'DRAWN',
      signatureData: canvasRef.current.toDataURL('image/png'),
    })
  }

  return (
    <section className="settings-card">
      <div className="settings-card__heading">
        <span className="settings-card__icon settings-card__icon--signature">
          <Icon name="file" size={19} />
        </span>
        <div>
          <h2>Signature électronique</h2>
          <p>Enregistrez une signature pour pouvoir la réutiliser lors de vos demandes de congé.</p>
        </div>
        {!loading && signature?.configured && (
          <span className="settings-card__status settings-card__status--success">
            <Icon name="check" size={13} /> Configurée
          </span>
        )}
      </div>

      {loading ? (
        <div className="settings-skeleton settings-skeleton--signature" />
      ) : !editing && signature?.configured ? (
        <>
          <SignaturePreview signature={signature} />
          <div className="settings-actions">
            <button type="button" className="settings-btn settings-btn--secondary" onClick={() => setEditing(true)}>
              Modifier la signature
            </button>
            <button type="button" className="settings-btn settings-btn--danger" onClick={onDelete} disabled={saving}>
              <Icon name="trash" size={15} /> Supprimer
            </button>
          </div>
        </>
      ) : (
        <div className="settings-signature-editor">
          <div className="settings-tabs" role="tablist" aria-label="Type de signature">
            <button
              type="button"
              className={`settings-tab${mode === 'INITIALS' ? ' is-active' : ''}`}
              onClick={() => setMode('INITIALS')}
            >
              Initiales
            </button>
            <button
              type="button"
              className={`settings-tab${mode === 'DRAWN' ? ' is-active' : ''}`}
              onClick={() => setMode('DRAWN')}
            >
              Signature dessinée
            </button>
          </div>

          {mode === 'INITIALS' ? (
            <div className="settings-field">
              <label htmlFor="settings-signature-initials">Vos initiales</label>
              <input
                id="settings-signature-initials"
                type="text"
                value={initials}
                maxLength={10}
                onChange={(event) => setInitials(event.target.value)}
                placeholder="Ex. TD"
              />
              <small>Entre 2 et 6 lettres. Elles seront enregistrées en majuscules.</small>
            </div>
          ) : (
            <div className="settings-drawn">
              <span className="settings-field__label">Dessinez votre signature</span>
              <canvas
                ref={canvasRef}
                className="settings-drawn__canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
                aria-label="Zone de signature dessinée"
              />
              <button type="button" className="settings-link-button" onClick={clearCanvas}>Effacer le tracé</button>
            </div>
          )}

          {localError && <p className="settings-inline-error">{localError}</p>}

          <div className="settings-actions">
            {signature?.configured && (
              <button type="button" className="settings-btn settings-btn--ghost" onClick={() => setEditing(false)} disabled={saving}>
                Annuler
              </button>
            )}
            <button type="button" className="settings-btn settings-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer la signature'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
