import { EntityManager } from 'typeorm';

import { BalanceMovement, BalanceMovementType } from '../balance-movement.entity';
import { LeaveBalance, LeaveBalanceCounterType } from '../leave-balance.entity';
import {
  CarryoverLot,
  CarryoverLotStatus,
  CarryoverLotTargetCounter,
} from '../carryover-lot.entity';
import {
  CarryoverLotAllocation,
  CarryoverLotAllocationOperation,
} from './carryover-lot-allocation.entity';
import { computeLotExpiry } from './carryover-lots.service';
import { nextReferencePeriod } from '../reference-period.util';

export const round2 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export interface CarryoverLotCounterPlan {
  employeeId: number;
  balanceId: number;
  referencePeriod: string;
  availableDays: number;
  reservedDays: number;
  protectedDays: number;
  expiredDays: number;
  frozenDays: number;
  ordinaryDays: number;
  unknownReliquat: boolean;
  toReviewLots: number[];
  preservedLots: number[];
  expiredLots: number[];
}

export interface CarryoverLotPlan {
  counters: CarryoverLotCounterPlan[];
  blocked: boolean;
  reasons: string[];
}

/**
 * Classification d'un lot via le moteur L2.
 * - `expired` : l'échéance est juridiquement confirmée EXPIRE par L2 ;
 * - `uncertain` : dossier incomplet (A_VERIFIER, SUSPENDU, EN_ATTENTE) — la
 *   clôture doit être bloquée tant que la situation n'est pas résolue.
 */
export function classifyCarryoverLot(
  lot: CarryoverLot,
): { expired: boolean; uncertain: boolean } {
  const computed = computeLotExpiry({
    regime: lot.regime === 'ARRET_LONG' ? 'ARRET_LONG' : 'GENERAL',
    referencePeriodEnd: lot.referencePeriodEndDate ?? null,
    absenceStatus:
      (lot.absenceStatus as 'ABSENT' | 'REPRIS' | 'INCONNU' | null) ?? null,
    repriseDate: lot.repriseDate ?? null,
    informationDate: lot.informationDate ?? null,
    informationDateCertain: lot.informationDateCertain ?? null,
    acquiredDuringL3141_5_5or7: lot.acquiredDuringL3141_5_5or7 ?? null,
    suspensionAtLeastOneYearAtPeriodEnd:
      lot.suspensionAtLeastOneYearAtPeriodEnd ?? null,
  });
  const engineStatus = computed.engine.status;
  return {
    expired: engineStatus === 'EXPIRE',
    uncertain:
      engineStatus === 'A_VERIFIER' ||
      engineStatus === 'SUSPENDU' ||
      lot.confirmationStatus === 'EN_ATTENTE',
  };
}

/**
 * Construit le plan de traitement des lots maladie pour une période, sur le
 * `manager` fourni (même transaction que la clôture normale). Aucune écriture.
 *
 * Bloque (sans aucune remise à zéro) si :
 * - un lot a un reliquat inconnu ;
 * - un lot a une échéance incertaine (dossier incomplet) ;
 * - des jours sont gelés en régularisation (`frozen_in_balance`) ;
 * - des jours sont réservés ;
 * - la comptabilité N-1 est incohérente.
 */
