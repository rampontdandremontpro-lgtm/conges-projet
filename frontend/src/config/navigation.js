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
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
    { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list' },
    { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar' },
    { id: 'my-documents', label: 'Mes documents', to: '/app/my-documents', icon: 'doc' },
    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
  ],
  [ROLES.RESPONSABLE_SERVICE]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
    { id: 'requests', label: 'Demandes à traiter', to: '/app/requests', icon: 'list' },
    { id: 'alerts', label: 'Alertes de chevauchement', to: '/app/alerts', icon: 'alert' },
    { id: 'service-presence', label: 'Présence du service', to: '/app/service-presence', icon: 'users' },
    { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list' },
    { id: 'my-balance', label: 'Mon solde', to: '/app/my-balance', icon: 'wallet' },
    { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar' },
    { id: 'my-documents', label: 'Mes documents', to: '/app/my-documents', icon: 'doc' },
    { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
  ],
  [ROLES.RH]: [
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard', group: 'DEMANDES' },
    { id: 'rh-all-requests', label: 'Toutes les demandes', to: '/app/rh-all-requests', icon: 'doc', group: 'DEMANDES' },
    { id: 'rh-requests', label: 'Demandes à traiter', to: '/app/rh-requests', icon: 'clock', group: 'DEMANDES' },
    { id: 'rh-absences', label: 'Déclarations d’absence', to: '/app/rh-absences', icon: 'calendar', group: 'DEMANDES' },
    { id: 'rh-justificatifs', label: 'Justificatifs à vérifier', to: '/app/rh-justificatifs', icon: 'file', group: 'DEMANDES' },
    { id: 'rh-derogations', label: 'Dérogations', to: '/app/rh-derogations', icon: 'shield', group: 'DEMANDES' },

    { id: 'rh-authorized-absences', label: 'Absences autorisées', to: '/app/rh-authorized-absences', icon: 'check', group: 'ADMINISTRATION' },
    { id: 'rh-balances', label: 'Soldes collaborateurs', to: '/app/rh-balances', icon: 'wallet', group: 'ADMINISTRATION' },
    { id: 'rh-balance-movements', label: 'Mouvements et corrections', to: '/app/rh-balance-movements', icon: 'refresh', group: 'ADMINISTRATION' },

    { id: 'rh-leave-types', label: 'Types de congés/absences', to: '/app/rh-leave-types', icon: 'file', group: 'PARAMÉTRAGE' },
    { id: 'rh-holidays', label: 'Jours fériés et fermetures', to: '/app/rh-holidays', icon: 'calendar', group: 'PARAMÉTRAGE' },
    { id: 'rh-summer-period', label: 'Période estivale', to: '/app/rh-summer-period', icon: 'sun', group: 'PARAMÉTRAGE' },
    { id: 'rh-validators', label: 'Valideurs et remplacements', to: '/app/rh-validators', icon: 'users', group: 'PARAMÉTRAGE' },

    { id: 'rh-alerts', label: 'Alertes', to: '/app/rh-alerts', icon: 'alert', group: 'OUTILS' },
    { id: 'rh-exports', label: 'Exports', to: '/app/rh-exports', icon: 'download', group: 'OUTILS' },
    { id: 'rh-pdf-documents', label: 'Documents PDF', to: '/app/rh-pdf-documents', icon: 'doc', group: 'OUTILS' },
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
