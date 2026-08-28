const RH_RESETTABLE_ROLES = new Set([
  'COLLABORATEUR',
  'RESPONSABLE_SERVICE',
]);

export function canRhResetPassword(role: string): boolean {
  return RH_RESETTABLE_ROLES.has(role);
}