export async function buildCarryoverLotPlan(
  manager: EntityManager,
  referencePeriod: string,
  lock = false,
): Promise<CarryoverLotPlan> {
  let balanceQuery = manager
    .getRepository(LeaveBalance)
    .createQueryBuilder('balance')
    .where('balance.referencePeriod = :period', { period: referencePeriod })
    .andWhere('balance.counterType = :counter', {
      counter: LeaveBalanceCounterType.N_MINUS_1,
    })
    .orderBy('balance.employeeId', 'ASC')
    .addOrderBy('balance.id', 'ASC');
  if (lock) balanceQuery = balanceQuery.setLock('pessimistic_write');
  const balances = await balanceQuery.getMany();

  const counters: CarryoverLotCounterPlan[] = [];
  const reasons: string[] = [];

  for (const balance of balances) {
    let lotQuery = manager
      .getRepository(CarryoverLot)
      .createQueryBuilder('lot')
      .where('lot.employeeId = :employeeId', { employeeId: balance.employeeId })
      .andWhere('lot.targetReferencePeriod = :period', { period: referencePeriod })
      .andWhere('lot.targetCounterType = :counter', {
        counter: CarryoverLotTargetCounter.N_MINUS_1,
      });
    if (lock) lotQuery = lotQuery.setLock('pessimistic_write');
    const lots = await lotQuery.getMany();

    let protectedDays = 0;
    let expiredDays = 0;
    let unknownReliquat = false;
    const toReviewLots: number[] = [];
    const preservedLots: number[] = [];
    const expiredLots: number[] = [];

    for (const lot of lots) {
      if (lot.remainingDays == null) {
        unknownReliquat = true;
        reasons.push(
          `Salarié #${balance.employeeId} : lot #${lot.id} au reliquat inconnu — vérification RH requise.`,
        );
        continue;
      }
      const classification = classifyCarryoverLot(lot);
      if (classification.expired) {
        expiredDays = round2(expiredDays + Number(lot.remainingDays));
        expiredLots.push(lot.id);
      } else if (classification.uncertain) {
        toReviewLots.push(lot.id);
        reasons.push(
          `Salarié #${balance.employeeId} : lot #${lot.id} à l'échéance incertaine (dossier incomplet) — résolution RH requise avant clôture.`,
        );
      } else {
        protectedDays = round2(protectedDays + Number(lot.remainingDays));
        preservedLots.push(lot.id);
      }
    }

    const frozenRows = await manager.getRepository(CarryoverLotAllocation).find({
      where: {
        leaveBalanceId: balance.id,
        operationType: CarryoverLotAllocationOperation.REGULARISATION,
        frozenInBalance: true,
      },
    });
    const frozenDays = round2(
      frozenRows.reduce((sum, r) => sum + Number(r.days), 0),
    );

    const ordinaryDays = round2(
      Number(balance.availableDays) -
        Number(balance.reservedDays) -
        protectedDays -
        expiredDays -
        frozenDays,
    );

    if (ordinaryDays < 0) {
      reasons.push(
        `Salarié #${balance.employeeId} : incohérence comptable (ordinaire ${ordinaryDays} j) sur le compteur ${referencePeriod} N-1.`,
      );
    }
    if (Number(balance.reservedDays) > 0) {
      reasons.push(
        `Salarié #${balance.employeeId} : ${balance.reservedDays} j réservés — clôture bloquée.`,
      );
    }
    if (frozenDays > 0) {
      reasons.push(
        `Salarié #${balance.employeeId} : ${frozenDays} j gelés en régularisation — clôture bloquée.`,
      );
    }

    counters.push({
      employeeId: balance.employeeId,
      balanceId: balance.id,
      referencePeriod: balance.referencePeriod,
      availableDays: Number(balance.availableDays),
      reservedDays: Number(balance.reservedDays),
      protectedDays,
      expiredDays,
      frozenDays,
      ordinaryDays,
      unknownReliquat,
      toReviewLots,
      preservedLots,
      expiredLots,
    });
  }

  return { counters, blocked: reasons.length > 0, reasons };
}

/**
 * Applique le plan des lots maladie dans la MÊME transaction que la clôture
 * normale (via le `manager` fourni). Ne crée ni transaction ni verrou, n'écrit
 * AUCUN marqueur.
 *
 * - jours expirés : déduits du compteur N-1, lots marqués EXPIRE, mouvement
 *   `REMISE_A_ZERO` explicite ;
 * - jours protégés : transférés vers le N-1 de la période suivante, lots
 *   rattachés à la nouvelle période, mouvements `REPORT_TRANSFERT`.
 *
 * Les jours ordinaires restent dans le compteur N-1 : c'est la clôture normale
 * qui les remet à zéro (`CLOTURE_PERIODE`).
 */
