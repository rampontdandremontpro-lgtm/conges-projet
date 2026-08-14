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
    { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
    { id: 'rh-requests', label: 'Demandes', to: '/app/rh-requests', icon: 'list' },
    { id: 'absences', label: 'Absences', to: '/app/absences', icon: 'calendar' },
    { id: 'derogations', label: 'Dérogations', to: '/app/derogations', icon: 'alert' },
    { id: 'balances', label: 'Soldes', to: '/app/balances', icon: 'wallet' },
    { id: 'validators', label: 'Valideurs & remplacements', to: '/app/validators', icon: 'shield' },
    { id: 'rh-settings', label: 'Paramétrage RH', to: '/app/rh-settings', icon: 'settings' },
    { id: 'documents-exports', label: 'Documents & exports', to: '/app/documents-exports', icon: 'doc' },
    { id: 'notifications', label: 'Notifications & alertes', to: '/app/notifications', icon: 'bell' },
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
