import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { HolidaysService } from '../../holidays/holidays.service';
import { LeaveType } from '../../leave-types/leave-type.entity';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../../leave-requests/leave-request.entity';
import { User, UserRole } from '../../users/user.entity';
import { BalanceMovement, BalanceMovementType } from '../balance-movement.entity';
import { LeaveBalance, LeaveBalanceCounterType } from '../leave-balance.entity';
import { CarryoverLot, CarryoverLotTargetCounter } from '../carryover-lot.entity';
import {
  CarryoverLotAllocation,
  CarryoverLotAllocationOperation,
} from './carryover-lot-allocation.entity';
import {
  allocateCarryoverLots,
  calculateDeductedLeaveDayList,
  ConsumableLotInput,
  DatedLeaveDay,
  isLotConsumable,
} from '../carryover-allocation.core';
import { isCarryoverLotsEnvironmentAllowed } from './carryover-lots.service';
import { CarryoverLotLedgerService } from './carryover-lot-ledger.service';
import {
  ConsumeCarryoverAllocationDto,
  FinalizeCarryoverAllocationDto,
  PreviewCarryoverAllocationDto,
  ReleaseCarryoverAllocationDto,
  ReserveCarryoverAllocationDto,
  RestoreCarryoverAllocationDto,
} from './dto/carryover-allocation.dto';

const round2 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const sumDays = (days: DatedLeaveDay[]): number =>
  round2(days.reduce((total, d) => total + d.value, 0));

interface Plan {
  totalDays: number;
  datedDays: DatedLeaveDay[];
  lotAlloc: ReturnType<typeof allocateCarryoverLots>;
  ordinaryAlloc: Array<{ balanceId: number; days: number }>;
  balanceById: Map<number, LeaveBalance>;
  lotById: Map<number, CarryoverLot>;
  skipped: Array<{ lotId: number; reason: string }>;
}

@Injectable()
export class CarryoverLotAllocationService {
  constructor(
    @InjectRepository(CarryoverLot)
    private readonly lotRepository: Repository<CarryoverLot>,
    @InjectRepository(CarryoverLotAllocation)
    private readonly allocationRepository: Repository<CarryoverLotAllocation>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepository: Repository<LeaveBalance>,
    @InjectRepository(BalanceMovement)
    private readonly movementRepository: Repository<BalanceMovement>,
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,
    @InjectRepository(LeaveType)
    private readonly leaveTypeRepository: Repository<LeaveType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly holidaysService: HolidaysService,
    private readonly ledger: CarryoverLotLedgerService,
  ) {}

  private assertEnvironment(): void {
    const flag = this.configService.get<string>('CARRYOVER_LOTS_ENABLED');
    const database = this.dataSource.options.database;
    if (
      !isCarryoverLotsEnvironmentAllowed(
        flag,
        typeof database === 'string' ? database : undefined,
      )
    ) {
      throw new NotFoundException('Fonctionnalité indisponible.');
    }
  }

