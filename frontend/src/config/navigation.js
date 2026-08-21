export const ROLES = {
  COLLABORATEUR: 'COLLABORATEUR',
  RESPONSABLE_SERVICE: 'RESPONSABLE_SERVICE',
  RH: 'RH',
  DIRECTEUR: 'DIRECTEUR',
  ADMIN: 'ADMIN',
}

export const NEW_REQUEST_ROLES = [ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]

export const NEW_REQUEST_ITEM = {
  id: 'new-request',
  label: 'Nouvelle demande',
  to: '/app/new-request',
  icon: 'plus',
}

export const ROLE_LABELS = {
  [ROLES.COLLABORATEUR]: 'Collaborateur',
  [ROLES.RESPONSABLE_SERVICE]: 'Responsable de service',
  [ROLES.RH]: 'RH',
  [ROLES.DIRECTEUR]: 'Directeur',
  [ROLES.ADMIN]: 'Administrateur',
}

export const NAVIGATION = {
  [ROLES.COLLABORATEUR]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'MON ESPACE' },
    { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list', group: 'MON ESPACE' },
    { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar', group: 'MON ESPACE' },
    { id: 'my-documents', label: 'Mes documents', to: '/app/my-documents', icon: 'doc', group: 'MON ESPACE' },
    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell', group: 'OUTIL' },
  ],
  [ROLES.RESPONSABLE_SERVICE]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'ÉQUIPE' },
    { id: 'requests', label: 'Demandes', to: '/app/requests', icon: 'list', group: 'ÉQUIPE' },
    { id: 'alerts', label: 'Alertes de chevauchement', to: '/app/alerts', icon: 'alert', group: 'ÉQUIPE' },
    { id: 'service-presence', label: 'Présence du service', to: '/app/service-presence', icon: 'users', group: 'ÉQUIPE' },

    { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list', group: 'MON ESPACE' },
    { id: 'my-balance', label: 'Mon solde', to: '/app/my-balance', icon: 'wallet', group: 'MON ESPACE' },
    { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar', group: 'MON ESPACE' },
    { id: 'my-documents', label: 'Mes documents', to: '/app/my-documents', icon: 'doc', group: 'MON ESPACE' },

    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell', group: 'OUTIL' },
  ],
  [ROLES.RH]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'DEMANDES' },
    { id: 'rh-all-requests', label: 'Toutes les demandes', to: '/app/rh-all-requests', icon: 'doc', group: 'DEMANDES' },
    { id: 'rh-absences', label: 'Absences', to: '/app/rh-absences', icon: 'calendar', group: 'DEMANDES' },
    { id: 'rh-derogations', label: 'Dérogations', to: '/app/rh-derogations', icon: 'shield', group: 'DEMANDES' },

    { id: 'rh-balances', label: 'Soldes collaborateurs', to: '/app/rh-balances', icon: 'wallet', group: 'ADMINISTRATION' },
    { id: 'rh-statistics', label: 'Statistiques', to: '/app/rh-statistics', icon: 'chart', group: 'ADMINISTRATION' },
    { id: 'rh-exports', label: 'Exports', to: '/app/rh-exports', icon: 'download', group: 'ADMINISTRATION' },
    { id: 'rh-pdf-documents', label: 'Documents', to: '/app/rh-pdf-documents', icon: 'doc', group: 'ADMINISTRATION' },

    { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list', group: 'MON ESPACE' },
    { id: 'my-balance', label: 'Mon solde', to: '/app/my-balance', icon: 'wallet', group: 'MON ESPACE' },
    { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar', group: 'MON ESPACE' },
    { id: 'my-documents', label: 'Mes documents', to: '/app/my-documents', icon: 'doc', group: 'MON ESPACE' },

    { id: 'rh-leave-types', label: 'Types de congés/absences', to: '/app/rh-leave-types', icon: 'file', group: 'PARAMÉTRAGE' },
    { id: 'rh-holidays', label: 'Jours fériés et fermetures', to: '/app/rh-holidays', icon: 'calendar', group: 'PARAMÉTRAGE' },
    { id: 'rh-summer-period', label: 'Période estivale', to: '/app/rh-summer-period', icon: 'sun', group: 'PARAMÉTRAGE' },
    { id: 'rh-validators', label: 'Valideurs', to: '/app/rh-validators', icon: 'users', group: 'PARAMÉTRAGE' },

    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell', group: 'OUTILS' },
  ],
  [ROLES.DIRECTEUR]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'DÉCISION' },
    { id: 'director-all-requests', label: 'Toutes les demandes', to: '/app/director-all-requests', icon: 'doc', group: 'DÉCISION' },
    { id: 'director-derogations', label: 'Dérogations', to: '/app/director-derogations', icon: 'shield', group: 'DÉCISION' },

    { id: 'director-presence', label: 'Présence globale', to: '/app/director-presence', icon: 'users', group: 'PILOTAGE' },
    { id: 'director-statistics', label: 'Statistiques', to: '/app/director-statistics', icon: 'chart', group: 'PILOTAGE' },
    { id: 'director-exports', label: 'Exports', to: '/app/director-exports', icon: 'download', group: 'PILOTAGE' },

    { id: 'director-availability', label: 'Enregistrer mon indisponibilité', to: '/app/director-availability', icon: 'calendar', group: 'MON STATUT' },
    { id: 'director-unavailability', label: 'Mes indisponibilités', to: '/app/director-unavailability', icon: 'list', group: 'MON STATUT' },

    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell', group: 'OUTILS' },
  ],
  [ROLES.ADMIN]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'PRINCIPAL' },

    { id: 'admin-users', label: 'Utilisateurs', to: '/app/admin-users', icon: 'users', group: 'GESTION' },
    { id: 'admin-services', label: 'Services', to: '/app/admin-services', icon: 'building', group: 'GESTION' },
    { id: 'admin-validators', label: 'Valideurs', to: '/app/admin-validators', icon: 'shield', group: 'GESTION' },

    { id: 'admin-leave-types', label: 'Types de congés / absences', to: '/app/admin-leave-types', icon: 'file', group: 'PARAMÉTRAGE' },
    { id: 'admin-minimum-presence', label: 'Présence minimale', to: '/app/admin-minimum-presence', icon: 'chart', group: 'PARAMÉTRAGE' },
    { id: 'admin-summer-period', label: 'Période estivale', to: '/app/admin-summer-period', icon: 'sun', group: 'PARAMÉTRAGE' },
    { id: 'admin-holidays', label: 'Jours fériés / fermetures', to: '/app/admin-holidays', icon: 'calendar', group: 'PARAMÉTRAGE' },

    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell', group: 'OUTILS' },
    { id: 'admin-technical-logs', label: 'Journaux techniques', to: '/app/admin-technical-logs', icon: 'cpu', group: 'OUTILS' },
  ],
}

export function getNavigationForRole(role) {
  return NAVIGATION[role] ?? NAVIGATION[ROLES.COLLABORATEUR]
}

export function getSectionLabel(section) {
  for (const role of Object.values(ROLES)) {
    const match = NAVIGATION[role].find((item) => item.id === section)
    if (match) {
      return match.label
    }
  }
  return null
}
