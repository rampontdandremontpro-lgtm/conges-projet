import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { Setting } from '../settings/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import {
  BalanceProcessingStatus,
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { CloseReferencePeriodDto } from './dto/close-reference-period.dto';
import { ExceptionalCarryoverDto } from './dto/exceptional-carryover.dto';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import { roundPeriodCloseDays, roundAcquiredDaysUp } from './reference-period-rounding.util';
import { withPeriodClosureLock } from './period-closure-lock.util';
import { referencePeriodStartDate } from './reference-period.util';
import {
  applyCarryoverLotPlan,
  buildCarryoverLotPlan,
  classifyCarryoverLot,
} from './carryover-lots/carryover-lot-closure.core';
import { CarryoverLot, CarryoverLotTargetCounter } from './carryover-lot.entity';
import {
  CarryoverLotAllocation,
  CarryoverLotAllocationOperation,
} from './carryover-lots/carryover-lot-allocation.entity';

interface ClosureEmployeePreview {
  employeeId: number;
  employeeName: string;
  nMinus1Remaining: number;
  nRemainingToTransfer: number;
  nToTransfer: number;
  roundingSupplement: number;
  nMinus1ToReset: number;
  nPlus1Forecast: number;
  nPlus1ToReset: number;
  reservedDays: number;
  negativeBalances: Array<{
    counterType: LeaveBalanceCounterType;
    availableDays: number;
  }>;
  exceptionalCarryoverAlreadyApproved: number;
}

