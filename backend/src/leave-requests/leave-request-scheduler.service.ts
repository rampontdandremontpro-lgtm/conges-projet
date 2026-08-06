import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditAction, AuditLog } from '../audit/audit-log.entity';
import { LeaveBalancesService } from '../leave-balances/leave-balances.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserRole } from '../users/user.entity';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from './leave-request.entity';

export interface MaintenanceRunResult {
  runAt: string;
  remindersCreated: number;
  expiredRequests: number;
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
  private scheduler?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly leaveBalancesService: LeaveBalancesService,
  ) {}

  onApplicationBootstrap(): void {
    void this.runMaintenance();
    this.scheduler = setInterval(() => {
      void this.runMaintenance();
    }, this.intervalMilliseconds);
    this.scheduler.unref();
  }

  onApplicationShutdown(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
    }
  }

  async runMaintenance(): Promise<MaintenanceRunResult> {
    if (this.running) {
      return {
        runAt: new Date().toISOString(),
        remindersCreated: 0,
        expiredRequests: 0,
        errors: ['Une exécution est déjà en cours.'],
      };
    }

    this.running = true;
    const result: MaintenanceRunResult = {
      runAt: new Date().toISOString(),
      remindersCreated: 0,
      expiredRequests: 0,
      errors: [],
    };

    try {
      const requests = await this.dataSource
        .getRepository(LeaveRequest)
        .find({
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

      const today = this.getMartiniqueDateString(new Date());

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

          if ([14, 10, 7, 6, 5, 4, 3, 2, 1].includes(daysBeforeStart)) {
            result.remindersCreated += await this.sendReminder(
              request,
              daysBeforeStart,
            );
          }
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

    return result;
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
        message: `La demande n°${request.id} de ${request.employee.prenom} ${request.employee.nom} débute dans ${daysBeforeStart} jour(s).`,
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

      await manager.getRepository(AuditLog).save(
        manager.getRepository(AuditLog).create({
          leaveRequestId: request.id,
          leaveRequest: request,
          action: 'DEMANDE_EXPIREE_NON_VALIDEE',
          actorId: null,
          oldStatus,
          newStatus: LeaveRequestStatus.EXPIREE_NON_VALIDEE,
          comment:
            'La date de départ a été atteinte sans décision.',
          metadata: { expiredAt: now },
        }),
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
          message: `La demande n°${request.id} de ${request.employee.prenom} ${request.employee.nom} a expiré sans décision.`,
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

  private getMartiniqueDateString(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Martinique',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  }
}
