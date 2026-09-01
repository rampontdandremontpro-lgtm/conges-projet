function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

export function isExternalService(service) {
  return Boolean(service && (service.serviceType === 'EXTERNE' || service.externalCompanyName))
}

export function buildGroupedServiceOptions(services = []) {
  const internal = services
    .filter((service) => service?.id && service?.name && !isExternalService(service))
    .map((service) => ({ value: String(service.id), label: String(service.name) }))
    .sort((left, right) => left.label.localeCompare(right.label, 'fr'))

  if (services.some((service) => service?.id && isExternalService(service))) {
    internal.push({ value: 'external', label: 'Mis à disposition' })
  }

  return internal
}

export function matchesGroupedServiceFilter(serviceId, filterValue, externalServiceIds = new Set()) {
  if (filterValue === 'all' || filterValue === 'ALL') return true
  if (filterValue === 'external') return externalServiceIds.has(String(serviceId ?? ''))
  return String(serviceId ?? '') === String(filterValue)
}

export function isReservedDirectorLeaveType(type) {
  if (!type || type.category !== 'DEMANDE_CONGE') return false
  return normalizeLabel(type.name) === 'conge'
}
