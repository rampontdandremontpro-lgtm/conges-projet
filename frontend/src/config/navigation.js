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
    { id: 'requests', label: 'Demandes à traiter', to: '/app/requests', icon: 'list', group: 'ÉQUIPE' },
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
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
    { id: 'requests', label: 'Demandes', to: '/app/requests', icon: 'list' },
    { id: 'alerts', label: 'Alertes', to: '/app/alerts', icon: 'alert' },
    { id: 'my-leaves', label: 'Enregistrer mes congés/absences', to: '/app/my-leaves', icon: 'calendar' },
    { id: 'statistics', label: 'Statistiques & exports', to: '/app/statistics', icon: 'chart' },
    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
  ],
  [ROLES.ADMIN]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
    { id: 'organisation', label: 'Organisation', to: '/app/organisation', icon: 'building' },
    { id: 'configuration', label: 'Configuration', to: '/app/configuration', icon: 'settings' },
    { id: 'calendar', label: 'Calendrier', to: '/app/calendar', icon: 'calendar' },
    { id: 'system', label: 'Système', to: '/app/system', icon: 'cpu' },
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
