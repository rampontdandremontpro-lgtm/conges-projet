/**
 * JUR-019 / JUR-020 — Congés supplémentaires d'ancienneté (Syntec IDCC 1486, art. 5.1).
 *
 * Règle de paliers (totaux, non cumulatifs) :
 *   - ancienneté < 5 ans   → 0 jour ouvré supplémentaire ;
 *   - à partir de 5 ans    → 1 jour ouvré ;
 *   - à partir de 10 ans   → 2 jours ouvrés ;
 *   - à partir de 15 ans   → 3 jours ouvrés ;
 *   - à partir de 20 ans   → 4 jours ouvrés.
 *
 * Ancienneté appréciée à l'OUVERTURE de la période de prise des congés
 * (1er mai à défaut de stipulation différente) : `referenceDate` est fourni
 * par l'appelant. La fonction calcule les ANNÉES RÉVOLUES entre la date
 * d'embauche et cette date de référence.
 *
 * Cette fonction est un OUTIL DE RÉFÉRENCE testé : elle n'attribue AUCUN jour
 * automatiquement (aucune écriture en base). L'attribution reste un acte RH
 * manuel et tracé (correction de solde) tant que l'applicabilité de la
 * convention Syntec à l'entité n'est pas confirmée.
 */

/** Nombre d'années révolues entre `start` (embauche) et `reference` (ex. 1er mai). */
export function fullYearsBetween(start: string, reference: string): number {
  const s = parseIsoDate(start);
  const r = parseIsoDate(reference);
  let years = r.getUTCFullYear() - s.getUTCFullYear();
  const anniversaryPassed =
    r.getUTCMonth() > s.getUTCMonth() ||
    (r.getUTCMonth() === s.getUTCMonth() && r.getUTCDate() >= s.getUTCDate());
  if (!anniversaryPassed) {
    years -= 1;
  }
  return Math.max(0, years);
}

export interface SeniorityThreshold {
  minYears: number;
  extraDays: number;
}

/** Paliers Syntec 5.1 (référence, remplaçables par la configuration RH). */
export const SYNTEC_SENIORITY_THRESHOLDS: SeniorityThreshold[] = [
  { minYears: 5, extraDays: 1 },
  { minYears: 10, extraDays: 2 },
  { minYears: 15, extraDays: 3 },
  { minYears: 20, extraDays: 4 },
];

/**
 * Jours supplémentaires d'ancienneté selon des paliers configurables
 * (totaux, non cumulatifs). Le palier retenu est le plus élevé dont
 * `minYears` est atteint par l'ancienneté révolue.
 */
export function seniorityExtraDays(
  hireDate: string,
  referenceDate: string,
  thresholds: readonly SeniorityThreshold[],
): number {
  const years = fullYearsBetween(hireDate, referenceDate);
  const sorted = [...thresholds].sort((a, b) => a.minYears - b.minYears);
  const matched = sorted.reduce<SeniorityThreshold | null>((best, item) => {
    if (years >= item.minYears && (!best || item.minYears > best.minYears)) {
      return item;
    }
    return best;
  }, null);
  return matched?.extraDays ?? 0;
}

/** Jours ouvrés supplémentaires Syntec 5.1 selon l'ancienneté révolue. */
export function syntecSeniorityExtraDays(
  hireDate: string,
  referenceDate: string,
): number {
  return seniorityExtraDays(hireDate, referenceDate, SYNTEC_SENIORITY_THRESHOLDS);
}

function parseIsoDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Date invalide : ${value}`);
  }
  return d;
}
