/**
 * JUR-027 — Répartition des jours ORDINAIRES après couverture par les lots.
 *
 * Reproduit les protections validées en L4 :
 *  - un compteur N-1 ne peut pas être consommé en jours ordinaires au-delà de
 *    `availableDays − reservedDays − protégés(lots) − gelés` ;
 *  - un compteur dont le reliquat de lots est INCERTAIN (remaining_days NULL)
 *    n'est jamais utilisé en jours ordinaires ;
 *  - les compteurs N-1 sont parcourus par période croissante (les plus anciens
 *    d'abord), puis le compteur N ;
 *  - si l'ordinaire est insuffisant, une erreur est levée (jamais d'allocation
 *    partielle silencieuse).
 */
import { BadRequestException } from '@nestjs/common';

export interface OrdinaryBalanceInput {
  id: number;
  availableDays: number;
  reservedDays: number;
}

export interface OrdinaryAllocation {
  balanceId: number;
  days: number;
}

const round = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function allocateOrdinaryDays(
  uncovered: number,
  nMinus1Balances: OrdinaryBalanceInput[],
  nBalance: OrdinaryBalanceInput,
  protectedByBalance: ReadonlyMap<number, number>,
  ambiguousByBalance: ReadonlySet<number>,
  frozenByBalance: ReadonlyMap<number, number>,
): OrdinaryAllocation[] {
  const allocations: OrdinaryAllocation[] = [];
  let remaining = round(uncovered);

  const sortedPrevious = [...nMinus1Balances].sort((a, b) => a.id - b.id);
  for (const balance of sortedPrevious) {
    if (remaining <= 0) break;
    if (ambiguousByBalance.has(balance.id)) continue;
    const protectedDays = protectedByBalance.get(balance.id) ?? 0;
    const frozenDays = frozenByBalance.get(balance.id) ?? 0;
    const capacity = round(
      Number(balance.availableDays) -
        Number(balance.reservedDays) -
        protectedDays -
        frozenDays,
    );
    if (capacity <= 0) continue;
    const take = round(Math.min(capacity, remaining));
    allocations.push({ balanceId: balance.id, days: take });
    remaining = round(remaining - take);
  }

  if (remaining > 0) {
    const nCapacity = round(
      Number(nBalance.availableDays) -
        Number(nBalance.reservedDays) -
        (frozenByBalance.get(nBalance.id) ?? 0),
    );
    if (remaining > nCapacity) {
      throw new BadRequestException(
        'Solde ordinaire insuffisant ou indéterminable (jours protégés, réservés, gelés ou à vérifier). Vérification RH requise.',
      );
    }
    allocations.push({ balanceId: nBalance.id, days: remaining });
  }

  return allocations;
}
