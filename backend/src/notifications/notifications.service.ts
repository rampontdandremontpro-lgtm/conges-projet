import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { Service, ValidationMode } from '../services/service.entity';
import { PresenceStatus, User, UserRole } from '../users/user.entity';
import {
  Notification,
  NotificationChannel,
} from './notification.entity';
import { NotificationQueryDto } from './dto/notification-query.dto';

export interface CreateNotificationInput {
  userId: number;
  channel?: NotificationChannel;
  type: string;
  title: string;
  message: string;
  leaveRequestId?: number | null;
  absenceDeclarationId?: number | null;
  derogationId?: number | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(
    input: CreateNotificationInput,
    manager?: EntityManager,
  ): Promise<Notification> {
    const repository = manager
      ? manager.getRepository(Notification)
      : this.notificationRepository;

    const notification = repository.create({
      userId: input.userId,
      channel: input.channel ?? NotificationChannel.APPLICATION,
      type: input.type.trim(),
      title: input.title.trim(),
      message: input.message.trim(),
      leaveRequestId: input.leaveRequestId ?? null,
      absenceDeclarationId: input.absenceDeclarationId ?? null,
      derogationId: input.derogationId ?? null,
      readAt: null,
      emailSentAt: null,
    });

    return repository.save(notification);
  }

  async createForUsers(
    userIds: number[],
    input: Omit<CreateNotificationInput, 'userId'>,
    manager?: EntityManager,
  ): Promise<Notification[]> {
    const uniqueUserIds = [...new Set(userIds)].filter((id) => id > 0);
    const results: Notification[] = [];

    for (const userId of uniqueUserIds) {
      results.push(
        await this.create({ ...input, userId }, manager),
      );
    }

    return results;
  }

  async findMy(
    userId: number,
    query: NotificationQueryDto,
  ): Promise<Notification[]> {
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .orderBy('notification.createdAt', 'DESC')
      .take(200);

    if (query.unreadOnly) {
      qb.andWhere('notification.readAt IS NULL');
    }

    if (query.type?.trim()) {
      qb.andWhere('notification.type = :type', {
        type: query.type.trim(),
      });
    }

    return qb.getMany();
  }

  async countUnread(userId: number): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationRepository.count({
      where: { userId, readAt: IsNull() },
    });

    return { unreadCount };
  }

  async markRead(userId: number, id: number): Promise<Notification> {
    const notification = await this.notificationRepository.findOneBy({
      id,
      userId,
    });

    if (!notification) {
      throw new NotFoundException(
        `La notification ${id} est introuvable.`,
      );
    }

    notification.readAt ??= new Date();
    return this.notificationRepository.save(notification);
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();

    return { updated: result.affected ?? 0 };
  }

  async alreadyExistsSince(data: {
    userId: number;
    type: string;
    leaveRequestId?: number | null;
    since: Date;
  }): Promise<boolean> {
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', {
        userId: data.userId,
      })
      .andWhere('notification.type = :type', { type: data.type })
      .andWhere('notification.createdAt >= :since', {
        since: data.since,
      });

    if (data.leaveRequestId === null || data.leaveRequestId === undefined) {
      qb.andWhere('notification.leaveRequestId IS NULL');
    } else {
      qb.andWhere('notification.leaveRequestId = :leaveRequestId', {
        leaveRequestId: data.leaveRequestId,
      });
    }

    return (await qb.getCount()) > 0;
  }

  async getDecisionRecipientIds(
    leaveRequest: LeaveRequest,
    manager?: EntityManager,
  ): Promise<number[]> {
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;

    if (leaveRequest.employee.role === UserRole.RH) {
      const directors = await userRepository.find({
        where: { role: UserRole.DIRECTEUR, isActive: true },
        select: { id: true },
      });
      return directors.map((user) => user.id);
    }

    const service = leaveRequest.service as Service;

    if (
      service.validationMode === ValidationMode.RESPONSABLE_PUIS_RELAIS &&
      service.primaryManagerId
    ) {
      const primaryManager = await userRepository.findOneBy({
        id: service.primaryManagerId,
      });
      const submittedAt =
        leaveRequest.submittedAt ?? leaveRequest.createdAt;
      const takeoverAt = new Date(
        submittedAt.getTime() +
          service.takeoverDelayDays * 24 * 60 * 60 * 1000,
      );
      const managerAvailable = Boolean(
        primaryManager &&
          primaryManager.isActive &&
          primaryManager.role === UserRole.RESPONSABLE_SERVICE &&
          primaryManager.presenceStatus === PresenceStatus.PRESENT &&
          Date.now() < takeoverAt.getTime(),
      );

      if (managerAvailable) {
        return [service.primaryManagerId];
      }
    }

    if (service.validationMode === ValidationMode.DIRECTEUR_SEUL) {
      const directors = await userRepository.find({
        where: { role: UserRole.DIRECTEUR, isActive: true },
        select: { id: true },
      });
      return directors.map((user) => user.id);
    }

    const validators = await userRepository.find({
      where: {
        role: In([UserRole.RH, UserRole.DIRECTEUR]),
        isActive: true,
      },
      select: { id: true },
    });

    return validators.map((user) => user.id);
  }

  async notifyLeaveRequestSubmitted(
    leaveRequest: LeaveRequest,
    manager?: EntityManager,
  ): Promise<void> {
    const recipientIds = await this.getDecisionRecipientIds(
      leaveRequest,
      manager,
    );

    await this.createForUsers(
      recipientIds,
      {
        type: 'LEAVE_REQUEST_SUBMITTED',
        title: 'Nouvelle demande de congé',
        message: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom} a soumis une demande du ${leaveRequest.startDate} au ${leaveRequest.endDate}.`,
        leaveRequestId: leaveRequest.id,
      },
      manager,
    );
  }

  async notifyLeaveRequestDecision(
    leaveRequest: LeaveRequest,
    decision: 'VALIDEE' | 'REFUSEE',
    actorId: number,
    manager?: EntityManager,
  ): Promise<void> {
    const title =
      decision === 'VALIDEE'
        ? 'Demande de congé validée'
        : 'Demande de congé refusée';
    const message =
      decision === 'VALIDEE'
        ? `Votre demande du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été validée.`
        : `Votre demande du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été refusée.`;

    await this.create(
      {
        userId: leaveRequest.employeeId,
        type: `LEAVE_REQUEST_${decision}`,
        title,
        message,
        leaveRequestId: leaveRequest.id,
      },
      manager,
    );

    const informationalRecipients = (
      await this.getDecisionRecipientIds(leaveRequest, manager)
    ).filter((id) => id !== actorId);

    await this.createForUsers(
      informationalRecipients,
      {
        type: `LEAVE_REQUEST_${decision}_INFO`,
        title,
        message: `La demande n°${leaveRequest.id} de ${leaveRequest.employee.prenom} ${leaveRequest.employee.nom} a été ${decision === 'VALIDEE' ? 'validée' : 'refusée'}.`,
        leaveRequestId: leaveRequest.id,
      },
      manager,
    );
  }
}
