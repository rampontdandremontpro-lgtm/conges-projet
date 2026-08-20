import { Icon } from '@/components/ui/Icon'
import { useAutoDismiss } from '@/hooks/useAutoDismiss'

export function Toast({ kind = 'info', message, onClose, duration = 5000 }) {
  useAutoDismiss(message, onClose, { delay: duration, clearValue: undefined, enabled: Boolean(onClose) })

  if (!message) {
    return null
  }

  const iconName =
    kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'clock'

  return (
    <div
      className={`nr-toast nr-toast--${kind}`}
      role="status"
      aria-live="polite"
    >
      <span className="nr-toast__icon">
        <Icon name={iconName} size={16} />
      </span>
      <span className="nr-toast__message">{message}</span>
      <button
        type="button"
        className="nr-toast__close"
        onClick={onClose}
        aria-label="Fermer la notification"
      >
        ×
      </button>
    </div>
  )
}
