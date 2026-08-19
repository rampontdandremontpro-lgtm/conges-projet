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
import { Setting } from '../settings/setting.entity';
import { User, UserRole } from '../users/user.entity';
import { ValidatorResolutionService } from '../validators/validator-resolution.service';
import {
  Notification,
  NotificationChannel,
} from './notification.entity';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import {
  getNotificationPreferenceDefinitions,
  resolveNotificationPreferenceKey,
} from './notification-preferences.catalog';

const NOTIFICATION_PREFERENCES_KEY_PREFIX = 'USER_NOTIFICATION_PREFERENCES_';

interface StoredNotificationPreference {
  application: boolean;
  email: boolean;
}

type StoredNotificationPreferences = Record<
  string,
  StoredNotificationPreference
>;

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

    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,

    private readonly validatorResolutionService: ValidatorResolutionService,
  ) {}

  async create(
    input: CreateNotificationInput,
    manager?: EntityManager,
  ): Promise<Notification | null> {
    const repository = manager
      ? manager.getRepository(Notification)
      : this.notificationRepository;

    const channel = await this.resolveNotificationChannel(
      input.userId,
      input.type,
      input.channel ?? NotificationChannel.APPLICATION,
      manager,
    );

    if (channel === null) {
      return null;
    }

    const notification = repository.create({
      userId: input.userId,
      channel,
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
      const notification = await this.create(
        { ...input, userId },
        manager,
      );
      if (notification) {
        results.push(notification);
      }
    }

    return results;
  }


  async createForActiveRoles(
    roles: UserRole[],
    input: Omit<CreateNotificationInput, 'userId'>,
    manager?: EntityManager,
  ): Promise<Notification[]> {
    if (roles.length === 0) {
      return [];
    }

    const repository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const recipients = await repository.find({
      where: {
        role: In(roles),
        isActive: true,
      },
      select: { id: true },
    });

    return this.createForUsers(
      recipients.map((recipient) => recipient.id),
      input,
      manager,
    );
  }

  async createForServiceManagers(
    serviceId: number,
    input: Omit<CreateNotificationInput, 'userId'>,
    manager?: EntityManager,
  ): Promise<Notification[]> {
    const repository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const recipients = await repository.find({
      where: {
        serviceId,
        role: UserRole.RESPONSABLE_SERVICE,
        isActive: true,
      },
      select: { id: true },
    });

    return this.createForUsers(
      recipients.map((recipient) => recipient.id),
      input,
      manager,
    );
  }

  async findMy(
    userId: number,
    query: NotificationQueryDto,
  ): Promise<Notification[]> {
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.channel IN (:...applicationChannels)', {
        applicationChannels: [
          NotificationChannel.APPLICATION,
          NotificationChannel.LES_DEUX,
        ],
      })
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
      where: {
        userId,
        readAt: IsNull(),
        channel: In([
          NotificationChannel.APPLICATION,
          NotificationChannel.LES_DEUX,
        ]),
      },
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
      .andWhere('channel IN (:...applicationChannels)', {
        applicationChannels: [
          NotificationChannel.APPLICATION,
          NotificationChannel.LES_DEUX,
        ],
      })
      .execute();

    return { updated: result.affected ?? 0 };
  }

  async getMyPreferences(userId: number, role: UserRole) {
    const stored = await this.readStoredPreferences(userId);
    const preferences = getNotificationPreferenceDefinitions(role).map(
      (definition) => ({
        key: definition.key,
        label: definition.label,
        application:
          stored[definition.key]?.application ??
          definition.defaultApplication,
        email:
          stored[definition.key]?.email ??
          definition.defaultEmail,
      }),
    );

    return {
      role,
      emailDeliveryEnabled: false,
      preferences,
    };
  }

  async updateMyPreferences(
    userId: number,
    role: UserRole,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const definitions = getNotificationPreferenceDefinitions(role);
    const allowedKeys = new Set(definitions.map((item) => item.key));
    const next: StoredNotificationPreferences = {};

    for (const definition of definitions) {
      next[definition.key] = {
        application: definition.defaultApplication,
        email: definition.defaultEmail,
      };
    }

    for (const item of dto.preferences) {
      if (!allowedKeys.has(item.key)) {
        continue;
      }

      next[item.key] = {
        application: item.application,
        email: item.email,
      };
    }

    const repository = this.settingRepository;
    const settingKey = this.preferenceSettingKey(userId);
    let setting = await repository.findOneBy({ settingKey });

    if (!setting) {
      setting = repository.create({
        settingKey,
        settingValue: JSON.stringify(next),
        description: 'Préférences personnelles de notification.',
        updatedById: userId,
      });
    } else {
      setting.settingValue = JSON.stringify(next);
      setting.description = 'Préférences personnelles de notification.';
      setting.updatedById = userId;
    }

    await repository.save(setting);
    return this.getMyPreferences(userId, role);
  }

  async resetMyPreferences(userId: number, role: UserRole) {
    await this.settingRepository.delete({
      settingKey: this.preferenceSettingKey(userId),
    });
    return this.getMyPreferences(userId, role);
  }

  private preferenceSettingKey(userId: number): string {
    return `${NOTIFICATION_PREFERENCES_KEY_PREFIX}${userId}`;
  }

  private async readStoredPreferences(
    userId: number,
    manager?: EntityManager,
  ): Promise<StoredNotificationPreferences> {
    const repository = manager
      ? manager.getRepository(Setting)
      : this.settingRepository;
    const setting = await repository.findOneBy({
      settingKey: this.preferenceSettingKey(userId),
    });

    if (!setting?.settingValue?.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(setting.settingValue) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const result: StoredNotificationPreferences = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof (value as StoredNotificationPreference).application ===
            'boolean' &&
          typeof (value as StoredNotificationPreference).email ===
            'boolean'
        ) {
          result[key] = {
            application: (value as StoredNotificationPreference)
              .application,
            email: (value as StoredNotificationPreference).email,
          };
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private async resolveNotificationChannel(
    userId: number,
    notificationType: string,
    fallbackChannel: NotificationChannel,
    manager?: EntityManager,
  ): Promise<NotificationChannel | null> {
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const user = await userRepository.findOne({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      return fallbackChannel;
    }

    const preferenceKey = resolveNotificationPreferenceKey(
      user.role,
      notificationType,
    );

    if (!preferenceKey) {
      return fallbackChannel;
    }

    const definition = getNotificationPreferenceDefinitions(user.role).find(
      (item) => item.key === preferenceKey,
    );

    if (!definition) {
      return fallbackChannel;
    }

    const stored = await this.readStoredPreferences(userId, manager);
    const application =
      stored[preferenceKey]?.application ??
      definition.defaultApplication;

    // L'envoi e-mail n'est pas encore activé dans l'application.
    // Le choix e-mail reste stocké pour la prochaine étape, mais ne doit
    // pas créer aujourd'hui de notification EMAIL invisible.
    if (!application) {
      return null;
    }

    return NotificationChannel.APPLICATION;
  }

  async alreadyExists(data: {
    userId: number;
    type: string;
    leaveRequestId?: number | null;
  }): Promise<boolean> {
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', {
        userId: data.userId,
      })
      .andWhere('notification.type = :type', { type: data.type });

    if (data.leaveRequestId === null || data.leaveRequestId === undefined) {
      qb.andWhere('notification.leaveRequestId IS NULL');
    } else {
      qb.andWhere('notification.leaveRequestId = :leaveRequestId', {
        leaveRequestId: data.leaveRequestId,
      });
    }

    return (await qb.getCount()) > 0;
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
    return this.validatorResolutionService.getDecisionRecipientIds(
      leaveRequest,
      manager ? { manager } : {},
    );
  }

  async notifyLeaveRequestSubmitted(
    leaveRequest: LeaveRequest,
    manager?: EntityManager,
  ): Promise<void> {
    const recipientIds = await this.getDecisionRecipientIds(
      leaveRequest,
      manager,
    );

    for (const userId of recipientIds) {
      const type = await this.resolveSubmittedRequestType(
        userId,
        leaveRequest.employee.role,
        manager,
      );

      await this.create(
        {
          userId,
          type,
          title: 'Nouvelle demande de congé',
          message: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom} a soumis une demande du ${leaveRequest.startDate} au ${leaveRequest.endDate}.`,
          leaveRequestId: leaveRequest.id,
        },
        manager,
      );
    }
  }

  async reevaluateRecipientsForRequest(
    leaveRequest: LeaveRequest,
    manager?: EntityManager,
  ): Promise<number> {
    const recipientIds = await this.getDecisionRecipientIds(
      leaveRequest,
      manager,
    );

    const since = leaveRequest.submittedAt ?? leaveRequest.createdAt;
    let created = 0;

    for (const userId of recipientIds) {
      const type = await this.resolveSubmittedRequestType(
        userId,
        leaveRequest.employee.role,
        manager,
      );
      const exists =
        (await this.alreadyExistsSince({
          userId,
          type,
          leaveRequestId: leaveRequest.id,
          since,
        })) ||
        (type !== 'LEAVE_REQUEST_SUBMITTED' &&
          (await this.alreadyExistsSince({
            userId,
            type: 'LEAVE_REQUEST_SUBMITTED',
            leaveRequestId: leaveRequest.id,
            since,
          })));

      if (exists) {
        continue;
      }

      const notification = await this.create(
        {
          userId,
          type,
          title: 'Nouvelle demande de congé',
          message: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom} a soumis une demande du ${leaveRequest.startDate} au ${leaveRequest.endDate}.`,
          leaveRequestId: leaveRequest.id,
        },
        manager,
      );
      if (notification) {
        created += 1;
      }
    }

    return created;
  }

  private async resolveSubmittedRequestType(
    recipientId: number,
    employeeRole: UserRole,
    manager?: EntityManager,
  ): Promise<string> {
    const repository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const recipient = await repository.findOne({
      where: { id: recipientId },
      select: { id: true, role: true },
    });

    if (recipient?.role === UserRole.DIRECTEUR) {
      if (employeeRole === UserRole.RH) {
        return 'LEAVE_REQUEST_SUBMITTED_RH';
      }

      if (employeeRole === UserRole.RESPONSABLE_SERVICE) {
        return 'LEAVE_REQUEST_SUBMITTED_MANAGER';
      }
    }

    return 'LEAVE_REQUEST_SUBMITTED';
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
