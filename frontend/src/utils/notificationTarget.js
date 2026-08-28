function normalizedRole(role = '') {
  return String(role).toUpperCase()
}

export function getNotificationTarget(item, effectiveRole, actualRole = effectiveRole) {
  if (!item) return null
  const role = normalizedRole(effectiveRole)
  const accountRole = normalizedRole(actualRole)
  const type = String(item.type ?? '').toUpperCase()

  if (type === 'LEAVE_REQUEST_PREPARED_BY_RH' && item.leaveRequestId) {
    return `/app/new-request/${item.leaveRequestId}`
  }

  if (item.derogationId) {
    if (accountRole === 'RH') return '/app/rh-derogations'
    if (accountRole === 'DIRECTEUR') return '/app/director-derogations'
    return '/app/my-requests'
  }

  if (item.absenceDeclarationId) {
    if (accountRole === 'RH') return '/app/rh-leaves-absences'
    if (accountRole === 'DIRECTEUR') return '/app/director-presence'
    if (accountRole === 'RESPONSABLE_SERVICE' && role !== 'COLLABORATEUR') return '/app/service-presence'
    return `/app/my-requests/absence/${item.absenceDeclarationId}`
  }

  if (item.leaveRequestId) {
    if (role === 'COLLABORATEUR') return `/app/my-requests/leave/${item.leaveRequestId}`
    if (accountRole === 'RH') return `/app/rh-all-requests/${item.leaveRequestId}`
    if (accountRole === 'DIRECTEUR') return `/app/director-all-requests/${item.leaveRequestId}`
    if (accountRole === 'RESPONSABLE_SERVICE') return `/app/requests/${item.leaveRequestId}`
    return '/app/my-requests'
  }

  if (type.includes('BALANCE') || type.includes('SOLDE') || type.includes('CARRYOVER')) {
    return role === 'COLLABORATEUR' ? '/app/my-balance' : accountRole === 'RH' ? '/app/rh-balances' : '/app/dashboard'
  }

  if (type.includes('DOCUMENT') || type.includes('JUSTIFICATIF')) {
    return accountRole === 'RH' ? '/app/rh-pdf-documents' : '/app/my-documents'
  }

  if (type.includes('HOLIDAY') || type.includes('FERMETURE') || type.includes('FERIE')) {
    if (accountRole === 'ADMIN') return '/app/admin-holidays'
    if (accountRole === 'RH') return '/app/rh-holidays'
  }

  return null
}
