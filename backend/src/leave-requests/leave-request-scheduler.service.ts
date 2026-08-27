import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { BalanceReminderService, type BalanceReminderRunResult } from '../leave-balances/balance-reminder.service';
import { currentReferencePeriod } from '../leave-balances/reference-period.util';
import { LeaveBalancesService } from '../leave-balances/leave-balances.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole } from '../users/user.entity';
import {
  getMartiniqueDateString,
  getNextPeriodSwitch,
} from './leave-request-period.util';
import {
  BalanceProcessingStatus,
  LeaveRequest,
  LeaveRequestStatus,
} from './leave-request.entity';

export interface MaintenanceRunResult {
  runAt: string;
  remindersCreated: number;
  expiredRequests: number;
  consolidatedRequests: number;
  notificationsReevaluated: number;
  presenceStatusesRefreshed: number;
  balanceReminders: BalanceReminderRunResult | null;
  errors: string[];
}

@Injectable()
export class LeaveRequestSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    LeaveRequestSchedulerService.name,
  );
  private readonly intervalMilliseconds = 60 * 60 * 1000;
  private readonly afternoonStartHourKey = 'AFTERNOON_START_HOUR';
  private scheduler?: NodeJS.Timeout;
  private switchTimer?: NodeJS.Timeout;
  private running = false;

  private readonly handleAfternoonStartHourChange = (): void => {
    void this.scheduleNextSwitchMaintenance();
  };

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly presenceService: PresenceService,
    private readonly settingsService: SettingsService,
    private readonly balanceReminderService: BalanceReminderService,
  ) {}

  onApplicationBootstrap(): void {
    void this.runMaintenance();
    this.scheduler = setInterval(() => {
      void this.runMaintenance();
    }, this.intervalMilliseconds);
    this.scheduler.unref();
    void this.scheduleNextSwitchMaintenance();
    this.settingsService.onAfternoonStartHourChange(
      this.handleAfternoonStartHourChange,
    );
  }

  onApplicationShutdown(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
    }
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
    }
    this.settingsService.removeAfternoonStartHourChangeListener(
      this.handleAfternoonStartHourChange,
    );
  }

  async scheduleNextSwitchMaintenance(): Promise<void> {
    try {
      const afternoonStartHour = await this.settingsService.getString(
        this.afternoonStartHourKey,
        '12:00',
      );
      const now = new Date();
      const nextSwitch = getNextPeriodSwitch(
        now,
        afternoonStartHour,
      );
      const delay = Math.max(0, nextSwitch.getTime() - now.getTime());

      if (this.switchTimer) {
        clearTimeout(this.switchTimer);
      }

      this.switchTimer = setTimeout(() => {
        this.switchTimer = undefined;
        void this.runSwitchMaintenance().finally(() => {
          void this.scheduleNextSwitchMaintenance();
        });
      }, delay);
      this.switchTimer.unref();

      this.logger.log(
        `Maintenance de bascule planifiée pour ${nextSwitch.toISOString()} ` +
          `(dans ${Math.round(delay / 60000)} min, AFTERNOON_START_HOUR=${afternoonStartHour}).`,
      );
    } catch (error) {
      this.logger.error(
        'Impossible de planifier la maintenance de bascule de période.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async runSwitchMaintenance(): Promise<MaintenanceRunResult> {
    if (this.running) {
      return this.busyResult();
    }

    this.running = true;
    const result = this.emptyResult();

    try {
      const requests = await this.findPendingRequests();

      for (const request of requests) {
        try {
          result.notificationsReevaluated +=
            await this.notificationsService
              .reevaluateRecipientsForRequest(request);
        } catch (error) {
          result.errors.push(
            `Demande ${request.id} : ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } finally {
      this.running = false;
    }

    await this.refreshPresenceStatuses(result);
    return result;
  }

  private emptyResult(): MaintenanceRunResult {
    return {
      runAt: new Date().toISOString(),
      remindersCreated: 0,
      expiredRequests: 0,
      consolidatedRequests: 0,
      notificationsReevaluated: 0,
      presenceStatusesRefreshed: 0,
      balanceReminders: null,
      errors: [],
    };
  }

  private busyResult(): MaintenanceRunResult {
    return {
      ...this.emptyResult(),
      errors: ['Une exécution est déjà en cours.'],
    };
  }

  private async findPendingRequests(): Promise<LeaveRequest[]> {
    return this.dataSource.getRepository(LeaveRequest).find({
      where: {
        status: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
      },
      relations: {
        employee: true,
        leaveType: true,
        service: true,
      },
      order: { startDate: 'ASC' },
    });
  }

  private async refreshPresenceStatuses(
    result: MaintenanceRunResult,
  ): Promise<void> {
    try {
      const presenceResult =
        await this.presenceService.refreshAllStatuses();
      result.presenceStatusesRefreshed = presenceResult.updated;
    } catch (error) {
      this.logger.error(
        'Le recalcule des statuts de présence a échoué.',
        error instanceof Error ? error.stack : undefined,
      );
      result.errors.push(
        `Statuts de présence : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async runMaintenance(): Promise<MaintenanceRunResult> {
    if (this.running) {
      return this.busyResult();
    }

    this.running = true;
    const result = this.emptyResult();

    try {
      const requests = await this.findPendingRequests();

      const today = getMartiniqueDateString(new Date());

      result.consolidatedRequests = await this.consolidateValidatedLeaves(
        today,
        result,
      );

      for (const request of requests) {
        try {
          const daysBeforeStart = this.daysBetween(
            today,
            request.startDate,
          );

          if (daysBeforeStart <= 0) {
            await this.expireRequest(request.id);
            result.expiredRequests += 1;
            continue;
          }

          // Les rappels de validation commencent à J-30 et se poursuivent
          // jusqu'à J-1. Avant J-30, aucune relance n'est nécessaire.
          if (daysBeforeStart >= 1 && daysBeforeStart <= 30) {
            result.remindersCreated += await this.sendReminder(
              request,
              daysBeforeStart,
            );
          }

          result.notificationsReevaluated +=
            await this.notificationsService
              .reevaluateRecipientsForRequest(request);
        } catch (error) {
          result.errors.push(
            `Demande ${request.id} : ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } finally {
      this.running = false;
    }

    if (result.errors.length > 0) {
      this.logger.warn(
        `Maintenance terminée avec ${result.errors.length} erreur(s).`,
      );
    }

    await this.refreshPresenceStatuses(result);

    await this.runBalanceReminders(result);

    return result;
  }

  private async consolidateValidatedLeaves(
    today: string,
    result: MaintenanceRunResult,
  ): Promise<number> {
    const requests = await this.dataSource.getRepository(LeaveRequest).find({
      where: {
        status: LeaveRequestStatus.VALIDEE,
        balanceProcessingStatus: In([
          BalanceProcessingStatus.CONGE_PREVISIONNEL,
          BalanceProcessingStatus.A_CONSOLIDER,
          BalanceProcessingStatus.DEMANDE_ACTUELLE,
        ]),
      },
      relations: {
        employee: true,
        leaveType: true,
        service: true,
      },
      order: { startDate: 'ASC' },
    });

    let consolidated = 0;
    for (const request of requests) {
      if (!request.startDate || request.startDate > today) {
        continue;
      }

      try {
        await this.dataSource.transaction(async (manager) => {
          const repository = manager.getRepository(LeaveRequest);
          const locked = await repository
            .createQueryBuilder('request')
            .setLock('pessimistic_write')
            .leftJoinAndSelect('request.leaveType', 'leaveType')
            .where('request.id = :requestId', { requestId: request.id })
            .getOne();

          if (
            !locked ||
            locked.status !== LeaveRequestStatus.VALIDEE ||
            locked.balanceProcessingStatus === BalanceProcessingStatus.DEFINITIF
          ) {
            return;
          }

          let realBalanceAfter = locked.realBalanceAfter;
          let allocations: unknown[] = [];

          if (locked.leaveType.deductsPaidLeaveBalance) {
            const startMonthDay = await this.settingsService.getString(
              'REFERENCE_PERIOD_START',
              '06-01',
            );
            const referencePeriod = currentReferencePeriod(
              locked.startDate,
              startMonthDay,
            );
            const applied = await this.leaveBalancesService.applyPaidLeaveForRequest(
              manager,
              {
                employeeId: locked.employeeId,
                leaveRequestId: locked.id,
                actorId: locked.finalDeciderId,
                expectedDays: locked.deductedDays,
                referencePeriod,
              },
            );
            realBalanceAfter = applied.realBalanceAfter;
            allocations = applied.allocations;
          }

          locked.balanceProcessingStatus = BalanceProcessingStatus.DEFINITIF;
          locked.realBalanceAfter = realBalanceAfter;
          locked.version += 1;
          await repository.save(locked);

          await this.auditService.record(
            {
              actorId: null,
              action: 'LEAVE_BALANCE_CONSOLIDATED',
              resourceType: 'LEAVE_REQUESTS',
              resourceId: locked.id,
              newValue: {
                consolidatedAt: new Date().toISOString(),
                realBalanceAfter,
                allocations,
              },
            },
            manager,
          );

          await this.notificationsService.create(
            {
              userId: locked.employeeId,
              type: 'LEAVE_BALANCE_CONSOLIDATED',
              title: 'Congé imputé sur votre compteur',
              message:
                realBalanceAfter !== null && realBalanceAfter < 0
                  ? `Votre congé en cours a été imputé. Le solde de la période est désormais négatif (${realBalanceAfter} jour(s)) et sera compensé par les acquisitions suivantes.`
                  : 'Votre congé en cours a été imputé sur les compteurs correspondant à vos droits.',
              leaveRequestId: locked.id,
            },
            manager,
          );
        });
        consolidated += 1;
      } catch (error) {
        result.errors.push(
          `Consolidation demande ${request.id} : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return consolidated;
  }

  private async runBalanceReminders(
    result: MaintenanceRunResult,
  ): Promise<void> {
    try {
      result.balanceReminders = await this.balanceReminderService.runIfDue();
    } catch (error) {
      this.logger.error(
        'Le rappel de solde de fin de période a échoué.',
        error instanceof Error ? error.stack : undefined,
      );
      result.errors.push(
        `Rappels de solde : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async sendReminder(
    request: LeaveRequest,
    daysBeforeStart: number,
  ): Promise<number> {
    const recipientIds = await this.notificationsService
      .getDecisionRecipientIds(request);
    const notificationType = `LEAVE_REQUEST_REMINDER_J${daysBeforeStart}`;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let created = 0;

    for (const userId of recipientIds) {
      const exists = await this.notificationsService.alreadyExistsSince({
        userId,
        type: notificationType,
        leaveRequestId: request.id,
        since: startOfDay,
      });

      if (exists) {
        continue;
      }

      await this.notificationsService.create({
        userId,
        type: notificationType,
        title:
          daysBeforeStart <= 7
            ? 'Rappel urgent — demande à traiter'
            : 'Rappel — demande de congé à traiter',
        message: `La demande n°${request.id} de ${request.employee.nom} ${request.employee.prenom} débute dans ${daysBeforeStart} jour(s).`,
        leaveRequestId: request.id,
      });
      created += 1;
    }

    return created;
  }

  private async expireRequest(requestId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LeaveRequest);
      const request = await repository
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('request.employee', 'employee')
        .leftJoinAndSelect('request.leaveType', 'leaveType')
        .leftJoinAndSelect('request.service', 'service')
        .where('request.id = :requestId', { requestId })
        .getOne();

      if (
        !request ||
        request.status !== LeaveRequestStatus.EN_ATTENTE_VALIDATION
      ) {
        return;
      }

      if (request.leaveType.deductsPaidLeaveBalance) {
        await this.leaveBalancesService.releasePaidLeaveReservationForRequest(
          manager,
          {
            employeeId: request.employeeId,
            leaveRequestId: request.id,
            actorId: null,
            reason:
              'Libération de la réservation après expiration de la demande non validée.',
          },
        );
      }

      const oldStatus = request.status;
      const now = new Date();
      request.status = LeaveRequestStatus.EXPIREE_NON_VALIDEE;
      request.lockedAt = now;
      request.version += 1;
      await repository.save(request);

      await this.auditService.recordStatusChange(
        {
          actorId: null,
          action: 'DEMANDE_EXPIREE_NON_VALIDEE',
          resourceType: 'LEAVE_REQUESTS',
          resourceId: request.id,
          oldStatus,
          newStatus: LeaveRequestStatus.EXPIREE_NON_VALIDEE,
          comment:
            'La date de départ a été atteinte sans décision.',
          metadata: { expiredAt: now },
        },
        manager,
      );

      await this.notificationsService.create(
        {
          userId: request.employeeId,
          type: 'LEAVE_REQUEST_EXPIRED',
          title: 'Demande expirée sans validation',
          message:
            'Votre demande a atteint sa date de départ sans décision. Elle ne constitue pas une autorisation d’absence.',
          leaveRequestId: request.id,
        },
        manager,
      );

      const users = await manager.getRepository(User).find({
        where: [
          { role: UserRole.RH, isActive: true },
          { role: UserRole.DIRECTEUR, isActive: true },
        ],
        select: { id: true },
      });

      await this.notificationsService.createForUsers(
        users.map((user) => user.id),
        {
          type: 'LEAVE_REQUEST_EXPIRED_INFO',
          title: 'Demande expirée sans validation',
          message: `La demande n°${request.id} de ${request.employee.nom} ${request.employee.prenom} a expiré sans décision.`,
          leaveRequestId: request.id,
        },
        manager,
      );
    });
  }

  private daysBetween(from: string, to: string): number {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    return Math.floor(
      (toDate.getTime() - fromDate.getTime()) /
        (24 * 60 * 60 * 1000),
    );
  }
}