export async function applyCarryoverLotPlan(
  manager: EntityManager,
  referencePeriod: string,
  actorId: number,
  plan: CarryoverLotPlan,
): Promise<void> {
  const nextPeriod = nextReferencePeriod(referencePeriod);
  const lotsById = new Map<number, CarryoverLot>();
  const balancesById = new Map<number, LeaveBalance>();

  for (const counter of plan.counters) {
    const balance = await manager.getRepository(LeaveBalance).findOneBy({
      id: counter.balanceId,
    });
    if (balance) balancesById.set(counter.balanceId, balance);
    for (const lotId of [...counter.preservedLots, ...counter.expiredLots]) {
      if (!lotsById.has(lotId)) {
        const lot = await manager.getRepository(CarryoverLot).findOneBy({
          id: lotId,
        });
        if (lot) lotsById.set(lotId, lot);
      }
    }
  }

  for (const counter of plan.counters) {
    const balance = balancesById.get(counter.balanceId);
    if (!balance) continue;

    const before = round2(Number(balance.availableDays));

    // 1. Jours expirés : retirés du solde, lots marqués EXPIRE.
    if (counter.expiredDays > 0) {
      balance.availableDays = round2(before - counter.expiredDays);
      await manager.getRepository(LeaveBalance).save(balance);
      await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: balance.employeeId,
          leaveBalanceId: balance.id,
          leaveRequestId: null,
          actorId,
          movementType: BalanceMovementType.REMISE_A_ZERO,
          days: counter.expiredDays,
          balanceBefore: before,
          balanceAfter: balance.availableDays,
          reason: `REPORT_CLOTURE|${referencePeriod}|expirés`,
        }),
      );
      for (const lotId of counter.expiredLots) {
        const lot = lotsById.get(lotId);
        if (lot && lot.status !== CarryoverLotStatus.EXPIRE) {
          lot.status = CarryoverLotStatus.EXPIRE;
          await manager.getRepository(CarryoverLot).save(lot);
        }
      }
    }

    // 2. Jours protégés : transfert vers le N-1 suivant (identité conservée).
    if (counter.protectedDays > 0) {
      balance.availableDays = round2(
        Number(balance.availableDays) - counter.protectedDays,
      );
      await manager.getRepository(LeaveBalance).save(balance);

      let next = await manager
        .getRepository(LeaveBalance)
        .createQueryBuilder('balance')
        .setLock('pessimistic_write')
        .where('balance.employeeId = :employeeId', {
          employeeId: balance.employeeId,
        })
        .andWhere('balance.referencePeriod = :period', { period: nextPeriod })
        .andWhere('balance.counterType = :counter', {
          counter: LeaveBalanceCounterType.N_MINUS_1,
        })
        .getOne();
      if (!next) {
        next = manager.getRepository(LeaveBalance).create({
          employeeId: balance.employeeId,
          referencePeriod: nextPeriod,
          counterType: LeaveBalanceCounterType.N_MINUS_1,
          acquiredDays: 0,
          reservedDays: 0,
          consumedDays: 0,
          availableDays: 0,
        });
      }
      const nextBefore = round2(Number(next.availableDays));
      next.availableDays = round2(nextBefore + counter.protectedDays);
      await manager.getRepository(LeaveBalance).save(next);

      await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: balance.employeeId,
          leaveBalanceId: balance.id,
          leaveRequestId: null,
          actorId,
          movementType: BalanceMovementType.CORRECTION_NEGATIVE,
          days: counter.protectedDays,
          balanceBefore: round2(before - counter.expiredDays),
          balanceAfter: balance.availableDays,
          reason: `REPORT_TRANSFERT|${referencePeriod}|${nextPeriod}`,
        }),
      );
      await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: next.employeeId,
          leaveBalanceId: next.id,
          leaveRequestId: null,
          actorId,
          movementType: BalanceMovementType.CORRECTION_POSITIVE,
          days: counter.protectedDays,
          balanceBefore: nextBefore,
          balanceAfter: next.availableDays,
          reason: `REPORT_TRANSFERT|${referencePeriod}|${nextPeriod}`,
        }),
      );

      for (const lotId of counter.preservedLots) {
        const lot = lotsById.get(lotId);
        if (lot) {
          lot.targetReferencePeriod = nextPeriod;
          await manager.getRepository(CarryoverLot).save(lot);
        }
      }
    }
  }
}