@Injectable()
export class ReferencePeriodService {
  constructor(
    @InjectRepository(LeaveBalance)
    private readonly balanceRepository: Repository<LeaveBalance>,
    @InjectRepository(BalanceMovement)
    private readonly movementRepository: Repository<BalanceMovement>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async previewClosure(referencePeriod: string) {
    const nextReferencePeriod = this.nextReferencePeriod(referencePeriod);
    const expectedEndDate = await this.referencePeriodEndDate(referencePeriod);
    const marker = await this.settingsService.getValue(
      this.closureMarkerKey(referencePeriod),
    );
    const balances = await this.balanceRepository.find({
      where: { referencePeriod },
      relations: { employee: true },
      order: { employeeId: 'ASC' },
    });
    const grouped = new Map<number, LeaveBalance[]>();

    for (const balance of balances) {
      const list = grouped.get(balance.employeeId) ?? [];
      list.push(balance);
      grouped.set(balance.employeeId, list);
    }

    // Totaux d'acquisition (mouvements ACQUISITION) pour chaque compteur N de
    // la période, afin de reproduire exactement le supplément L3141-7 appliqué
    // à la clôture. Une seule requête groupée évite les appels N+1.
    const nBalances = balances.filter(
      (balance) => balance.counterType === LeaveBalanceCounterType.N,
    );
    const acquisitionTotals = new Map<number, number>();
    if (nBalances.length > 0) {
      const ids = nBalances.map((balance) => balance.id);
      const rows = await this.movementRepository
        .createQueryBuilder('movement')
        .select('movement.leaveBalanceId', 'leaveBalanceId')
        .addSelect('COALESCE(SUM(movement.days), 0)', 'total')
        .where('movement.leaveBalanceId IN (:...ids)', { ids })
        .andWhere('movement.movementType = :movementType', {
          movementType: BalanceMovementType.ACQUISITION,
        })
        .groupBy('movement.leaveBalanceId')
        .getRawMany<{ leaveBalanceId: number; total: string }>();

      for (const row of rows) {
        acquisitionTotals.set(
          Number(row.leaveBalanceId),
          this.round(Number(row.total)),
        );
      }
    }

    const employees: ClosureEmployeePreview[] = [];
    for (const [employeeId, employeeBalances] of grouped.entries()) {
      const employee = employeeBalances[0].employee;
      const nMinus1 = employeeBalances.find(
        (balance) =>
          balance.counterType === LeaveBalanceCounterType.N_MINUS_1,
      );
      const n = employeeBalances.find(
        (balance) => balance.counterType === LeaveBalanceCounterType.N,
      );
      const nPlus1 = employeeBalances.find(
        (balance) =>
          balance.counterType === LeaveBalanceCounterType.N_PLUS_1,
      );

      const nMinus1Remaining = this.round(nMinus1?.availableDays ?? 0);
      const nAvailable = this.round(n?.availableDays ?? 0);
      const nPlus1Forecast = this.round(nPlus1?.availableDays ?? 0);

      // Supplément L3141-7 (droit acquis de base → entier supérieur, plafond
      // 30), identique au traitement de closeReferencePeriod.
      let roundingSupplement = 0;
      if (n) {
        const baseAcquired = acquisitionTotals.get(n.id) ?? 0;
        roundingSupplement = this.round(
          roundAcquiredDaysUp(baseAcquired) - baseAcquired,
        );
      }

      const nToTransfer = roundPeriodCloseDays(
        nAvailable + roundingSupplement,
      );
      const nMinus1ToReset =
        nMinus1Remaining > 0 ? nMinus1Remaining : 0;
      const nPlus1ToReset = nPlus1Forecast > 0 ? nPlus1Forecast : 0;
      const reservedDays = this.round(
        employeeBalances.reduce(
          (sum, balance) => sum + balance.reservedDays,
          0,
        ),
      );
      const negativeBalances = employeeBalances
        .filter((balance) => this.round(balance.availableDays) < 0)
        .map((balance) => ({
          counterType: balance.counterType,
          availableDays: this.round(balance.availableDays),
        }));

      employees.push({
        employeeId,
        employeeName: `${employee.nom} ${employee.prenom}`,
        nMinus1Remaining,
        nRemainingToTransfer: nAvailable,
        nToTransfer,
        roundingSupplement,
        nMinus1ToReset,
        nPlus1Forecast,
        nPlus1ToReset,
        reservedDays,
        negativeBalances,
        exceptionalCarryoverAlreadyApproved:
          await this.getApprovedCarryover(
            employeeId,
            referencePeriod,
            nextReferencePeriod,
          ),
      });
    }

    const blockingRequests = await this.findBlockingLeaveRequests(
      referencePeriod,
    );

    return {
      referencePeriod,
      nextReferencePeriod,
      expectedEndDate,
      alreadyClosed: marker !== null,
      closedAt: marker,
      blockedByReservations: employees.some(
        (employee) => employee.reservedDays > 0,
      ),
      employeeCount: employees.length,
      reservationCount: employees.filter(
        (employee) => employee.reservedDays > 0,
      ).length,
      negativeBalanceCount: employees.filter(
        (employee) => employee.negativeBalances.length > 0,
      ).length,
      blockingRequestCount: blockingRequests.length,
      blockingRequests,
      totals: {
        nMinus1Remaining: this.round(
          employees.reduce((sum, row) => sum + row.nMinus1Remaining, 0),
        ),
        nRemainingToTransfer: this.round(
          employees.reduce(
            (sum, row) => sum + row.nRemainingToTransfer,
            0,
          ),
        ),
        nToTransfer: this.round(
          employees.reduce((sum, row) => sum + row.nToTransfer, 0),
        ),
        nMinus1ToReset: this.round(
          employees.reduce((sum, row) => sum + row.nMinus1ToReset, 0),
        ),
        nPlus1ToReset: this.round(
          employees.reduce((sum, row) => sum + row.nPlus1ToReset, 0),
        ),
        exceptionalCarryoverApproved: this.round(
          employees.reduce(
            (sum, row) =>
              sum + row.exceptionalCarryoverAlreadyApproved,
            0,
          ),
        ),
      },
      employees,
    };
  }

  async approveExceptionalCarryover(
    actor: AuthenticatedUser,
    dto: ExceptionalCarryoverDto,
  ) {
    const nextReferencePeriod = this.nextReferencePeriod(
      dto.closingReferencePeriod,
    );
    const marker = await this.settingsService.getValue(
      this.closureMarkerKey(dto.closingReferencePeriod),
    );

    if (marker !== null) {
      throw new ConflictException(
        'La période est déjà clôturée. Aucun nouveau report ne peut être accordé.',
      );
    }

    const employee = await this.usersService.findOne(dto.employeeId);
    if (employee.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Un compte Admin ne possède pas de compteur de congés.',
      );
    }

    const approvedMovementId = await this.dataSource.transaction(
      async (manager) => {
        const repository = manager.getRepository(LeaveBalance);
        const source = await repository
          .createQueryBuilder('balance')
          .setLock('pessimistic_write')
          .where('balance.employeeId = :employeeId', {
            employeeId: employee.id,
          })
          .andWhere('balance.referencePeriod = :referencePeriod', {
            referencePeriod: dto.closingReferencePeriod,
          })
          .andWhere('balance.counterType = :counterType', {
            counterType: LeaveBalanceCounterType.N_MINUS_1,
          })
          .getOne();

        if (!source) {
          throw new BadRequestException(
            'Aucun compteur N-1 n’existe pour cette période.',
          );
        }

        const sourceFreeBalance = this.round(
          source.availableDays - source.reservedDays,
        );

        // JUR-027 L5/L6 (recette uniquement) : un report exceptionnel ne doit
        // jamais prélever silencieusement des jours appartenant à un lot
        // maladie. Sont exclus du reportable : les lots protégés, les lots
        // expirés (encore présents dans le compteur), les jours gelés en
        // régularisation, et les reliquats inconnus (origine incertaine).
        const recetteLots =
          this.configService.get<string>('CARRYOVER_LOTS_ENABLED') === 'true' &&
          this.dataSource.options.database === 'gestion_conges_gmes_test';
        let protectedLotDays = 0;
        let expiredLotDays = 0;
        let frozenLotDays = 0;
        let unknownReliquat = false;
        if (recetteLots) {
          const lots = await manager.getRepository(CarryoverLot).find({
            where: {
              employeeId: employee.id,
              targetReferencePeriod: dto.closingReferencePeriod,
              targetCounterType: CarryoverLotTargetCounter.N_MINUS_1,
            },
          });
          for (const lot of lots) {
            if (lot.remainingDays == null) {
              unknownReliquat = true;
              break;
            }
            const classification = classifyCarryoverLot(lot);
            if (classification.expired) {
              expiredLotDays = this.round(
                expiredLotDays + Number(lot.remainingDays),
              );
            } else {
              protectedLotDays = this.round(
                protectedLotDays + Number(lot.remainingDays),
              );
            }
          }
          const frozenRows = await manager
            .getRepository(CarryoverLotAllocation)
            .find({
              where: {
                leaveBalanceId: source.id,
                operationType: CarryoverLotAllocationOperation.REGULARISATION,
                frozenInBalance: true,
              },
            });
          frozenLotDays = this.round(
            frozenRows.reduce((sum, r) => sum + Number(r.days), 0),
          );
        }

        if (unknownReliquat) {
          throw new BadRequestException(
            'Origine incertaine : un lot au reliquat inconnu empêche le report exceptionnel — vérification RH requise.',
          );
        }

        const carryableOrdinary = this.round(
          sourceFreeBalance - protectedLotDays - expiredLotDays - frozenLotDays,
        );

        if (carryableOrdinary < 0) {
          throw new BadRequestException(
            'Rapprochement impossible : les lots excèdent le solde disponible — vérification RH requise.',
          );
        }

        if (dto.days > carryableOrdinary) {
          throw new BadRequestException(
            `Le report exceptionnel de ${dto.days} j dépasse les jours ordinaires disponibles (${carryableOrdinary} j) : ${protectedLotDays} j protégés, ${expiredLotDays} j expirés, ${frozenLotDays} j gelés. Vérification RH requise.`,
          );
        }

        // Débit du compteur source N-1 : les jours reportés ne sont plus
        // disponibles sur la source. acquiredDays et availableDays sont
        // diminués du même montant (les jours ne sont pas consommés : ils
        // sont transférés vers la période suivante).
        const sourceBefore = this.round(source.availableDays);
        source.acquiredDays = this.round(source.acquiredDays - dto.days);
        source.availableDays = this.round(source.availableDays - dto.days);
        await repository.save(source);

        await manager.getRepository(BalanceMovement).save(
          manager.getRepository(BalanceMovement).create({
            employeeId: employee.id,
            leaveBalanceId: source.id,
            leaveRequestId: null,
            actorId: actor.id,
            movementType: BalanceMovementType.CORRECTION_NEGATIVE,
            days: this.round(dto.days),
            balanceBefore: sourceBefore,
            balanceAfter: source.availableDays,
            reason: `REPORT_EXCEPTIONNEL_DEBIT|${dto.closingReferencePeriod}|${dto.reason.trim()}`,
          }),
        );

        const target = await this.findOrCreateBalance(
          manager,
          employee.id,
          nextReferencePeriod,
          LeaveBalanceCounterType.N_MINUS_1,
        );
        const before = this.round(target.availableDays);
        const after = this.round(before + dto.days);
        target.acquiredDays = this.round(target.acquiredDays + dto.days);
        target.availableDays = after;
        await repository.save(target);

        const movement = await manager.getRepository(BalanceMovement).save(
          manager.getRepository(BalanceMovement).create({
            employeeId: employee.id,
            leaveBalanceId: target.id,
            leaveRequestId: null,
            actorId: actor.id,
            movementType: BalanceMovementType.CORRECTION_POSITIVE,
            days: this.round(dto.days),
            balanceBefore: before,
            balanceAfter: after,
            reason: this.carryoverReason(
              dto.closingReferencePeriod,
              dto.reason.trim(),
            ),
          }),
        );

        await this.auditService.record(
          {
            actorId: actor.id,
            action: 'EXCEPTIONAL_CARRYOVER_APPROVED',
            resourceType: 'LEAVE_BALANCE',
            resourceId: target.id,
            newValue: {
              employeeId: employee.id,
              closingReferencePeriod: dto.closingReferencePeriod,
              nextReferencePeriod,
              days: this.round(dto.days),
              reason: dto.reason.trim(),
              sourceBalanceId: source.id,
              sourceBalanceAfter: source.availableDays,
              targetBalanceId: target.id,
              targetBalanceAfter: target.availableDays,
            },
          },
          manager,
        );

        await this.notificationsService.create(
          {
            userId: employee.id,
            type: 'EXCEPTIONAL_CARRYOVER_APPROVED',
            title: 'Report exceptionnel de congés accordé',
            message: `${this.round(dto.days)} jour(s) ont été reportés vers la période ${nextReferencePeriod}.`,
          },
          manager,
        );

        return movement.id;
      },
    );

    return {
      employeeId: employee.id,
      closingReferencePeriod: dto.closingReferencePeriod,
      nextReferencePeriod,
      days: this.round(dto.days),
      movementId: approvedMovementId,
    };
  }

