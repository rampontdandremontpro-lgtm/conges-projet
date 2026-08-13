import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/Icon'

export function ManagerRefusalModal({ open, employeeName, submitting, onClose, onConfirm }) {
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) setComment('')
  }, [open])

  if (!open) return null

  return (
    <div className="manager-decision-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="manager-decision-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Refuser la demande"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="manager-decision-modal__header">
          <div>
            <h3>Refuser la demande</h3>
            <p>{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Fermer">×</button>
        </div>

        <label className="manager-decision-modal__label" htmlFor="manager-refusal-comment">
          Motif du refus <span>(facultatif)</span>
        </label>
        <textarea
          id="manager-refusal-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Expliquez brièvement la raison du refus…"
          disabled={submitting}
        />

        <div className="manager-decision-modal__footer">
          <button type="button" className="manager-decision-btn manager-decision-btn--ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="button"
            className="manager-decision-btn manager-decision-btn--danger"
            onClick={() => onConfirm(comment.trim())}
            disabled={submitting}
          >
            <Icon name="alert" size={15} />
            {submitting ? 'Refus…' : 'Confirmer le refus'}
          </button>
        </div>
      </div>
    </div>
  )
}