  private assertRh(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.RH) {
      throw new ForbiddenException('Vous ne disposez pas des autorisations nécessaires.');
    }
  }

  private isDuplicateError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  private async findAlreadyProcessed(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<BalanceMovement[]> {
    return manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .setLock('pessimistic_write')
      .where('movement.leaveRequestId = :leaveRequestId', { leaveRequestId })
      .andWhere('movement.movementType IN (:...types)', {
        types: [
          BalanceMovementType.DEDUCTION,
          BalanceMovementType.LIBERATION_RESERVATION,
        ],
      })
      .getMany();
  }

  private async serverNonDeductible(startDate: string, endDate: string): Promise<Set<string>> {
    const holidays = await this.holidaysService.findNonDeductibleBetween(startDate, endDate);
    return new Set(holidays.map((h) => h.date));
  }

  private async loadRequest(
    leaveRequestId: number,
    allowedStatuses: LeaveRequestStatus[],
  ): Promise<LeaveRequest> {
    const request = await this.leaveRequestRepository.findOne({
      where: { id: leaveRequestId },
      relations: { leaveType: true },
    });
    if (!request) {
      throw new NotFoundException(`Demande #${leaveRequestId} introuvable.`);
    }
    if (!allowedStatuses.includes(request.status)) {
      throw new BadRequestException(
        `Statut ${request.status} non autorisé pour cette opération (attendu : ${allowedStatuses.join(' ou ')}).`,
      );
    }
    if (!request.leaveType?.deductsPaidLeaveBalance) {
      throw new BadRequestException(
        'Le type de congé de cette demande ne décompte pas de congés payés.',
      );
    }
    return request;
  }

  async preview(
    employeeId: number,
    dto: PreviewCarryoverAllocationDto,
  ): Promise<unknown> {
    this.assertEnvironment();
    const nonDeductible = await this.serverNonDeductible(dto.startDate, dto.endDate);
    const datedDays = calculateDeductedLeaveDayList(
      dto.startDate,
      dto.endDate,
      dto.startPeriod,
      dto.endPeriod,
      nonDeductible,
    );
    const lots = await this.lotRepository.find({
      where: { employeeId, targetCounterType: CarryoverLotTargetCounter.N_MINUS_1 },
      order: { expiresAt: 'ASC', id: 'ASC' },
    });
    const result = allocateCarryoverLots(
      datedDays,
      lots.map((lot) => this.lotToInput(lot)),
    );
    return { totalDays: sumDays(datedDays), datedDays, ...result };
  }

  async consume(dto: ConsumeCarryoverAllocationDto, actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const request = await this.loadRequest(dto.leaveRequestId, [LeaveRequestStatus.VALIDEE]);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const plan = await this.buildPlan(manager, request, dto.referencePeriod);

        const existing = await manager.getRepository(BalanceMovement).find({
          where: {
            leaveRequestId: dto.leaveRequestId,
            movementType: BalanceMovementType.DEDUCTION,
          },
        });
        if (existing.length > 0) {
          throw new ConflictException('Cette demande a déjà été consommée.');
        }

        const summary = await this.writePlan(
          manager,
          request,
          dto.leaveRequestId,
          plan,
          BalanceMovementType.DEDUCTION,
          CarryoverLotAllocationOperation.CONSUMPTION,
          actor,
          dto.reason,
        );
        return summary;
      });
    } catch (error) {
      if (this.isDuplicateError(error)) {
        throw new ConflictException('Consommation concurrente détectée.');
      }
      throw error;
    }
  }

  async reserve(dto: ReserveCarryoverAllocationDto, actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const request = await this.loadRequest(dto.leaveRequestId, [
      LeaveRequestStatus.EN_ATTENTE_VALIDATION,
      LeaveRequestStatus.VALIDEE,
    ]);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const plan = await this.buildPlan(manager, request, dto.referencePeriod);

        const existing = await manager.getRepository(CarryoverLotAllocation).find({
          where: {
            leaveRequestId: dto.leaveRequestId,
            operationType: CarryoverLotAllocationOperation.RESERVATION,
          },
        });
        if (existing.length > 0) {
          throw new ConflictException('Cette demande a déjà été réservée.');
        }

        const summary = await this.writePlan(
          manager,
          request,
          dto.leaveRequestId,
          plan,
          BalanceMovementType.RESERVATION,
          CarryoverLotAllocationOperation.RESERVATION,
          actor,
          dto.reason,
        );
        return summary;
      });
    } catch (error) {
      if (this.isDuplicateError(error)) {
        throw new ConflictException('Réservation concurrente détectée.');
      }
      throw error;
    }
  }

  async restore(dto: RestoreCarryoverAllocationDto, actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const request = await this.loadRequest(dto.leaveRequestId, [
      LeaveRequestStatus.VALIDEE,
      LeaveRequestStatus.ANNULEE,
    ]);

    try {
      return await this.dataSource.transaction(async (manager) => {
      // Contrôle d'état en LECTURE VERROUILLÉE (courante), pas en snapshot
      // REPEATABLE READ : deux restore simultanés sont ainsi sérialisés.
      const recredits = await manager
        .getRepository(BalanceMovement)
        .createQueryBuilder('movement')
        .setLock('pessimistic_write')
        .where('movement.leaveRequestId = :id', { id: dto.leaveRequestId })
        .andWhere('movement.movementType = :type', { type: BalanceMovementType.RECREDIT })
        .getMany();
      if (recredits.length > 0) {
        throw new ConflictException('Cette demande a déjà été restituée.');
      }

      const reversed = await manager
        .getRepository(CarryoverLotAllocation)
        .createQueryBuilder('allocation')
        .setLock('pessimistic_write')
        .where('allocation.leaveRequestId = :id', { id: dto.leaveRequestId })
        .andWhere('allocation.operationType IN (:...ops)', {
          ops: [
            CarryoverLotAllocationOperation.ANNULATION,
            CarryoverLotAllocationOperation.REGULARISATION,
          ],
        })
        .getMany();
      if (reversed.length > 0) {
        throw new ConflictException('Cette demande a déjà été restituée.');
      }

      const rows = await manager.getRepository(CarryoverLotAllocation).find({
        where: {
          leaveRequestId: dto.leaveRequestId,
          operationType: CarryoverLotAllocationOperation.CONSUMPTION,
        },
      });

      const consumptionByMovement = new Map<number, CarryoverLotAllocation>();
      for (const row of rows) consumptionByMovement.set(row.movementId ?? 0, row);

      const movements = await manager.getRepository(BalanceMovement).find({
        where: {
          leaveRequestId: dto.leaveRequestId,
          movementType: BalanceMovementType.DEDUCTION,
        },
      });
      if (movements.length === 0) {
        throw new NotFoundException('Aucune consommation pour cette demande.');
      }

      let restoredDays = 0;
      let regularisationDays = 0;

      for (const movement of movements) {
        const consumption = consumptionByMovement.get(movement.id);

        if (consumption) {
          // Restitution du lot → moteur transactionnel commun.
          const { expired } = await this.ledger.restoreLotAfterConsumptionWithManager(
            manager,
            {
              consumption,
              movement,
              actorId: actor.id,
              reason: dto.reason ?? 'Restitution après annulation.',
            },
          );
          const days = round2(Number(movement.days));
          if (expired) {
            regularisationDays = round2(regularisationDays + days);
          } else {
            restoredDays = round2(restoredDays + days);
          }
          continue;
        }

        // Mouvement ordinaire : recrédit classique.
        const balance = await manager
          .getRepository(LeaveBalance)
          .createQueryBuilder('balance')
          .setLock('pessimistic_write')
          .where('balance.id = :id', { id: movement.leaveBalanceId })
          .getOne();
        if (balance) {
          const before = round2(Number(balance.availableDays));
          balance.consumedDays = round2(Number(balance.consumedDays) - Number(movement.days));
          balance.availableDays = round2(Number(balance.availableDays) + Number(movement.days));
          await manager.getRepository(LeaveBalance).save(balance);
          await manager.getRepository(BalanceMovement).save(
            manager.getRepository(BalanceMovement).create({
              employeeId: movement.employeeId,
              leaveBalanceId: movement.leaveBalanceId,
              leaveRequestId: movement.leaveRequestId,
              actorId: actor.id,
              movementType: BalanceMovementType.RECREDIT,
              days: movement.days,
              balanceBefore: before,
              balanceAfter: balance.availableDays,
              reason: 'Recrédit L4 — jours ordinaires.',
            }),
          );
        }
        restoredDays = round2(restoredDays + Number(movement.days));
      }

      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_LOT_RESTORED',
          resourceType: 'CARRYOVER_LOT_ALLOCATION',
          resourceId: dto.leaveRequestId,
          newValue: { restoredDays, regularisationDays },
        },
        manager,
      );

      return { restoredDays, regularisationDays };
      });
    } catch (error) {
      if (this.isDuplicateError(error)) {
        throw new ConflictException('Restitution concurrente détectée.');
      }
      throw error;
    }
  }

  async release(dto: ReleaseCarryoverAllocationDto, actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const request = await this.loadRequest(dto.leaveRequestId, [
      LeaveRequestStatus.EN_ATTENTE_VALIDATION,
      LeaveRequestStatus.REFUSEE,
    ]);

    return this.dataSource.transaction(async (manager) => {
      const movements = await manager.getRepository(BalanceMovement).find({
        where: {
          leaveRequestId: dto.leaveRequestId,
          movementType: BalanceMovementType.RESERVATION,
        },
      });
      if (movements.length === 0) {
        throw new NotFoundException('Aucune réservation active pour cette demande.');
      }

      const rows = await manager.getRepository(CarryoverLotAllocation).find({
        where: {
          leaveRequestId: dto.leaveRequestId,
          operationType: CarryoverLotAllocationOperation.RESERVATION,
        },
      });
      const reservationByMovement = new Map<number, CarryoverLotAllocation>();
      for (const row of rows) reservationByMovement.set(row.movementId ?? 0, row);

      // Partie lots → moteur transactionnel commun (libération + restitution).
      let releasedDays = 0;
      if (rows.length > 0) {
        const lotResult = await this.ledger.releaseWithManager(manager, {
          leaveRequestId: dto.leaveRequestId,
          actorId: actor.id,
          reason: dto.reason ?? 'Libération de réservation.',
        });
        releasedDays = round2(lotResult.totalLotDays);
      } else {
        const alreadyProcessed = await this.findAlreadyProcessed(manager, dto.leaveRequestId);
        if (alreadyProcessed.length > 0) {
          throw new ConflictException('Cette réservation a déjà été finalisée ou libérée.');
        }
      }

      // Partie ordinaire : mouvements sans allocation de lot.
      for (const movement of movements) {
        if (reservationByMovement.has(movement.id)) continue;
        const balance = await manager
          .getRepository(LeaveBalance)
          .createQueryBuilder('balance')
          .setLock('pessimistic_write')
          .where('balance.id = :id', { id: movement.leaveBalanceId })
          .getOne();
        if (!balance) continue;
        const before = round2(Number(balance.availableDays));
        balance.reservedDays = round2(Number(balance.reservedDays) - Number(movement.days));
        await manager.getRepository(LeaveBalance).save(balance);
        await manager.getRepository(BalanceMovement).save(
          manager.getRepository(BalanceMovement).create({
            employeeId: movement.employeeId,
            leaveBalanceId: movement.leaveBalanceId,
            leaveRequestId: movement.leaveRequestId,
            actorId: actor.id,
            movementType: BalanceMovementType.LIBERATION_RESERVATION,
            days: movement.days,
            balanceBefore: before,
            balanceAfter: balance.availableDays,
            reason: 'Libération L4 — réservation de report maladie.',
          }),
        );
        releasedDays = round2(releasedDays + Number(movement.days));
      }

      return { releasedDays };
    });
  }

  async finalize(
    dto: FinalizeCarryoverAllocationDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const request = await this.loadRequest(dto.leaveRequestId, [
      LeaveRequestStatus.EN_ATTENTE_VALIDATION,
    ]);

    return this.dataSource.transaction(async (manager) => {
      const reservationMovements = await manager.getRepository(BalanceMovement).find({
        where: {
          leaveRequestId: dto.leaveRequestId,
          movementType: BalanceMovementType.RESERVATION,
        },
      });
      if (reservationMovements.length === 0) {
        throw new NotFoundException('Aucune réservation active pour cette demande.');
      }

      const reservedTotal = round2(
        reservationMovements.reduce((sum, m) => sum + Number(m.days), 0),
      );
      if (reservedTotal !== round2(Number(request.deductedDays))) {
        throw new ConflictException(
          `Réservation incohérente : ${reservedTotal} j réservés pour ${Number(request.deductedDays)} j demandés.`,
        );
      }

      const reservationRows = await manager
        .getRepository(CarryoverLotAllocation)
        .find({
          where: {
            leaveRequestId: dto.leaveRequestId,
            operationType: CarryoverLotAllocationOperation.RESERVATION,
          },
        });

      const reservationByMovement = new Map<number, CarryoverLotAllocation>();
      for (const row of reservationRows) {
        reservationByMovement.set(row.movementId ?? 0, row);
      }

      if (dto.decision === 'REFUSE') {
        // Partie lots → moteur transactionnel commun.
        let releasedDays = 0;
        if (reservationRows.length > 0) {
          const lotResult = await this.ledger.releaseWithManager(manager, {
            leaveRequestId: dto.leaveRequestId,
            actorId: actor.id,
            reason: dto.reason ?? 'Refus — libération de la réservation.',
          });
          releasedDays = round2(lotResult.totalLotDays);
        } else {
          const alreadyProcessed = await this.findAlreadyProcessed(manager, dto.leaveRequestId);
          if (alreadyProcessed.length > 0) {
            throw new ConflictException('Cette réservation a déjà été finalisée ou libérée.');
          }
        }

        // Partie ordinaire.
        for (const movement of reservationMovements) {
          if (reservationByMovement.has(movement.id)) continue;
          const balance = await manager
            .getRepository(LeaveBalance)
            .createQueryBuilder('balance')
            .setLock('pessimistic_write')
            .where('balance.id = :id', { id: movement.leaveBalanceId })
            .getOne();
          if (!balance) continue;
          const before = round2(Number(balance.availableDays));
          balance.reservedDays = round2(Number(balance.reservedDays) - Number(movement.days));
          await manager.getRepository(LeaveBalance).save(balance);
          await manager.getRepository(BalanceMovement).save(
            manager.getRepository(BalanceMovement).create({
              employeeId: movement.employeeId,
              leaveBalanceId: movement.leaveBalanceId,
              leaveRequestId: movement.leaveRequestId,
              actorId: actor.id,
              movementType: BalanceMovementType.LIBERATION_RESERVATION,
              days: movement.days,
              balanceBefore: before,
              balanceAfter: balance.availableDays,
              reason: 'Libération L4 — refus de la demande.',
            }),
          );
          releasedDays = round2(releasedDays + Number(movement.days));
        }
        return { decision: 'REFUSE', releasedDays };
      }

      // VALIDATE : transformation réservation → consommation, sans double décrément.
      let processedDays = 0;
      if (reservationRows.length > 0) {
        const lotResult = await this.ledger.consumeReservationWithManager(manager, {
          leaveRequestId: dto.leaveRequestId,
          actorId: actor.id,
          reason: dto.reason ?? 'Consommation après validation.',
        });
        processedDays = round2(lotResult.totalLotDays);
      } else {
        const alreadyProcessed = await this.findAlreadyProcessed(manager, dto.leaveRequestId);
        if (alreadyProcessed.length > 0) {
          throw new ConflictException('Cette réservation a déjà été finalisée ou libérée.');
        }
      }

      // Partie ordinaire.
      for (const movement of reservationMovements) {
        if (reservationByMovement.has(movement.id)) continue;
        const balance = await manager
          .getRepository(LeaveBalance)
          .createQueryBuilder('balance')
          .setLock('pessimistic_write')
          .where('balance.id = :id', { id: movement.leaveBalanceId })
          .getOne();
        if (!balance) continue;
        const before = round2(Number(balance.availableDays));
        balance.reservedDays = round2(Number(balance.reservedDays) - Number(movement.days));
        balance.consumedDays = round2(Number(balance.consumedDays) + Number(movement.days));
        balance.availableDays = round2(before - Number(movement.days));
        await manager.getRepository(LeaveBalance).save(balance);
        await manager.getRepository(BalanceMovement).save(
          manager.getRepository(BalanceMovement).create({
            employeeId: movement.employeeId,
            leaveBalanceId: movement.leaveBalanceId,
            leaveRequestId: movement.leaveRequestId,
            actorId: actor.id,
            movementType: BalanceMovementType.DEDUCTION,
            days: movement.days,
            balanceBefore: before,
            balanceAfter: balance.availableDays,
            reason: 'Déduction L4 — validation de la réservation.',
          }),
        );
        processedDays = round2(processedDays + Number(movement.days));
      }

      return { decision: 'VALIDATE', processedDays };
    });
  }

  // ------------------------------------------------------------------
  // Coherent plan builder + writer
  // ------------------------------------------------------------------
  private async buildPlan(
    manager: EntityManager,
    request: LeaveRequest,
    referencePeriod: string,
  ): Promise<Plan> {
    const nonDeductible = await this.serverNonDeductible(request.startDate, request.endDate);
    const datedDays = calculateDeductedLeaveDayList(
      request.startDate,
      request.endDate,
      request.startPeriod,
      request.endPeriod,
      nonDeductible,
    );
    const totalDays = sumDays(datedDays);
    if (round2(totalDays) !== round2(Number(request.deductedDays))) {
      throw new BadRequestException(
        `Quantité incohérente : demande ${Number(request.deductedDays)} j, calcul ${totalDays} j.`,
      );
    }

    // Verrouille les LOTS avant les compteurs (ordre cohérent avec le ledger
    // E2, afin d'éviter un deadlock entre les chemins L4 et E2).
    const lots = await manager
      .getRepository(CarryoverLot)
      .createQueryBuilder('lot')
      .setLock('pessimistic_write')
      .where('lot.employeeId = :employeeId', { employeeId: request.employeeId })
      .andWhere('lot.targetCounterType = :counter', { counter: CarryoverLotTargetCounter.N_MINUS_1 })
      .orderBy('lot.expiresAt', 'ASC')
      .addOrderBy('lot.id', 'ASC')
      .getMany();

    const nMinus1 = await this.lockBalances(manager, request.employeeId, LeaveBalanceCounterType.N_MINUS_1);
    const nBalance = await this.lockBalance(manager, request.employeeId, referencePeriod, LeaveBalanceCounterType.N);
    if (!nBalance) {
      throw new NotFoundException(`Compteur N introuvable pour la période ${referencePeriod}.`);
    }

    const balanceByPeriod = new Map<string, LeaveBalance>();
    for (const balance of nMinus1) balanceByPeriod.set(balance.referencePeriod, balance);

    const eligible: ConsumableLotInput[] = [];
    const skipped: Plan['skipped'] = [];
    for (const lot of lots) {
      const eligibility = isLotConsumable(this.lotToInput(lot));
      if (!eligibility.consumable) {
        skipped.push({ lotId: lot.id, reason: eligibility.reason ?? 'INELIGIBLE' });
        continue;
      }
      if (!balanceByPeriod.has(lot.targetReferencePeriod)) {
        skipped.push({ lotId: lot.id, reason: 'CONTREPARTIE_ABSENTE' });
        continue;
      }
      eligible.push(this.lotToInput(lot));
    }

    const lotAlloc = allocateCarryoverLots(datedDays, eligible);
    for (const skip of lotAlloc.skipped) skipped.push(skip);

    const lotById = new Map<number, CarryoverLot>();
    for (const lot of lots) lotById.set(lot.id, lot);
    const balanceById = new Map<number, LeaveBalance>();
    for (const balance of [...nMinus1, nBalance]) balanceById.set(balance.id, balance);

    // Droits protégés / en attente par compteur (jamais consommables en
    // jours ordinaires).
    const protectedByBalance = new Map<number, number>();
    const ambiguousByBalance = new Set<number>();
    for (const balance of nMinus1) {
      const lotsOnCounter = lots.filter(
        (lot) => lot.targetReferencePeriod === balance.referencePeriod,
      );
      const knownSum = round2(
        lotsOnCounter
          .filter((lot) => lot.remainingDays != null)
          .reduce((sum, lot) => sum + Number(lot.remainingDays), 0),
      );
      const hasUnknown = lotsOnCounter.some((lot) => lot.remainingDays == null);
      protectedByBalance.set(balance.id, knownSum);
      if (hasUnknown) ambiguousByBalance.add(balance.id);
    }

    // Quantités gelées en attente de régularisation RH (encore dans le solde).
    const regularisationRows = await manager
      .getRepository(CarryoverLotAllocation)
      .find({
        where: {
          operationType: CarryoverLotAllocationOperation.REGULARISATION,
          frozenInBalance: true,
        },
      });
    const frozenByBalance = new Map<number, number>();
    for (const row of regularisationRows) {
      if (row.leaveBalanceId != null) {
        frozenByBalance.set(
          row.leaveBalanceId,
          round2((frozenByBalance.get(row.leaveBalanceId) ?? 0) + Number(row.days)),
        );
      }
    }

    // Invariant unifié avec le ledger E2 (anti-sur-réservation) :
    //   ∑(reliquats de lots connus) + jours réservés + jours gelés ≤ disponible.
    for (const balance of nMinus1) {
      const protectedDays = protectedByBalance.get(balance.id) ?? 0;
      const reservedDays = round2(Number(balance.reservedDays));
      const frozenDays = frozenByBalance.get(balance.id) ?? 0;
      if (
        round2(protectedDays + reservedDays + frozenDays) >
        round2(Number(balance.availableDays))
      ) {
        throw new BadRequestException(
          `Compteur N-1 ${balance.referencePeriod} insuffisant : disponibles ${Number(balance.availableDays)} j < lots ${protectedDays} j + réservés ${reservedDays} j + gelés ${frozenDays} j.`,
        );
      }
    }

    // Jours de lots par compteur (pour la validation finale).
    const lotDaysByBalance = new Map<number, number>();
    for (const alloc of lotAlloc.allocations) {
      const lot = lotById.get(alloc.lotId);
      if (!lot) continue;
      const balance = balanceByPeriod.get(lot.targetReferencePeriod);
      if (!balance) continue;
      lotDaysByBalance.set(balance.id, round2((lotDaysByBalance.get(balance.id) ?? 0) + alloc.days));
    }

    // Jours ordinaires restants, en préservant les droits protégés/réservés.
    const ordinaryAlloc = this.allocateOrdinary(
      sumDays(lotAlloc.uncovered),
      nMinus1,
      nBalance,
      protectedByBalance,
      ambiguousByBalance,
      frozenByBalance,
    );

    // Validation : chaque compteur doit couvrir lot + ordinaire.
    for (const balance of [...nMinus1, nBalance]) {
      const lotDays = lotDaysByBalance.get(balance.id) ?? 0;
      const ordinaryDays = ordinaryAlloc.filter((a) => a.balanceId === balance.id).reduce((s, a) => s + a.days, 0);
      if (round2(lotDays + ordinaryDays) > round2(Number(balance.availableDays))) {
        throw new BadRequestException(
          `Incohérence lot/compteur : le reliquat des lots dépasse le compteur ${balance.referencePeriod} ${balance.counterType}.`,
        );
      }
    }

    return {
      totalDays,
      datedDays,
      lotAlloc,
      ordinaryAlloc,
      balanceById,
      lotById,
      skipped,
    };
  }

  private allocateOrdinary(
    uncovered: number,
    nMinus1: LeaveBalance[],
    nBalance: LeaveBalance,
    protectedByBalance: Map<number, number>,
    ambiguousByBalance: Set<number>,
    frozenByBalance: Map<number, number>,
  ): Array<{ balanceId: number; days: number }> {
    const allocations: Array<{ balanceId: number; days: number }> = [];
    let remaining = round2(uncovered);
    for (const balance of nMinus1) {
      if (remaining <= 0) break;
      // Un compteur dont le reliquat est inconnu ne peut pas être utilisé en
      // jours ordinaires : son origine exacte n'est pas démontrable.
      if (ambiguousByBalance.has(balance.id)) continue;
      const protectedDays = protectedByBalance.get(balance.id) ?? 0;
      const frozenDays = frozenByBalance.get(balance.id) ?? 0;
      const capacity = round2(
        Number(balance.availableDays) -
          Number(balance.reservedDays) -
          protectedDays -
          frozenDays,
      );
      if (capacity <= 0) continue;
      const take = round2(Math.min(capacity, remaining));
      allocations.push({ balanceId: balance.id, days: take });
      remaining = round2(remaining - take);
    }
    if (remaining > 0) {
      const nCapacity = round2(
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

  private async writePlan(
    manager: EntityManager,
    request: LeaveRequest,
    leaveRequestId: number,
    plan: Plan,
    movementType: BalanceMovementType,
    operationType: CarryoverLotAllocationOperation,
    actor: AuthenticatedUser,
    reason?: string,
  ): Promise<unknown> {
    const isConsumption = movementType === BalanceMovementType.DEDUCTION;

    // Mouvements par lot → moteur transactionnel commun (une seule implémentation).
    await this.ledger.writeLotMovementsWithManager(manager, {
      employeeId: request.employeeId,
      leaveRequestId,
      allocations: plan.lotAlloc.allocations.map((a) => ({
        lotId: a.lotId,
        days: a.days,
        dates: a.dates,
      })),
      lotsById: plan.lotById,
      balancesById: plan.balanceById,
      movementType,
      operationType,
      actorId: actor.id,
      reason: reason ?? (isConsumption ? 'Déduction L4 — report maladie.' : 'Réservation L4 — report maladie.'),
    });

    // Mouvements ordinaires.
    for (const ordinary of plan.ordinaryAlloc) {
      const balance = plan.balanceById.get(ordinary.balanceId);
      if (!balance) continue;
      const before = round2(Number(balance.availableDays));
      if (isConsumption) {
        balance.consumedDays = round2(Number(balance.consumedDays) + ordinary.days);
        balance.availableDays = round2(before - ordinary.days);
      } else {
        balance.reservedDays = round2(Number(balance.reservedDays) + ordinary.days);
      }
      await manager.getRepository(LeaveBalance).save(balance);
      await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: request.employeeId,
          leaveBalanceId: balance.id,
          leaveRequestId,
          actorId: actor.id,
          movementType,
          days: ordinary.days,
          balanceBefore: before,
          balanceAfter: balance.availableDays,
          reason: isConsumption ? 'Déduction L4 — jours ordinaires.' : 'Réservation L4 — jours ordinaires.',
        }),
      );
    }

    await this.auditService.record(
      {
        actorId: actor.id,
        action: isConsumption ? 'CARRYOVER_LOT_ALLOCATED' : 'CARRYOVER_LOT_RESERVED',
        resourceType: 'CARRYOVER_LOT_ALLOCATION',
        resourceId: leaveRequestId,
        newValue: {
          totalDays: plan.totalDays,
          lotAllocations: plan.lotAlloc.allocations,
          ordinaryAllocations: plan.ordinaryAlloc,
          uncovered: plan.lotAlloc.uncovered,
        },
      },
      manager,
    );

    return {
      totalDays: plan.totalDays,
      datedDays: plan.datedDays,
      lotAllocations: plan.lotAlloc.allocations,
      ordinaryAllocations: plan.ordinaryAlloc,
      uncovered: plan.lotAlloc.uncovered,
      skipped: plan.skipped,
    };
  }

  private lotToInput(lot: CarryoverLot) {
    return {
      id: lot.id,
      remainingDays: lot.remainingDays,
      expiresAt: lot.expiresAt,
      status: lot.status,
      confirmationStatus: lot.confirmationStatus,
      reconciled: lot.reconciled,
    };
  }

  private async lockBalances(
    manager: EntityManager,
    employeeId: number,
    counterType: LeaveBalanceCounterType,
  ): Promise<LeaveBalance[]> {
    return manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', { employeeId })
      .andWhere('balance.counterType = :counterType', { counterType })
      .orderBy('balance.referencePeriod', 'ASC')
      .addOrderBy('balance.id', 'ASC')
      .getMany();
  }

  private async lockBalance(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
    counterType: LeaveBalanceCounterType,
  ): Promise<LeaveBalance | null> {
    return manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', { referencePeriod })
      .andWhere('balance.counterType = :counterType', { counterType })
      .getOne();
  }
}
