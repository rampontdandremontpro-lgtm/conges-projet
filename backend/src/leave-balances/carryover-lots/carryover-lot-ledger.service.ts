/**
 * JUR-027 — E3-A : moteur transactionnel UNIQUE des lots maladie.
 *
 * Ce service est l'autorité transactionnelle pour les opérations sur les lots :
 *  - réservation (jours datés sur lots consommables, FIFO échéance) ;
 *  - consommation directe (sans réservation préalable) ;
 *  - consommation d'une réservation (transformation réservation → débit) ;
 *  - libération d'une réservation ;
 *  - restitution après consommation ;
 *  - régularisation des lots expirés (jamais de recrédit silencieux).
 *
 * Les méthodes publiques `reserve` / `consume` / `consumeDirect` / `release` /
 * `restore` ouvrent leur propre transaction. Les variantes `*WithManager`
 * participent à une transaction EXISTANTE (via `EntityManager`) afin d'être
 * appelées par `CarryoverLotAllocationService` dans la même transaction que les
 * écritures ordinaires : aucune transaction imbriquée.
 *
 * Règles :
 *  - jamais plus de jours consommés qu'un lot n'en possède ;
 *  - jamais un lot expiré/suspendu/à-vérifier/gelé/reliquat inconnu ;
 *  - ∑(reliquats de lots) + réservés + gelés ≤ disponible (anti-sur-réservation) ;
 *  - jours non couverts → retournés en `uncovered` (jamais transformés en
 *    jours ordinaires par ce service) ;
 *  - demi-journées et multi-périodes pris en charge ;
 *  - traçabilité : balance_movements + lot_allocations + audit ;
 *  - rollback intégral en cas d'erreur (transaction de l'appelant).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { BalanceMovement, BalanceMovementType } from '../balance-movement.entity';
import { LeaveBalance, LeaveBalanceCounterType } from '../leave-balance.entity';
import {
  CarryoverLot,
  CarryoverLotStatus,
  CarryoverLotTargetCounter,
} from '../carryover-lot.entity';
import {
  allocateCarryoverLots,
  ConsumableLotInput,
  DatedLeaveDay,
  isLotConsumable,
} from '../carryover-allocation.core';
import { martiniqueDateString } from '../reference-period.util';
import {
  CarryoverLotAllocation,
  CarryoverLotAllocationOperation,
} from './carryover-lot-allocation.entity';

const round2 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function todayIso(): string {
  return martiniqueDateString(new Date());
}

function isExpired(lot: CarryoverLot, today: string): boolean {
  return (
    lot.status === CarryoverLotStatus.EXPIRE ||
    (lot.expiresAt != null && lot.expiresAt < today)
  );
}

export interface CarryoverLotLedgerAllocation {
  lotId: number;
  days: number;
  dates: DatedLeaveDay[];
}

export interface CarryoverLotLedgerSkipped {
  lotId: number;
  reason: string;
}

export interface CarryoverLotLedgerResult {
  operation: 'RESERVE' | 'CONSUME' | 'RELEASE' | 'RESTORE';
  /** Jours de lots effectivement traités. */
  totalLotDays: number;
  /** Jours non restituables automatiquement (régularisation RH requise). */
  regularisationDays?: number;
  allocations: CarryoverLotLedgerAllocation[];
  /** Jours non couverts par un lot (à traiter par l'appelant, jamais ici). */
  uncovered: DatedLeaveDay[];
  skipped: CarryoverLotLedgerSkipped[];
}

export interface CarryoverLotLedgerReserveInput {
  employeeId: number;
  leaveRequestId: number;
  datedDays: readonly DatedLeaveDay[];
  actorId?: number | null;
  reason?: string | null;
}

export interface CarryoverLotLedgerRequestInput {
  leaveRequestId: number;
  actorId?: number | null;
  reason?: string | null;
}

/** Écriture de mouvements de lots à partir d'un plan déjà calculé (utilisée par L4). */
export interface CarryoverLotWriteInput {
  employeeId: number;
  leaveRequestId: number;
  allocations: CarryoverLotLedgerAllocation[];
  lotsById: Map<number, CarryoverLot>;
  balancesById: Map<number, LeaveBalance>;
  movementType: BalanceMovementType;
  operationType: CarryoverLotAllocationOperation;
  actorId: number | null;
  reason?: string | null;
}

/** Restitution d'un lot lors de la libération d'une réservation. */
export interface CarryoverLotReleaseRestoreInput {
  reservation: CarryoverLotAllocation;
  days: number;
  liberationMovementId: number;
  actorId: number | null;
  reason?: string | null;
}

