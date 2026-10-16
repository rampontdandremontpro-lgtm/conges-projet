export function roundPeriodCloseDays(value: number): number {
  const roundedToHundredth = Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
  if (roundedToHundredth <= 0) return 0;
  return Math.round(roundedToHundredth);
}

/**
 * Plafond légal des congés payés de base pour une période complète
 * (Code du travail, art. L3141-3) : 30 jours ouvrables.
 */
export const MAX_BASE_OUVRABLE_DAYS = 30;

/**
 * Arrondi légal du DROIT ACQUIS (Code du travail, art. L3141-7) : lorsqu'un
 * droit définitif exprimé en jours ouvrables comporte une fraction de jour, il
 * est porté à l'entier immédiatement supérieur, sans dépasser le plafond légal
 * de 30 jours ouvrables pour les congés de base.
 *
 * À n'utiliser que pour le droit ACQUIS définitif (acquiredDays), jamais pour
 * le solde restant après consommation (availableDays).
 */
export function roundAcquiredDaysUp(value: number): number {
  const rounded = Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
  if (rounded <= 0) return 0;
  return Math.min(Math.ceil(rounded), MAX_BASE_OUVRABLE_DAYS);
}
