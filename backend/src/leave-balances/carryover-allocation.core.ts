/**
 * JUR-027 — Moteur PUR d'allocation des jours reportés (maladie) — partagé.
 *
 * Module métier SANS dépendance base/service/HTTP, réutilisable par les
 * services métier de l'application (et non plus réservé au chemin de recette).
 *
 * Règles préservées :
 *  - ventilation par DATES effectives (jamais la seule date de début) ;
 *  - un lot ne finance que les journées ≤ échéance (`expiresAt`) ;
 *  - FIFO par échéance la plus proche (puis id) ;
 *  - demi-journées (0.5/1) reproduites à l'identique de `calculateDeductedLeaveDays` ;
 *  - jours non couverts → restent « ordinaires » (inchangés) ;
 *  - protections : reliquat inconnu/épuisé, origine non rapprochée, statut non
 *    ACTIF, confirmation EN_ATTENTE, échéance indéfinie → lot non consommé.
 *
 * Aucune écriture en base, aucun compteur modifié, aucune notification.
 */
import { DayPeriod } from '../leave-requests/leave-request.entity';

export interface DatedLeaveDay {
  /** Date ISO YYYY-MM-DD. */
  date: string;
  /** Valeur décomptée : 1 (journée) ou 0.5 (demi-journée). */
  value: number;
}

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Liste datée des jours décomptés (mêmes règles que calculateDeductedLeaveDays). */
export function calculateDeductedLeaveDayList(
  startDate: string,
  endDate: string,
  startPeriod: DayPeriod,
  endPeriod: DayPeriod,
  nonDeductibleDates: ReadonlySet<string>,
): DatedLeaveDay[] {
  const days: DatedLeaveDay[] = [];
  const currentDate = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (currentDate.getTime() <= end.getTime()) {
    const dateValue = currentDate.toISOString().slice(0, 10);
    const isSunday = currentDate.getUTCDay() === 0;
    const isNonDeductible = nonDeductibleDates.has(dateValue);

    if (!isSunday && !isNonDeductible) {
      let value = 1;

      if (
        dateValue === startDate &&
        startPeriod === DayPeriod.APRES_MIDI
      ) {
        value -= 0.5;
      }
      if (
        dateValue === endDate &&
        endPeriod === DayPeriod.MATIN
      ) {
        value -= 0.5;
      }

      days.push({ date: dateValue, value: round2(value) });
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // Règle GMES : fin un vendredi après-midi → le samedi est décompté.
  if (end.getUTCDay() === 5 && endPeriod === DayPeriod.APRES_MIDI) {
    const saturday = new Date(end);
    saturday.setUTCDate(saturday.getUTCDate() + 1);
    const saturdayValue = saturday.toISOString().slice(0, 10);
    if (!nonDeductibleDates.has(saturdayValue)) {
      days.push({ date: saturdayValue, value: 1 });
    }
  }

  // Fin un jeudi après-midi + vendredi non décomptable → samedi décompté.
  if (end.getUTCDay() === 4 && endPeriod === DayPeriod.APRES_MIDI) {
    const friday = new Date(end);
    friday.setUTCDate(friday.getUTCDate() + 1);
    const fridayValue = friday.toISOString().slice(0, 10);
    if (nonDeductibleDates.has(fridayValue)) {
      const saturday = new Date(friday);
      saturday.setUTCDate(saturday.getUTCDate() + 1);
      const saturdayValue = saturday.toISOString().slice(0, 10);
      if (!nonDeductibleDates.has(saturdayValue)) {
        days.push({ date: saturdayValue, value: 1 });
      }
    }
  }

  return days;
}

/** Somme des valeurs décomptées d'une liste de journées datées (arrondie à 2 déc.). */
export function sumDatedDays(days: readonly DatedLeaveDay[]): number {
  return round2(days.reduce((total, day) => total + day.value, 0));
}

/** Lot candidat à la consommation (représentation minimale). */
export interface ConsumableLotInput {
  id: number;
  remainingDays: number | null;
  expiresAt: string | null;
  status: string;
  confirmationStatus: string | null;
  reconciled: boolean | null;
}

export interface LotEligibility {
  consumable: boolean;
  reason: string | null;
}

/**
 * Un lot n'est jamais consommé si son reliquat est inconnu/épuisé, son origine
 * non rapprochée, son statut non ACTIF, sa confirmation encore EN_ATTENTE ou
 * son échéance indéfinie.
 */
export function isLotConsumable(lot: ConsumableLotInput): LotEligibility {
  if (lot.reconciled !== true) {
    return { consumable: false, reason: 'ORIGINE_NON_RAPPROCHEE' };
  }
  if (lot.remainingDays == null) {
    return { consumable: false, reason: 'RELIQUAT_INCONNU' };
  }
  if (round2(Number(lot.remainingDays)) <= 0) {
    return { consumable: false, reason: 'RELIQUAT_EPUISE' };
  }
  if (lot.status !== 'ACTIF') {
    return { consumable: false, reason: `STATUT_${lot.status}` };
  }
  if (lot.confirmationStatus === 'EN_ATTENTE') {
    return { consumable: false, reason: 'CONFIRMATION_EN_ATTENTE' };
  }
  if (!lot.expiresAt) {
    return { consumable: false, reason: 'ECHEANCE_INDEFINIE' };
  }
  return { consumable: true, reason: null };
}

export interface LotAllocation {
  lotId: number;
  dates: DatedLeaveDay[];
  days: number;
}

export interface SkippedLot {
  lotId: number;
  reason: string;
}

export interface CarryoverLotAllocationResult {
  allocations: LotAllocation[];
  /** Jours non couverts par un lot (à financer en jours ordinaires). */
  uncovered: DatedLeaveDay[];
  skipped: SkippedLot[];
  totalLotDays: number;
}

/**
 * Répartit des journées datées sur des lots consommables, FIFO par échéance
 * (puis id). Une journée (ou demi-journée) n'est couverte par un lot que si
 * `date ≤ lot.expiresAt` et que le reliquat le permet.
 */
export function allocateCarryoverLots(
  datedDays: readonly DatedLeaveDay[],
  lots: readonly ConsumableLotInput[],
): CarryoverLotAllocationResult {
  const skipped: SkippedLot[] = [];
  const consumable: ConsumableLotInput[] = [];

  for (const lot of lots) {
    const eligibility = isLotConsumable(lot);
    if (eligibility.consumable) {
      consumable.push(lot);
    } else {
      skipped.push({ lotId: lot.id, reason: eligibility.reason ?? 'INELIGIBLE' });
    }
  }

  consumable.sort((a, b) => {
    const byExpiry = (a.expiresAt as string).localeCompare(b.expiresAt as string);
    return byExpiry !== 0 ? byExpiry : a.id - b.id;
  });

  const remaining = new Map<number, number>();
  for (const lot of consumable) {
    remaining.set(lot.id, round2(Number(lot.remainingDays)));
  }

  const allocationMap = new Map<number, DatedLeaveDay[]>();
  const uncovered: DatedLeaveDay[] = [];

  for (const day of datedDays) {
    let dayRemaining = round2(day.value);

    for (const lot of consumable) {
      if (dayRemaining <= 0) break;
      if (day.date > (lot.expiresAt as string)) continue;

      const lotRemaining = remaining.get(lot.id) ?? 0;
      if (lotRemaining <= 0) continue;

      const take = round2(Math.min(dayRemaining, lotRemaining));
      remaining.set(lot.id, round2(lotRemaining - take));

      const list = allocationMap.get(lot.id) ?? [];
      list.push({ date: day.date, value: take });
      allocationMap.set(lot.id, list);

      dayRemaining = round2(dayRemaining - take);
    }

    if (dayRemaining > 0) {
      uncovered.push({ date: day.date, value: dayRemaining });
    }
  }

  const allocations: LotAllocation[] = [];
  let totalLotDays = 0;
  for (const lot of consumable) {
    const dates = allocationMap.get(lot.id);
    if (!dates || dates.length === 0) continue;
    const days = round2(dates.reduce((sum, d) => sum + d.value, 0));
    allocations.push({ lotId: lot.id, dates, days });
    totalLotDays = round2(totalLotDays + days);
  }

  return { allocations, uncovered, skipped, totalLotDays };
}