/** Restitution d'un lot consommé (après débit). */
export interface CarryoverLotConsumptionRestoreInput {
  consumption: CarryoverLotAllocation;
  movement: BalanceMovement;
  actorId: number | null;
  reason?: string | null;
}

@Injectable()
export class CarryoverLotLedgerService {
  constructor(
    @InjectRepository(CarryoverLot)
    private readonly lotRepository: Repository<CarryoverLot>,
    @InjectRepository(CarryoverLotAllocation)
    private readonly allocationRepository: Repository<CarryoverLotAllocation>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepository: Repository<LeaveBalance>,
    @InjectRepository(BalanceMovement)
    private readonly movementRepository: Repository<BalanceMovement>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // API publique (transaction propre)
  // ------------------------------------------------------------------
  async reserve(input: CarryoverLotLedgerReserveInput): Promise<CarryoverLotLedgerResult> {
    return this.guard(
      () => this.dataSource.transaction((m) => this.reserveWithManager(m, input)),
      'Réservation concurrente détectée.',
    );
  }

  /** Consommation d'une réservation existante (réservation → débit). */
  async consume(input: CarryoverLotLedgerRequestInput): Promise<CarryoverLotLedgerResult> {
    return this.guard(
      () => this.dataSource.transaction((m) => this.consumeReservationWithManager(m, input)),
      'Consommation concurrente détectée.',
    );
  }

  /** Consommation directe (sans réservation préalable). */
  async consumeDirect(input: CarryoverLotLedgerReserveInput): Promise<CarryoverLotLedgerResult> {
    return this.guard(
      () => this.dataSource.transaction((m) => this.consumeDirectWithManager(m, input)),
      'Consommation concurrente détectée.',
    );
  }

  async release(input: CarryoverLotLedgerRequestInput): Promise<CarryoverLotLedgerResult> {
    return this.guard(
      () => this.dataSource.transaction((m) => this.releaseWithManager(m, input)),
      'Libération concurrente détectée.',
    );
  }

  async restore(input: CarryoverLotLedgerRequestInput): Promise<CarryoverLotLedgerResult> {
    return this.guard(
      () => this.dataSource.transaction((m) => this.restoreWithManager(m, input)),
      'Restitution concurrente détectée.',
    );
  }

  // ------------------------------------------------------------------
  // Variantes WithManager (participent à la transaction de l'appelant)
  // ------------------------------------------------------------------
  async reserveWithManager(
    manager: EntityManager,
    input: CarryoverLotLedgerReserveInput,
  ): Promise<CarryoverLotLedgerResult> {
    const lots = await this.lockLots(manager, input.employeeId);

    const alreadyReserved = await this.lockReservationRows(manager, input.leaveRequestId);
    if (alreadyReserved.length > 0) {
      throw new ConflictException('Cette demande a déjà fait l’objet d’une réservation de lots.');
    }

    const plan = this.planAllocation(lots, input.datedDays);
    const balancesByPeriod = await this.lockAndValidateCounters(
      manager,
      input.employeeId,
      lots,
      plan,
    );

    const allocations = await this.writeLotMovementsWithManager(manager, {
      employeeId: input.employeeId,
      leaveRequestId: input.leaveRequestId,
      allocations: plan.allocations,
      lotsById: this.byId(lots),
      balancesById: this.balancesByIdMap(balancesByPeriod),
      movementType: BalanceMovementType.RESERVATION,
      operationType: CarryoverLotAllocationOperation.RESERVATION,
      actorId: input.actorId ?? null,
      reason: input.reason ?? 'Réservation de jours reportés (maladie).',
    });

    const result: CarryoverLotLedgerResult = {
      operation: 'RESERVE',
      totalLotDays: round2(allocations.reduce((s, a) => s + a.days, 0)),
      allocations,
      uncovered: plan.uncovered,
      skipped: plan.skipped,
    };

    await this.audit(manager, input.leaveRequestId, input.actorId, 'CARRYOVER_LOT_LEDGER_RESERVE', result);
    return result;
  }

  async consumeDirectWithManager(
    manager: EntityManager,
    input: CarryoverLotLedgerReserveInput,
  ): Promise<CarryoverLotLedgerResult> {
    const lots = await this.lockLots(manager, input.employeeId);

    const existing = await manager.getRepository(BalanceMovement).find({
      where: {
        leaveRequestId: input.leaveRequestId,
        movementType: BalanceMovementType.DEDUCTION,
      },
    });
    if (existing.length > 0) {
      throw new ConflictException('Cette demande a déjà été consommée.');
    }

    const plan = this.planAllocation(lots, input.datedDays);
    const balancesByPeriod = await this.lockAndValidateCounters(
      manager,
      input.employeeId,
      lots,
      plan,
    );

    const allocations = await this.writeLotMovementsWithManager(manager, {
      employeeId: input.employeeId,
      leaveRequestId: input.leaveRequestId,
      allocations: plan.allocations,
      lotsById: this.byId(lots),
      balancesById: this.balancesByIdMap(balancesByPeriod),
      movementType: BalanceMovementType.DEDUCTION,
      operationType: CarryoverLotAllocationOperation.CONSUMPTION,
      actorId: input.actorId ?? null,
      reason: input.reason ?? 'Déduction de jours reportés (maladie).',
    });

    const result: CarryoverLotLedgerResult = {
      operation: 'CONSUME',
      totalLotDays: round2(allocations.reduce((s, a) => s + a.days, 0)),
      allocations,
      uncovered: plan.uncovered,
      skipped: plan.skipped,
    };

    await this.audit(manager, input.leaveRequestId, input.actorId, 'CARRYOVER_LOT_LEDGER_CONSUME', result);
    return result;
  }

  async consumeReservationWithManager(
    manager: EntityManager,
    input: CarryoverLotLedgerRequestInput,
  ): Promise<CarryoverLotLedgerResult> {
    const reservationRows = await this.findReservationRows(manager, input.leaveRequestId);
    if (reservationRows.length === 0) {
      throw new NotFoundException('Aucune réservation de lots pour cette demande.');
    }

    const { balances, movementById } = await this.lockBalancesForReservation(
      manager,
      reservationRows,
    );

    // Point de sérialisation : verrou des compteurs AVANT l'état, puis contrôle
    // d'unicité (évite le deadlock de gap-lock sur lot_allocations).
    await this.assertNotAlreadyProcessed(manager, input.leaveRequestId);

    const allocations: CarryoverLotLedgerAllocation[] = [];
    for (const row of reservationRows) {
      const movement = row.movementId != null ? movementById.get(row.movementId) : undefined;
      if (!movement) continue;
      const balance = balances.get(movement.leaveBalanceId);
      if (!balance) continue;

      const before = round2(Number(balance.availableDays));
      const days = round2(Number(movement.days));
      if (before < days) {
        throw new BadRequestException(
          `Compteur #${balance.id} : disponible ${before} j insuffisant pour consommer ${days} j.`,
        );
      }
      balance.reservedDays = round2(Number(balance.reservedDays) - days);
      balance.consumedDays = round2(Number(balance.consumedDays) + days);
      balance.availableDays = round2(before - days);
      await manager.getRepository(LeaveBalance).save(balance);

      const deduction = await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: movement.employeeId,
          leaveBalanceId: movement.leaveBalanceId,
          leaveRequestId: input.leaveRequestId,
          actorId: input.actorId ?? null,
          movementType: BalanceMovementType.DEDUCTION,
          days: movement.days,
          balanceBefore: before,
          balanceAfter: balance.availableDays,
          reason: input.reason ?? 'Consommation de la réservation de jours reportés.',
        }),
      );

