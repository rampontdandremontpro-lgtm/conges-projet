import { Icon } from '@/components/ui/Icon'

const STATUS_META = {
  BROUILLON: { label: 'Brouillon', tone: 'neutral', icon: 'file' },
  EN_ATTENTE_VALIDATION: { label: 'En attente', tone: 'warning', icon: 'clock' },
  EN_COURS_TRAITEMENT: { label: 'En cours de traitement', tone: 'warning', icon: 'clock' },
  VALIDEE: { label: 'Validée · traitement terminé', tone: 'success', icon: 'check' },
  REFUSEE: { label: 'Refusée', tone: 'danger', icon: 'alert' },
  ANNULEE: { label: 'Annulée', tone: 'neutral', icon: 'clock' },
  ANNULATION_EN_ATTENTE_ACCORD: {
    label: 'Annulation en attente',
    tone: 'warning',
    icon: 'clock',
  },
  ANNULEE_APRES_VALIDATION: {
    label: 'Annulée après validation',
    tone: 'neutral',
    icon: 'clock',
  },
  EXPIREE_NON_VALIDEE: {
    label: 'Expirée non validée',
    tone: 'neutral',
    icon: 'clock',
  },
  DECLAREE: { label: 'Déclarée', tone: 'info', icon: 'clock' },
  JUSTIFICATIF_EN_ATTENTE: {
    label: 'Justificatif en attente',
    tone: 'warning',
    icon: 'file',
  },
  A_VERIFIER_PAR_RH: {
    label: 'À vérifier par RH',
    tone: 'info',
    icon: 'alert',
  },
  JUSTIFICATIF_REJETE: {
    label: 'Justificatif attendu',
    tone: 'warning',
    icon: 'file',
  },
  ENREGISTREE: { label: 'Enregistrée', tone: 'teal', icon: 'check' },
}

export function getRequestStatusLabel(status) {
  return STATUS_META[status]?.label ?? status ?? 'Statut inconnu'
}

export function RequestStatusBadge({ status }) {
  const meta = STATUS_META[status] ?? {
    label: getRequestStatusLabel(status),
    tone: 'neutral',
    icon: 'clock',
  }

  return (
    <span className={`my-requests-status my-requests-status--${meta.tone}`}>
      <Icon name={meta.icon} size={11} />
      <span>{meta.label}</span>
    </span>
  )
}
