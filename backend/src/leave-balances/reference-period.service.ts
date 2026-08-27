import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import { CloseReferencePeriodDto } from './dto/close-reference-period.dto';
import { ExceptionalCarryoverDto } from './dto/exceptional-carryover.dto';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import { roundPeriodCloseDays } from './reference-period-rounding.util';

interface ClosureEmployeePreview {
  employeeId: number;
  employeeName: string;
  nMinus1Remaining: number;
  nRemainingToTransfer: number;
  nPlus1Forecast: number;
  reservedDays: number;
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

    const employees: ClosureEmployeePreview[] = [];
    for (const [employeeId, employeeBalances] of grouped.entries()) {
      const employee = employeeBalances[0].employee;
      employees.push({
        employeeId,
        employeeName: `${employee.nom} ${employee.prenom}`,
        nMinus1Remaining: this.available(
          employeeBalances,
          LeaveBalanceCounterType.N_MINUS_1,
        ),
        nRemainingToTransfer: this.available(
          employeeBalances,
          LeaveBalanceCounterType.N,
        ),
        nPlus1Forecast: this.available(
          employeeBalances,
          LeaveBalanceCounterType.N_PLUS_1,
        ),
        reservedDays: this.round(
          employeeBalances.reduce(
            (sum, balance) => sum + balance.reservedDays,
            0,
          ),
        ),
        exceptionalCarryoverAlreadyApproved:
          await this.getApprovedCarryover(
            employeeId,
            referencePeriod,
            nextReferencePeriod,
          ),
      });
    }

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

        const alreadyApproved = await this.getApprovedCarryoverWithManager(
          manager,
          employee.id,
          dto.closingReferencePeriod,
          nextReferencePeriod,
        );
        const requestedTotal = this.round(alreadyApproved + dto.days);

        if (requestedTotal > this.round(source.availableDays)) {
          throw new BadRequestException(
            'Le total des reports exceptionnels dépasse le reliquat N-1 disponible.',
          );
        }

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

    const result = await this.dataSource.transaction(async (manager) => {
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

        processed.push({
          employeeId,
          transferredFromN,
          removedOldNMinus1,
          removedOldNPlus1,
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
    });

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