      await manager.getRepository(CarryoverLotAllocation).save(
        manager.getRepository(CarryoverLotAllocation).create({
          lotId: row.lotId,
          leaveRequestId: input.leaveRequestId,
          movementId: deduction.id,
          leaveBalanceId: movement.leaveBalanceId,
          operationType: CarryoverLotAllocationOperation.CONSUMPTION,
          days: Number(movement.days),
          coveredDates: row.coveredDates,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
        }),
      );

      allocations.push({
        lotId: row.lotId,
        days: Number(movement.days),
        dates: row.coveredDates ?? [],
      });
    }

    const result: CarryoverLotLedgerResult = {
      operation: 'CONSUME',
      totalLotDays: round2(allocations.reduce((s, a) => s + a.days, 0)),
      allocations,
      uncovered: [],
      skipped: [],
    };

    await this.audit(manager, input.leaveRequestId, input.actorId, 'CARRYOVER_LOT_LEDGER_CONSUME', result);
    return result;
  }

  async releaseWithManager(
    manager: EntityManager,
    input: CarryoverLotLedgerRequestInput,
  ): Promise<CarryoverLotLedgerResult> {
    const reservationRows = await this.findReservationRows(manager, input.leaveRequestId);
    if (reservationRows.length === 0) {
      throw new NotFoundException('Aucune réservation de lots pour cette demande.');
    }

    const { balances, movementById } = await this.lockBalancesForReservation(
      manager,
      reservationRows,
    );

    // Point de sérialisation : verrou des compteurs AVANT l'état (anti-deadlock).
    await this.assertNotAlreadyProcessed(manager, input.leaveRequestId);

    let totalLotDays = 0;
    let regularisationDays = 0;

    for (const row of reservationRows) {
      const movement = row.movementId != null ? movementById.get(row.movementId) : undefined;
      if (!movement) continue;
      const balance = balances.get(movement.leaveBalanceId);
      if (!balance) continue;

      const before = round2(Number(balance.availableDays));
      const days = round2(Number(movement.days));
      if (round2(Number(balance.reservedDays)) < days) {
        throw new BadRequestException(
          `Compteur #${balance.id} : réservés ${Number(balance.reservedDays)} j insuffisants pour libérer ${days} j.`,
        );
      }
      balance.reservedDays = round2(Number(balance.reservedDays) - days);
      await manager.getRepository(LeaveBalance).save(balance);

      const liberation = await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: movement.employeeId,
          leaveBalanceId: movement.leaveBalanceId,
          leaveRequestId: input.leaveRequestId,
          actorId: input.actorId ?? null,
          movementType: BalanceMovementType.LIBERATION_RESERVATION,
          days: movement.days,
          balanceBefore: before,
          balanceAfter: balance.availableDays,
          reason: input.reason ?? 'Libération de la réservation de jours reportés.',
        }),
      );

      const { expired } = await this.restoreLotOnReleaseWithManager(manager, {
        reservation: row,
        days,
        liberationMovementId: liberation.id,
        actorId: input.actorId ?? null,
        reason: input.reason ?? 'Libération de la réservation.',
      });
      if (expired) regularisationDays = round2(regularisationDays + days);
      totalLotDays = round2(totalLotDays + days);
    }

    const result: CarryoverLotLedgerResult = {
      operation: 'RELEASE',
      totalLotDays,
      regularisationDays,
      allocations: [],
      uncovered: [],
      skipped: [],
    };

    await this.audit(manager, input.leaveRequestId, input.actorId, 'CARRYOVER_LOT_LEDGER_RELEASE', result);
    return result;
  }

  async restoreWithManager(
    manager: EntityManager,
    input: CarryoverLotLedgerRequestInput,
  ): Promise<CarryoverLotLedgerResult> {
    await this.assertNoRecredit(manager, input.leaveRequestId);

    const consumptionRows = await manager
      .getRepository(CarryoverLotAllocation)
      .createQueryBuilder('allocation')
      .setLock('pessimistic_write')
      .where('allocation.leaveRequestId = :id', { id: input.leaveRequestId })
      .andWhere('allocation.operationType = :op', {
        op: CarryoverLotAllocationOperation.CONSUMPTION,
      })
      .getMany();

    if (consumptionRows.length === 0) {
      throw new NotFoundException('Aucune consommation de lots pour cette demande.');
    }

    const movements = await manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .setLock('pessimistic_write')
      .where('movement.leaveRequestId = :id', { id: input.leaveRequestId })
      .andWhere('movement.movementType = :type', { type: BalanceMovementType.DEDUCTION })
      .getMany();

    const consumptionByMovement = new Map<number, CarryoverLotAllocation>();
    for (const row of consumptionRows) consumptionByMovement.set(row.movementId ?? 0, row);

    let totalLotDays = 0;
    let regularisationDays = 0;
    const allocations: CarryoverLotLedgerAllocation[] = [];

    for (const movement of movements) {
      const consumption = consumptionByMovement.get(movement.id);
      if (!consumption) continue;

      const { expired } = await this.restoreLotAfterConsumptionWithManager(manager, {
        consumption,
        movement,
        actorId: input.actorId ?? null,
        reason: input.reason ?? 'Restitution après annulation.',
      });
      const days = round2(Number(movement.days));
      if (expired) {
        regularisationDays = round2(regularisationDays + days);
      } else {
        totalLotDays = round2(totalLotDays + days);
        allocations.push({
          lotId: consumption.lotId,
          days,
          dates: consumption.coveredDates ?? [],
        });
      }
    }

    const result: CarryoverLotLedgerResult = {
      operation: 'RESTORE',
      totalLotDays,
      regularisationDays,
      allocations,
      uncovered: [],
      skipped: [],
    };

    await this.audit(manager, input.leaveRequestId, input.actorId, 'CARRYOVER_LOT_LEDGER_RESTORE', result);
    return result;
  }

  // ------------------------------------------------------------------
  // Moteur d'écriture partagé (utilisé par L4 et par ce service)
  // ------------------------------------------------------------------

  /** Écrit les mouvements de lots (réservation OU déduction) à partir d'un plan. */
  async writeLotMovementsWithManager(
    manager: EntityManager,
    input: CarryoverLotWriteInput,
  ): Promise<CarryoverLotLedgerAllocation[]> {
    const written: CarryoverLotLedgerAllocation[] = [];
    const isConsumption = input.movementType === BalanceMovementType.DEDUCTION;

    for (const alloc of input.allocations) {
      const lot = input.lotsById.get(alloc.lotId);
      if (!lot) {
        throw new BadRequestException(`Lot #${alloc.lotId} introuvable dans le plan.`);
      }
      if (lot.employeeId !== input.employeeId) {
        throw new BadRequestException(
          `Lot #${lot.id} n'appartient pas à l'employé #${input.employeeId}.`,
        );
      }
      const balance = this.balanceForLot(input.balancesById, lot);
      if (!balance) {
        throw new BadRequestException(
          `Compteur N-1 ${lot.targetReferencePeriod} introuvable pour le lot #${lot.id}.`,
        );
      }
      if (balance.employeeId !== input.employeeId) {
        throw new BadRequestException(
          `Compteur #${balance.id} n'appartient pas à l'employé #${input.employeeId}.`,
        );
      }
      if (round2(Number(lot.remainingDays)) < round2(alloc.days)) {
        throw new BadRequestException(
          `Reliquat insuffisant : lot #${lot.id} a ${Number(lot.remainingDays)} j pour une allocation de ${alloc.days} j.`,
        );
      }

      const before = round2(Number(balance.availableDays));
      if (isConsumption) {
        balance.consumedDays = round2(Number(balance.consumedDays) + alloc.days);
        balance.availableDays = round2(before - alloc.days);
      } else {
        balance.reservedDays = round2(Number(balance.reservedDays) + alloc.days);
      }
      await manager.getRepository(LeaveBalance).save(balance);

      const movement = await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: input.employeeId,
          leaveBalanceId: balance.id,
          leaveRequestId: input.leaveRequestId,
          actorId: input.actorId,
          movementType: input.movementType,
          days: alloc.days,
          balanceBefore: before,
          balanceAfter: balance.availableDays,
          reason:
            input.reason ??
            (isConsumption ? 'Déduction de jours reportés.' : 'Réservation de jours reportés.'),
        }),
      );

      await manager.getRepository(CarryoverLotAllocation).save(
        manager.getRepository(CarryoverLotAllocation).create({
          lotId: lot.id,
          leaveRequestId: input.leaveRequestId,
          movementId: movement.id,
          leaveBalanceId: balance.id,
          operationType: input.operationType,
          days: alloc.days,
          coveredDates: alloc.dates,
          actorId: input.actorId,
          reason: input.reason ?? null,
        }),
      );

      lot.remainingDays = round2(Number(lot.remainingDays) - alloc.days);
      await manager.getRepository(CarryoverLot).save(lot);

      written.push({ lotId: lot.id, days: alloc.days, dates: alloc.dates });
    }
    return written;
  }

  /** Restitue un lot à la libération d'une réservation (expiré → régularisation). */
  async restoreLotOnReleaseWithManager(
    manager: EntityManager,
    input: CarryoverLotReleaseRestoreInput,
  ): Promise<{ expired: boolean }> {
    const lot = await this.requireLot(manager, input.reservation.lotId);
    if (isExpired(lot, todayIso())) {
      await manager.getRepository(CarryoverLotAllocation).save(
        manager.getRepository(CarryoverLotAllocation).create({
          lotId: input.reservation.lotId,
          leaveRequestId: input.reservation.leaveRequestId,
          movementId: input.liberationMovementId,
          leaveBalanceId: input.reservation.leaveBalanceId,
          operationType: CarryoverLotAllocationOperation.REGULARISATION,
          frozenInBalance: true,
          days: input.days,
          coveredDates: input.reservation.coveredDates,
          actorId: input.actorId,
          reason: 'Lot expiré pendant la réservation — régularisation RH requise.',
        }),
      );
      return { expired: true };
    }
    lot.remainingDays = round2(Number(lot.remainingDays) + input.days);
    await manager.getRepository(CarryoverLot).save(lot);
    await manager.getRepository(CarryoverLotAllocation).save(
      manager.getRepository(CarryoverLotAllocation).create({
        lotId: input.reservation.lotId,
        leaveRequestId: input.reservation.leaveRequestId,
        movementId: input.liberationMovementId,
        leaveBalanceId: input.reservation.leaveBalanceId,
        operationType: CarryoverLotAllocationOperation.ANNULATION,
        days: input.days,
        coveredDates: input.reservation.coveredDates,
        actorId: input.actorId,
        reason: input.reason ?? 'Libération de la réservation.',
      }),
    );
    return { expired: false };
  }

  /** Restitue un lot consommé : recrédit + restitution du lot, ou régularisation si expiré. */
  async restoreLotAfterConsumptionWithManager(
    manager: EntityManager,
    input: CarryoverLotConsumptionRestoreInput,
  ): Promise<{ expired: boolean }> {
    const days = round2(Number(input.movement.days));
    const lot = await this.requireLot(manager, input.consumption.lotId);

    if (isExpired(lot, todayIso())) {
      await manager.getRepository(CarryoverLotAllocation).save(
        manager.getRepository(CarryoverLotAllocation).create({
          lotId: input.consumption.lotId,
          leaveRequestId: input.consumption.leaveRequestId,
          movementId: input.movement.id,
          leaveBalanceId: input.movement.leaveBalanceId,
          operationType: CarryoverLotAllocationOperation.REGULARISATION,
          days,
          coveredDates: input.consumption.coveredDates,
          actorId: input.actorId,
          reason: 'Lot expiré au moment de la restitution — régularisation RH requise.',
        }),
      );
      return { expired: true };
    }

    const balance = await this.lockBalanceById(manager, input.movement.leaveBalanceId);
    const before = round2(Number(balance.availableDays));
    if (round2(Number(balance.consumedDays)) < days) {
      throw new BadRequestException(
        `Compteur #${balance.id} : consommés ${Number(balance.consumedDays)} j insuffisants pour restituer ${days} j.`,
      );
    }
    balance.consumedDays = round2(Number(balance.consumedDays) - days);
    balance.availableDays = round2(Number(balance.availableDays) + days);
    await manager.getRepository(LeaveBalance).save(balance);

    const recredit = await manager.getRepository(BalanceMovement).save(
      manager.getRepository(BalanceMovement).create({
        employeeId: input.movement.employeeId,
        leaveBalanceId: input.movement.leaveBalanceId,
        leaveRequestId: input.movement.leaveRequestId,
        actorId: input.actorId,
        movementType: BalanceMovementType.RECREDIT,
        days: input.movement.days,
        balanceBefore: before,
        balanceAfter: balance.availableDays,
        reason: input.reason ?? 'Restitution des jours reportés consommés.',
      }),
    );

    lot.remainingDays = round2(Number(lot.remainingDays) + days);
    await manager.getRepository(CarryoverLot).save(lot);
    await manager.getRepository(CarryoverLotAllocation).save(
      manager.getRepository(CarryoverLotAllocation).create({
        lotId: input.consumption.lotId,
        leaveRequestId: input.consumption.leaveRequestId,
        movementId: recredit.id,
        leaveBalanceId: input.movement.leaveBalanceId,
        operationType: CarryoverLotAllocationOperation.ANNULATION,
        days,
        coveredDates: input.consumption.coveredDates,
        actorId: input.actorId,
        reason: input.reason ?? 'Restitution après annulation.',
      }),
    );
    return { expired: false };
  }

  // ------------------------------------------------------------------
  // Helpers transactionnels
  // ------------------------------------------------------------------
  private planAllocation(
    lots: CarryoverLot[],
    datedDays: readonly DatedLeaveDay[],
  ): {
    allocations: CarryoverLotLedgerAllocation[];
    uncovered: DatedLeaveDay[];
    skipped: CarryoverLotLedgerSkipped[];
  } {
    const eligible: ConsumableLotInput[] = [];
    const skipped: CarryoverLotLedgerSkipped[] = [];
    const today = todayIso();
    for (const lot of lots) {
      if (lot.status !== CarryoverLotStatus.ACTIF) {
        skipped.push({ lotId: lot.id, reason: `STATUT_${lot.status}` });
        continue;
      }
      if (lot.expiresAt != null && lot.expiresAt < today) {
        skipped.push({ lotId: lot.id, reason: 'EXPIRE_A_LA_DATE_OPERATION' });
        continue;
      }
      const eligibility = isLotConsumable(this.lotToInput(lot));
      if (!eligibility.consumable) {
        skipped.push({ lotId: lot.id, reason: eligibility.reason ?? 'INELIGIBLE' });
        continue;
      }
      eligible.push(this.lotToInput(lot));
    }
    const result = allocateCarryoverLots(datedDays, eligible);
    for (const skip of result.skipped) skipped.push(skip);
    return {
      allocations: result.allocations.map((a) => ({
        lotId: a.lotId,
        days: a.days,
        dates: a.dates,
      })),
      uncovered: result.uncovered,
      skipped,
    };
  }

  private findLot(lots: CarryoverLot[], lotId: number): CarryoverLot {
    const lot = lots.find((l) => l.id === lotId);
    if (!lot) {
      throw new BadRequestException(`Lot #${lotId} introuvable pour cet employé.`);
    }
    return lot;
  }

  private byId(lots: CarryoverLot[]): Map<number, CarryoverLot> {
    return new Map(lots.map((l) => [l.id, l]));
  }

  private balancesByIdMap(balances: Map<string, LeaveBalance>): Map<number, LeaveBalance> {
    return new Map([...balances.values()].map((b) => [b.id, b]));
  }

  private balanceForLot(
    balancesById: Map<number, LeaveBalance>,
    lot: CarryoverLot,
  ): LeaveBalance | undefined {
    for (const balance of balancesById.values()) {
      if (
        balance.referencePeriod === lot.targetReferencePeriod &&
        balance.counterType === LeaveBalanceCounterType.N_MINUS_1
      ) {
        return balance;
      }
    }
    return undefined;
  }

  private async lockLots(manager: EntityManager, employeeId: number): Promise<CarryoverLot[]> {
    return manager
      .getRepository(CarryoverLot)
      .createQueryBuilder('lot')
      .setLock('pessimistic_write')
      .where('lot.employeeId = :employeeId', { employeeId })
      .andWhere('lot.targetCounterType = :counter', {
        counter: CarryoverLotTargetCounter.N_MINUS_1,
      })
      .orderBy('lot.expiresAt', 'ASC')
      .addOrderBy('lot.id', 'ASC')
      .getMany();
  }

  private async lockLot(manager: EntityManager, lotId: number): Promise<CarryoverLot | null> {
    return manager
      .getRepository(CarryoverLot)
      .createQueryBuilder('lot')
      .setLock('pessimistic_write')
      .where('lot.id = :id', { id: lotId })
      .getOne();
  }

  private async requireLot(manager: EntityManager, lotId: number): Promise<CarryoverLot> {
    const lot = await this.lockLot(manager, lotId);
    if (!lot) {
      throw new BadRequestException(`Lot #${lotId} introuvable.`);
    }
    return lot;
  }

  private async lockBalance(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
  ): Promise<LeaveBalance> {
    const balance = await manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', { referencePeriod })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      })
      .getOne();
    if (!balance) {
      throw new BadRequestException(
        `Compteur N-1 ${referencePeriod} absent pour l'employé #${employeeId}.`,
      );
    }
    return balance;
  }

  private async lockBalanceById(manager: EntityManager, balanceId: number): Promise<LeaveBalance> {
    const balance = await manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.id = :id', { id: balanceId })
      .getOne();
    if (!balance) {
      throw new BadRequestException(`Compteur #${balanceId} introuvable.`);
    }
    return balance;
  }

  private async lockAndValidateCounters(
    manager: EntityManager,
    employeeId: number,
    lots: CarryoverLot[],
    plan: { allocations: CarryoverLotLedgerAllocation[] },
  ): Promise<Map<string, LeaveBalance>> {
    const lotById = new Map<number, CarryoverLot>();
    for (const lot of lots) lotById.set(lot.id, lot);

    const periods = new Set<string>();
    for (const alloc of plan.allocations) {
      const lot = lotById.get(alloc.lotId);
      if (lot) periods.add(lot.targetReferencePeriod);
    }

    const balances = new Map<string, LeaveBalance>();
    const sortedPeriods = [...periods].sort();
    for (const period of sortedPeriods) {
      const balance = await this.lockBalance(manager, employeeId, period);
      balances.set(period, balance);

      const lotsOnCounter = lots.filter((l) => l.targetReferencePeriod === period);
      const protectedDays = round2(
        lotsOnCounter
          .filter((l) => l.remainingDays != null)
          .reduce((sum, l) => sum + Number(l.remainingDays), 0),
      );

      const frozenRows = await manager.getRepository(CarryoverLotAllocation).find({
        where: {
          leaveBalanceId: balance.id,
          operationType: CarryoverLotAllocationOperation.REGULARISATION,
          frozenInBalance: true,
        },
      });
      const frozenDays = round2(frozenRows.reduce((sum, r) => sum + Number(r.days), 0));

      const reservedDays = round2(Number(balance.reservedDays));
      const availableDays = round2(Number(balance.availableDays));
      if (round2(protectedDays + reservedDays + frozenDays) > availableDays) {
        throw new BadRequestException(
          `Compteur N-1 ${period} insuffisant : disponibles ${availableDays} j < lots ${protectedDays} j + réservés ${reservedDays} j + gelés ${frozenDays} j.`,
        );
      }
    }
    return balances;
  }

  private async findReservationRows(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<CarryoverLotAllocation[]> {
    return manager.getRepository(CarryoverLotAllocation).find({
      where: {
        leaveRequestId,
        operationType: CarryoverLotAllocationOperation.RESERVATION,
      },
    });
  }

  /**
   * Charge les mouvements de réservation et verrouille leurs compteurs dans un
   * ordre déterministe (id croissant). C'est le point de sérialisation des
   * opérations de consommation/libération : on évite le verrou FOR UPDATE sur
   * `lot_allocations` (gap-lock) qui provoquait un deadlock lors de deux
   * transformations simultanées de la même réservation.
   */
  private async lockBalancesForReservation(
    manager: EntityManager,
    reservationRows: CarryoverLotAllocation[],
  ): Promise<{ balances: Map<number, LeaveBalance>; movementById: Map<number, BalanceMovement> }> {
    const movementById = new Map<number, BalanceMovement>();
    for (const row of reservationRows) {
      if (row.movementId == null) continue;
      const movement = await manager.getRepository(BalanceMovement).findOne({
        where: { id: row.movementId },
      });
      if (movement) movementById.set(movement.id, movement);
    }

    const balanceIds = [...new Set([...movementById.values()].map((m) => m.leaveBalanceId))].sort(
      (a, b) => a - b,
    );
    const balances = new Map<number, LeaveBalance>();
    for (const balanceId of balanceIds) {
      balances.set(balanceId, await this.lockBalanceById(manager, balanceId));
    }
    return { balances, movementById };
  }

  private async lockReservationRows(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<CarryoverLotAllocation[]> {
    return manager
      .getRepository(CarryoverLotAllocation)
      .createQueryBuilder('allocation')
      .setLock('pessimistic_write')
      .where('allocation.leaveRequestId = :id', { id: leaveRequestId })
      .andWhere('allocation.operationType = :op', {
        op: CarryoverLotAllocationOperation.RESERVATION,
      })
      .getMany();
  }

  private async assertNotAlreadyProcessed(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<void> {
    const processed = await manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .setLock('pessimistic_write')
      .where('movement.leaveRequestId = :id', { id: leaveRequestId })
      .andWhere('movement.movementType IN (:...types)', {
        types: [
          BalanceMovementType.DEDUCTION,
          BalanceMovementType.LIBERATION_RESERVATION,
        ],
      })
      .getMany();
    if (processed.length > 0) {
      throw new ConflictException('Cette réservation a déjà été consommée ou libérée.');
    }
  }

  private async assertNoRecredit(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<void> {
    const recredits = await manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .setLock('pessimistic_write')
      .where('movement.leaveRequestId = :id', { id: leaveRequestId })
      .andWhere('movement.movementType = :type', { type: BalanceMovementType.RECREDIT })
      .getMany();
    if (recredits.length > 0) {
      throw new ConflictException('Cette demande a déjà été restituée.');
    }
  }

  private lotToInput(lot: CarryoverLot): ConsumableLotInput {
    return {
      id: lot.id,
      remainingDays: lot.remainingDays,
      expiresAt: lot.expiresAt,
      status: lot.status,
      confirmationStatus: lot.confirmationStatus,
      reconciled: lot.reconciled,
    };
  }

  private isDuplicateError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  private async guard<T>(
    fn: () => Promise<T>,
    duplicateMessage: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (this.isDuplicateError(error)) {
        throw new ConflictException(duplicateMessage);
      }
      throw error;
    }
  }

  private async audit(
    manager: EntityManager,
    leaveRequestId: number,
    actorId: number | null | undefined,
    action: string,
    result: CarryoverLotLedgerResult,
  ): Promise<void> {
    await this.auditService.record(
      {
        actorId: actorId ?? null,
        action,
        resourceType: 'CARRYOVER_LOT_ALLOCATION',
        resourceId: leaveRequestId,
        newValue: {
          operation: result.operation,
          totalLotDays: result.totalLotDays,
          regularisationDays: result.regularisationDays ?? 0,
          allocations: result.allocations,
          uncovered: result.uncovered,
          skipped: result.skipped,
        },
      },
      manager,
    );
  }
}