  /**
   * Liste les demandes de congés payés (déductrices de solde) qui pourraient
   * encore imputer des jours sur la période donnée : en attente de validation,
   * validées mais non imputées, ou en annulation non imputée. Les demandes
   * refusées, annulées, expirées ou déjà définitivement imputées sont exclues.
   */
  private async findBlockingLeaveRequests(
    referencePeriod: string,
    manager?: EntityManager,
    forUpdate = false,
  ): Promise<
    Array<{
      id: number;
      employeeId: number;
      employeeName: string;
      leaveTypeName: string;
      startDate: string;
      endDate: string;
      deductedDays: number;
      status: LeaveRequestStatus;
      balanceProcessingStatus: BalanceProcessingStatus;
    }>
  > {
    const startMonthDay = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const periodStart = referencePeriodStartDate(
      referencePeriod,
      startMonthDay,
    );
    const periodEnd = await this.referencePeriodEndDate(referencePeriod);
    const repository = (manager ?? this.dataSource).getRepository(
      LeaveRequest,
    );

    let query = repository
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.leaveType', 'leaveType')
      .innerJoinAndSelect('request.employee', 'employee')
      .where('leaveType.deductsPaidLeaveBalance = :deducts', {
        deducts: true,
      })
      .andWhere('request.startDate >= :periodStart', { periodStart })
      .andWhere('request.startDate <= :periodEnd', { periodEnd })
      .andWhere('request.balanceProcessingStatus != :definitif', {
        definitif: BalanceProcessingStatus.DEFINITIF,
      })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [
          LeaveRequestStatus.EN_ATTENTE_VALIDATION,
          LeaveRequestStatus.VALIDEE,
          LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
        ],
      })
      .orderBy('request.startDate', 'ASC');

    if (forUpdate) {
      query = query.setLock('pessimistic_write');
    }

    const rows = await query.getMany();

    return rows.map((request) => ({
      id: request.id,
      employeeId: request.employeeId,
      employeeName: `${request.employee.nom} ${request.employee.prenom}`,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      deductedDays: this.round(request.deductedDays),
      status: request.status,
      balanceProcessingStatus: request.balanceProcessingStatus,
    }));
  }

  async closeReferencePeriod(
    actor: AuthenticatedUser,
    dto: CloseReferencePeriodDto,
  ) {
    const referencePeriod = dto.referencePeriod;
    const nextReferencePeriod = this.nextReferencePeriod(referencePeriod);
    const expectedEndDate = await this.referencePeriodEndDate(referencePeriod);
    const today = this.martiniqueDateString(new Date());
    if (today < expectedEndDate) {
      throw new BadRequestException(
        `La période ${referencePeriod} ne peut pas être clôturée avant le ${expectedEndDate}.`,
      );
    }

    const markerKey = this.closureMarkerKey(referencePeriod);
    const marker = await this.settingsService.getValue(markerKey);

    if (marker !== null) {
      throw new ConflictException(
        `La période ${referencePeriod} a déjà été clôturée le ${marker}.`,
      );
    }

    const preview = await this.previewClosure(referencePeriod);
    if (preview.employeeCount === 0) {
      throw new BadRequestException(
        'Aucun compteur ne correspond à cette période de référence.',
      );
    }
    if (preview.blockedByReservations) {
      throw new BadRequestException(
        'La clôture est impossible tant que des jours restent réservés sur la période.',
      );
    }

    // JUR-027 : en recette (flag + base test), la clôture normale partage le
    // même verrou MySQL par période que la clôture L5, afin qu'elles ne
    // puissent jamais s'exécuter simultanément. Inerte hors recette.
    const recetteMode =
      this.configService.get<string>('CARRYOVER_LOTS_ENABLED') === 'true' &&
      this.dataSource.options.database === 'gestion_conges_gmes_test';

    const runTransaction = async (manager: EntityManager) => {
      // Re-vérification autoritaire du marqueur sous le verrou/la transaction :
      // la lecture et l'écriture du marqueur partagé doivent être sérialisées
      // sur la même connexion.
      const existingMarker = await manager.getRepository(Setting).findOneBy({
        settingKey: markerKey,
      });
      if (existingMarker !== null) {
        throw new ConflictException(
          `La période ${referencePeriod} a déjà été clôturée le ${existingMarker.settingValue}.`,
        );
      }

      const blockingRequests = await this.findBlockingLeaveRequests(
        referencePeriod,
        manager,
        true,
      );
      if (blockingRequests.length > 0) {
        throw new BadRequestException(
          `La clôture est impossible : ${blockingRequests.length} demande(s) de congés payés ne sont pas encore définitivement imputées sur la période ${referencePeriod}.`,
        );
      }

      // JUR-027 L5 (recette uniquement) : traite les lots maladie dans la MÊME
      // transaction que la clôture GMES. Le plan vérifie l'exhaustivité des
      // dossiers et la cohérence lots/compteurs AVANT toute écriture ; les
      // jours expirés sont déduits, les jours protégés transférés. Les jours
      // ordinaires restent dans le compteur N-1 et seront remis à zéro par la
      // clôture normale ci-dessous.
      if (recetteMode) {
        const lotPlan = await buildCarryoverLotPlan(
          manager,
          referencePeriod,
          true,
        );
        if (lotPlan.blocked) {
          throw new BadRequestException(
            `Clôture bloquée : ${lotPlan.reasons.join(' ')}`,
          );
        }
        await applyCarryoverLotPlan(manager, referencePeriod, actor.id, lotPlan);
      }

      const repository = manager.getRepository(LeaveBalance);
      const rows = await repository
        .createQueryBuilder('balance')
        .setLock('pessimistic_write')
        .where('balance.referencePeriod = :referencePeriod', {
          referencePeriod,
        })
        .orderBy('balance.employeeId', 'ASC')
        .getMany();
      const grouped = new Map<number, LeaveBalance[]>();

      for (const row of rows) {
        const list = grouped.get(row.employeeId) ?? [];
        list.push(row);
        grouped.set(row.employeeId, list);
      }

      const processed: Array<{
        employeeId: number;
        transferredFromN: number;
        removedOldNMinus1: number;
        removedOldNPlus1: number;
        roundingSupplement: number;
      }> = [];

      for (const [employeeId, balances] of grouped.entries()) {
        if (balances.some((balance) => balance.reservedDays > 0)) {
          throw new BadRequestException(
            `Le collaborateur ${employeeId} possède encore des jours réservés.`,
          );
        }

        const sourceNMinus1 = balances.find(
          (balance) =>
            balance.counterType === LeaveBalanceCounterType.N_MINUS_1,
        );
        const sourceN = balances.find(
          (balance) => balance.counterType === LeaveBalanceCounterType.N,
        );
        const sourceNPlus1 = balances.find(
          (balance) =>
            balance.counterType === LeaveBalanceCounterType.N_PLUS_1,
        );
        const targetNMinus1 = await this.findOrCreateBalance(
          manager,
          employeeId,
          nextReferencePeriod,
          LeaveBalanceCounterType.N_MINUS_1,
        );
        await this.findOrCreateBalance(
          manager,
          employeeId,
          nextReferencePeriod,
          LeaveBalanceCounterType.N,
        );
        await this.findOrCreateBalance(
          manager,
          employeeId,
          nextReferencePeriod,
          LeaveBalanceCounterType.N_PLUS_1,
        );

        // L3141-7 : le droit acquis de base (2,5 jours ouvrables/mois) est porté
        // à l'entier immédiatement supérieur lorsqu'il comporte une fraction de
        // jour. L'arrondi porte sur le DROIT ACQUIS (base, plafonnée à 30 jours
        // ouvrables par L3141-3), jamais sur le solde restant après
        // consommation. Les jours déjà consommés et les droits supplémentaires
        // (corrections RH, reports) ne sont pas modifiés.
        let roundingSupplement = 0;
        if (sourceN) {
          const baseAcquired = await this.getAcquisitionTotal(
            manager,
            sourceN.id,
          );
          const definitiveBase = roundAcquiredDaysUp(baseAcquired);
          roundingSupplement = this.round(definitiveBase - baseAcquired);

          if (roundingSupplement > 0) {
            const beforeAcquired = this.round(sourceN.acquiredDays);
            const beforeAvailable = this.round(sourceN.availableDays);
            sourceN.acquiredDays = this.round(
              beforeAcquired + roundingSupplement,
            );
            sourceN.availableDays = this.round(
              beforeAvailable + roundingSupplement,
            );
            await repository.save(sourceN);
            await this.saveMovement(manager, {
              balance: sourceN,
              actorId: actor.id,
              type: BalanceMovementType.CORRECTION_POSITIVE,
              days: roundingSupplement,
              before: beforeAvailable,
              after: sourceN.availableDays,
              reason: `CLOTURE_ARRONDI_L3141_7|${referencePeriod}|Droit acquis de base ${baseAcquired} → ${definitiveBase} jours ouvrables (acquiredDays ${beforeAcquired} → ${sourceN.acquiredDays}).`,
            });
          }
        }

        const transferredFromN = roundPeriodCloseDays(sourceN?.availableDays ?? 0);
        const removedOldNMinus1 = this.round(
          sourceNMinus1?.availableDays ?? 0,
        );
        const removedOldNPlus1 = this.round(
          sourceNPlus1?.availableDays ?? 0,
        );

        if (transferredFromN > 0) {
          const before = this.round(targetNMinus1.availableDays);
          targetNMinus1.availableDays = this.round(
            before + transferredFromN,
          );
          targetNMinus1.acquiredDays = this.round(
            targetNMinus1.acquiredDays + transferredFromN,
          );
          await repository.save(targetNMinus1);
          await this.saveMovement(manager, {
            balance: targetNMinus1,
            actorId: actor.id,
            type: BalanceMovementType.CORRECTION_POSITIVE,
            days: transferredFromN,
            before,
            after: targetNMinus1.availableDays,
            reason: `CLOTURE_TRANSFERT_N|${referencePeriod}|Droits N transférés vers N-1 pour ${nextReferencePeriod}.`,
          });
        }

        for (const source of [sourceNMinus1, sourceN, sourceNPlus1]) {
          if (!source || source.availableDays <= 0) {
            // Un solde négatif représente un dépassement de droits non résorbé : il
            // reste visible sur la période clôturée et doit être traité par la RH.
            continue;
          }
          const before = this.round(source.availableDays);
          source.availableDays = 0;
          source.reservedDays = 0;
          await repository.save(source);
          await this.saveMovement(manager, {
            balance: source,
            actorId: actor.id,
            type: BalanceMovementType.REMISE_A_ZERO,
            days: before,
            before,
            after: 0,
            reason: `CLOTURE_PERIODE|${referencePeriod}|Remise à zéro lors de la clôture.`,
          });
        }

        await this.notificationsService.create(
          {
            userId: employeeId,
            type: 'REFERENCE_PERIOD_CLOSED',
            title: 'Période de congés clôturée',
            message: `La période ${referencePeriod} a été clôturée. Les droits N disponibles ont été transférés vers N-1 pour ${nextReferencePeriod}.`,
          },
          manager,
        );

        if ((sourceN?.availableDays ?? 0) < 0) {
          await this.notificationsService.createForActiveRoles(
            [UserRole.RH],
            {
              type: 'REFERENCE_PERIOD_NEGATIVE_BALANCE',
              title: 'Solde négatif à contrôler après clôture',
              message: `Le collaborateur n°${employeeId} termine la période ${referencePeriod} avec un solde N de ${this.round(sourceN?.availableDays ?? 0)} jour(s). Ce solde n’a pas été remis à zéro.`,
            },
            manager,
          );
        }

        processed.push({
          employeeId,
          transferredFromN,
          removedOldNMinus1,
          removedOldNPlus1,
          roundingSupplement,
        });
      }

      const closedAt = new Date().toISOString();
      await this.settingsService.upsertInternal(
        markerKey,
        closedAt,
        `Marqueur technique de clôture de la période ${referencePeriod}.`,
        actor.id,
        manager,
      );
      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'REFERENCE_PERIOD_CLOSED',
          resourceType: 'REFERENCE_PERIOD',
          resourceId: null,
          newValue: {
            referencePeriod,
            nextReferencePeriod,
            closedAt,
            processedEmployees: processed.length,
          },
        },
        manager,
      );

      return { closedAt, processed };
    };

    const result = recetteMode
      ? await withPeriodClosureLock(
          this.dataSource,
          `carr_closure_${referencePeriod}`,
          10,
          async ({ manager }) => runTransaction(manager),
        )
      : await this.dataSource.transaction(runTransaction);

    return {
      referencePeriod,
      nextReferencePeriod,
      closedAt: result.closedAt,
      processedEmployees: result.processed.length,
      totals: {
        transferredFromN: this.round(
          result.processed.reduce(
            (sum, row) => sum + row.transferredFromN,
            0,
          ),
        ),
        removedOldNMinus1: this.round(
          result.processed.reduce(
            (sum, row) => sum + row.removedOldNMinus1,
            0,
          ),
        ),
        removedOldNPlus1: this.round(
          result.processed.reduce(
            (sum, row) => sum + row.removedOldNPlus1,
            0,
          ),
        ),
        roundingSupplement: this.round(
          result.processed.reduce(
            (sum, row) => sum + row.roundingSupplement,
            0,
          ),
        ),
      },
      employees: result.processed,
    };
  }

  private async findOrCreateBalance(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
    counterType: LeaveBalanceCounterType,
  ): Promise<LeaveBalance> {
    const repository = manager.getRepository(LeaveBalance);
    const existing = await repository.findOneBy({
      employeeId,
      referencePeriod,
      counterType,
    });

    if (existing) {
      return existing;
    }

    return repository.save(
      repository.create({
        employeeId,
        referencePeriod,
        counterType,
        acquiredDays: 0,
        reservedDays: 0,
        consumedDays: 0,
        availableDays: 0,
      }),
    );
  }

  private async saveMovement(
    manager: EntityManager,
    data: {
      balance: LeaveBalance;
      actorId: number;
      type: BalanceMovementType;
      days: number;
      before: number;
      after: number;
      reason: string;
    },
  ): Promise<void> {
    const repository = manager.getRepository(BalanceMovement);
    await repository.save(
      repository.create({
        employeeId: data.balance.employeeId,
        leaveBalanceId: data.balance.id,
        leaveRequestId: null,
        actorId: data.actorId,
        movementType: data.type,
        days: this.round(data.days),
        balanceBefore: this.round(data.before),
        balanceAfter: this.round(data.after),
        reason: data.reason,
      }),
    );
  }

  private async getAcquisitionTotal(
    manager: EntityManager,
    leaveBalanceId: number,
  ): Promise<number> {
    const row = await manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .select('COALESCE(SUM(movement.days), 0)', 'total')
      .where('movement.leaveBalanceId = :leaveBalanceId', { leaveBalanceId })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.ACQUISITION,
      })
      .getRawOne<{ total: string }>();

    return this.round(Number(row?.total ?? 0));
  }

  private async getApprovedCarryover(
    employeeId: number,
    closingReferencePeriod: string,
    nextReferencePeriod: string,
  ): Promise<number> {
    const rows = await this.movementRepository
      .createQueryBuilder('movement')
      .innerJoin('movement.leaveBalance', 'balance')
      .select('COALESCE(SUM(movement.days), 0)', 'total')
      .where('movement.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :nextReferencePeriod', {
        nextReferencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.CORRECTION_POSITIVE,
      })
      .andWhere('movement.reason LIKE :prefix', {
        prefix: `REPORT_EXCEPTIONNEL|${closingReferencePeriod}|%`,
      })
      .getRawOne<{ total: string }>();

    return this.round(Number(rows?.total ?? 0));
  }

  private async getApprovedCarryoverWithManager(
    manager: EntityManager,
    employeeId: number,
    closingReferencePeriod: string,
    nextReferencePeriod: string,
  ): Promise<number> {
    const row = await manager
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .innerJoin('movement.leaveBalance', 'balance')
      .select('COALESCE(SUM(movement.days), 0)', 'total')
      .where('movement.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :nextReferencePeriod', {
        nextReferencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.CORRECTION_POSITIVE,
      })
      .andWhere('movement.reason LIKE :prefix', {
        prefix: `REPORT_EXCEPTIONNEL|${closingReferencePeriod}|%`,
      })
      .getRawOne<{ total: string }>();

    return this.round(Number(row?.total ?? 0));
  }


  private async referencePeriodEndDate(referencePeriod: string): Promise<string> {
    const match = /^(\d{4})-(\d{4})$/.exec(referencePeriod);
    if (!match) {
      throw new BadRequestException(
        'La période de référence doit respecter le format AAAA-AAAA.',
      );
    }
    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    const startMonthDay = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const [month, day] = startMonthDay.split('-').map(Number);
    const nextStart = new Date(Date.UTC(endYear, month - 1, day));
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    const computed = nextStart.toISOString().slice(0, 10);
    if (startYear + 1 !== endYear) {
      throw new BadRequestException(
        'Les deux années de la période de référence doivent être consécutives.',
      );
    }
    return computed;
  }

  private martiniqueDateString(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Martinique',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) =>
      parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private carryoverReason(referencePeriod: string, reason: string): string {
    return `REPORT_EXCEPTIONNEL|${referencePeriod}|${reason}`;
  }

  private closureMarkerKey(referencePeriod: string): string {
    return `REFERENCE_PERIOD_CLOSED_${referencePeriod.replace('-', '_')}`;
  }

  private nextReferencePeriod(referencePeriod: string): string {
    const match = /^(\d{4})-(\d{4})$/.exec(referencePeriod);
    if (!match) {
      throw new BadRequestException(
        'La période de référence doit respecter le format AAAA-AAAA.',
      );
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end !== start + 1) {
      throw new BadRequestException(
        'Les deux années de la période de référence doivent être consécutives.',
      );
    }
    return `${end}-${end + 1}`;
  }

  private available(
    balances: LeaveBalance[],
    counterType: LeaveBalanceCounterType,
  ): number {
    return this.round(
      balances.find((balance) => balance.counterType === counterType)
        ?.availableDays ?? 0,
    );
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
