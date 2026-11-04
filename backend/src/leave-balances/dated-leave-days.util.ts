/**
 * JUR-027 — E3-B.1A : production fiable et testable des journées datées à
 * décompter pour une demande de congé.
 *
 * Ce composant partagé est la brique préparatoire du raccordement réel :
 *  - réutilise `calculateDeductedLeaveDayList` (moteur pur E1, règles GMES des
 *    dimanches, jours non déductibles, demi-journées, samedi) ;
 *  - vérifie la cohérence avec `deductedDays` et lève une erreur explicite en
 *    cas d'écart (jamais de débit silencieux sur l'ordinaire) ;
 *  - gère les demandes traversant plusieurs mois, périodes et échéances de lots
 *    (chaque journée porte sa date effective, valeur 0.5 ou 1) ;
 *  - n'écrit rien, n'appelle aucun service, ne déclenche aucune notification.
 */
import { BadRequestException } from '@nestjs/common';

import { DayPeriod } from '../leave-requests/leave-request.entity';
import {
  calculateDeductedLeaveDayList,
  DatedLeaveDay,
  sumDatedDays,
} from './carryover-allocation.core';

export interface DatedLeaveDaysInput {
  startDate: string;
  endDate: string;
  startPeriod: DayPeriod;
  endPeriod: DayPeriod;
  /** Dates non déductibles (jours fériés, fermetures) — ex. `HolidaysService`. */
  nonDeductibleDates: ReadonlySet<string>;
  /** `leaveRequest.deductedDays` attendu. */
  expectedDays: number;
}

/**
 * Produit la liste exacte des journées datées à décompter et garantit que leur
 * somme correspond au nombre de jours attendu de la demande.
 *
 * CONTRAT E3-B : `datedDays` sera OBLIGATOIRE dès que la gestion des lots est
 * réellement utilisée. Une donnée manquante/incohérente ne doit jamais aboutir
 * à un débit silencieux uniquement sur les jours ordinaires.
 */
export function buildDatedLeaveDays(
  input: DatedLeaveDaysInput,
): DatedLeaveDay[] {
  const days = calculateDeductedLeaveDayList(
    input.startDate,
    input.endDate,
    input.startPeriod,
    input.endPeriod,
    input.nonDeductibleDates,
  );

  const total = sumDatedDays(days);
  if (Math.abs(total - input.expectedDays) > 0.001) {
    throw new BadRequestException(
      `Quantité incohérente : ${total} jour(s) daté(s) calculé(s) pour ${input.expectedDays} jour(s) attendu(s).`,
    );
  }

  return days;
}
