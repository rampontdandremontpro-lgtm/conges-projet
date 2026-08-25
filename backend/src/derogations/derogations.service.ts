import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Repository,
} from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { UserRole } from '../users/user.entity';
import {
  calculateDerogationExpiry,
  evaluateSubmissionNotice,
} from '../leave-requests/leave-request-notice.util';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { CreateDerogationDto } from './dto/create-derogation.dto';
import {
  DecideDerogationDto,
  DerogationDecision,
} from './dto/decide-derogation.dto';
import { DerogationQueryDto } from './dto/derogation-query.dto';
import { UpdateDerogationDto } from './dto/update-derogation.dto';
import {
  Derogation,
  DerogationStatus,
} from './derogation.entity';

const EXPIRABLE_DEROGATION_STATUSES = [
  DerogationStatus.EN_ATTENTE_RH,
];

@Injectable()
export class DerogationsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DerogationsService.name);
  private deadlineTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Derogation)
    private readonly derogationRepository: Repository<Derogation>,

    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.expireOutdatedDerogations().catch((error) => {
      this.logger.error(
        'Impossible de clôturer les dérogations arrivées à échéance au démarrage.',
        error instanceof Error ? error.stack : undefined,
      );
    });
    this.scheduleNextDeadlineSweep();
  }

  onApplicationShutdown(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
    }
  }

  private scheduleNextDeadlineSweep(): void {
    const now = new Date();
    const next = new Date(now);
    // La Martinique reste en UTC-4 toute l’année : 16 h locale = 20 h UTC.
    next.setUTCHours(20, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    const delay = Math.max(0, next.getTime() - now.getTime());
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = undefined;
      void this.expireOutdatedDerogations(new Date())
        .catch((error) => {
          this.logger.error(
            'La clôture des dérogations à 16 h a échoué.',
            error instanceof Error ? error.stack : undefined,
          );
        })
        .finally(() => this.scheduleNextDeadlineSweep());
    }, delay);
    this.deadlineTimer.unref();
  }

  async createDraft(
    authenticatedUser: AuthenticatedUser,
    dto: CreateDerogationDto,
  ): Promise<Derogation> {
    const derogationId = await this.dataSource.transaction(
      async (manager) => {
        const leaveRequest = await this.findOwnedLeaveRequestForUpdate(
          manager,
          dto.leaveRequestId,
          authenticatedUser.id,
        );

        this.ensureLeaveRequestIsDraft(leaveRequest);

        const notice = await this.evaluateSubmissionNoticeWithSettings(
          leaveRequest.startDate,
          leaveRequest.endDate,
          leaveRequest.calendarDuration,
        );

        this.validateDerogationWindow(notice);

        const repository = manager.getRepository(Derogation);
        const existingDerogation = await repository
          .createQueryBuilder('derogation')
          .setLock('pessimistic_write')
          .where('derogation.leaveRequestId = :leaveRequestId', {
            leaveRequestId: leaveRequest.id,
          })
          .getOne();

        const sameRequest =
          existingDerogation &&
          this.matchesRequestSnapshot(
            existingDerogation,
            leaveRequest,
          );

        if (
          sameRequest &&
          existingDerogation.status ===
            DerogationStatus.EN_ATTENTE_RH
        ) {
          throw new ConflictException(
            'Une demande de dérogation est déjà en cours de validation pour cette période.',
          );
        }

        if (
          sameRequest &&
          existingDerogation.status === DerogationStatus.ACCORDEE
        ) {
          throw new ConflictException(
            'Une dérogation est déjà accordée pour cette période.',
          );
        }

        if (
          sameRequest &&
          existingDerogation.status === DerogationStatus.UTILISEE
        ) {
          throw new ConflictException(
            'La dérogation associée à cette période a déjà été appliquée à la demande.',
          );
        }

        const requestedAt = new Date();
        const expiresAt =
          await this.calculateDerogationExpiryWithSettings(
            leaveRequest.startDate,
          );
        this.ensureBeforeDecisionCutoff(requestedAt, expiresAt);

        const derogation =
          existingDerogation ??
          repository.create({
            employeeId: leaveRequest.employeeId,
            leaveRequestId: leaveRequest.id,
          });

        derogation.employeeId = leaveRequest.employeeId;
        derogation.leaveTypeId = leaveRequest.leaveTypeId;
        derogation.leaveRequestId = leaveRequest.id;
        derogation.requestedStartDate = leaveRequest.startDate;
        derogation.requestedEndDate = leaveRequest.endDate;
        derogation.reason = dto.reason?.trim() ?? '';
        derogation.status = DerogationStatus.EN_ATTENTE_RH;
        derogation.requestedAt = requestedAt;
        derogation.decidedByRhId = null;
        derogation.decisionComment = null;
        derogation.decidedAt = null;
        derogation.expiresAt = expiresAt;
        derogation.usedAt = null;

        const savedDerogation = await repository.save(derogation);

        await this.createHistory(manager, {
          leaveRequest,
          action: AuditAction.DEROGATION_DEMANDEE,
          actorId: authenticatedUser.id,
          comment: savedDerogation.reason,
          metadata: {
            derogationId: savedDerogation.id,
            daysBeforeStart: notice.daysBeforeStart,
            requiredNoticeDays: notice.requiredNoticeDays,
            expiresAt: savedDerogation.expiresAt,
            renewed: Boolean(existingDerogation),
          },
        });

        return savedDerogation.id;
      },
    );

    return this.findMyOne(derogationId, authenticatedUser);
  }

  async updateDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: UpdateDerogationDto,
  ): Promise<Derogation> {
    await this.dataSource.transaction(async (manager) => {
      const derogation = await this.findOwnedDerogationForUpdate(
        manager,
        id,
        authenticatedUser.id,
      );

      this.ensureDerogationIsDraft(derogation);

      if (!derogation.leaveRequestId) {
        throw new BadRequestException(
          'La demande de congé associée à cette dérogation n’existe plus.',
        );
      }

      const leaveRequest = await this.findOwnedLeaveRequestForUpdate(
        manager,
        derogation.leaveRequestId,
        authenticatedUser.id,
      );

      this.ensureLeaveRequestIsDraft(leaveRequest);

      const notice = await this.evaluateSubmissionNoticeWithSettings(
        leaveRequest.startDate,
        leaveRequest.endDate,
        leaveRequest.calendarDuration,
      );

      this.validateDerogationWindow(notice);

      derogation.leaveTypeId = leaveRequest.leaveTypeId;
      derogation.requestedStartDate = leaveRequest.startDate;
      derogation.requestedEndDate = leaveRequest.endDate;
      derogation.reason = dto.reason?.trim() ?? '';
      derogation.expiresAt = await this.calculateDerogationExpiryWithSettings(
        leaveRequest.startDate,
      );
      this.ensureBeforeDecisionCutoff(new Date(), derogation.expiresAt);

      await manager.getRepository(Derogation).save(derogation);
    });

    return this.findMyOne(id, authenticatedUser);
  }

  async submitDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<Derogation> {
    await this.dataSource.transaction(async (manager) => {
      const derogation = await this.findOwnedDerogationForUpdate(
        manager,
        id,
        authenticatedUser.id,
      );

      this.ensureDerogationIsDraft(derogation);

      if (!derogation.leaveRequestId) {
        throw new BadRequestException(
          'La demande de congé associée à cette dérogation n’existe plus.',
        );
      }

      const leaveRequest = await this.findOwnedLeaveRequestForUpdate(
        manager,
        derogation.leaveRequestId,
        authenticatedUser.id,
      );

      this.ensureLeaveRequestIsDraft(leaveRequest);

      const notice = await this.evaluateSubmissionNoticeWithSettings(
        leaveRequest.startDate,
        leaveRequest.endDate,
        leaveRequest.calendarDuration,
      );

      this.validateDerogationWindow(notice);

      const requestedAt = new Date();

      derogation.leaveTypeId = leaveRequest.leaveTypeId;
      derogation.requestedStartDate = leaveRequest.startDate;
      derogation.requestedEndDate = leaveRequest.endDate;
      derogation.status = DerogationStatus.EN_ATTENTE_RH;
      derogation.requestedAt = requestedAt;
      derogation.expiresAt = await this.calculateDerogationExpiryWithSettings(
        leaveRequest.startDate,
      );
      this.ensureBeforeDecisionCutoff(requestedAt, derogation.expiresAt);

      await manager.getRepository(Derogation).save(derogation);

      await this.createHistory(manager, {
        leaveRequest,
        action: AuditAction.DEROGATION_DEMANDEE,
        actorId: authenticatedUser.id,
        comment: derogation.reason,
        metadata: {
          derogationId: derogation.id,
          daysBeforeStart: notice.daysBeforeStart,
          requiredNoticeDays: notice.requiredNoticeDays,
          expiresAt: derogation.expiresAt,
        },
      });

      await this.notificationsService.createForActiveRoles(
        [UserRole.RH],
        {
          type: 'DEROGATION_SUBMITTED_RH',
          title: 'Nouvelle demande de dérogation',
          message: `Une demande de dérogation a été soumise pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate}.`,
          leaveRequestId: leaveRequest.id,
          derogationId: derogation.id,
        },
        manager,
      );

    });

    return this.findMyOne(id, authenticatedUser);
  }

  async deleteDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const derogation = await this.findOwnedDerogationForUpdate(
        manager,
        id,
        authenticatedUser.id,
      );

      this.ensureDerogationIsDraft(derogation);

      await manager.getRepository(Derogation).remove(derogation);
    });
  }

  async findMy(
    authenticatedUser: AuthenticatedUser,
  ): Promise<Derogation[]> {
    await this.expireOutdatedDerogations();

    return this.derogationRepository.find({
      where: {
        employeeId: authenticatedUser.id,
      },
      relations: {
        leaveType: true,
        leaveRequest: true,
        decidedByRh: true,
      },
      order: {
        requestedAt: 'DESC',
      },
    });
  }

  async findMyOne(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<Derogation> {
    await this.expireOutdatedDerogations();

    const derogation = await this.derogationRepository.findOne({
      where: {
        id,
        employeeId: authenticatedUser.id,
      },
      relations: {
        leaveType: true,
        leaveRequest: true,
        decidedByRh: true,
      },
    });

    if (!derogation) {
      throw new NotFoundException(
        `La dérogation ${id} est introuvable.`,
      );
    }

    return derogation;
  }

  async findForManagement(
    query: DerogationQueryDto,
    authenticatedUser: AuthenticatedUser,
  ): Promise<Derogation[]> {
    await this.expireOutdatedDerogations();

    const queryBuilder = this.derogationRepository
      .createQueryBuilder('derogation')
      .leftJoinAndSelect('derogation.employee', 'employee')
      .leftJoinAndSelect('derogation.leaveType', 'leaveType')
      .leftJoinAndSelect(
        'derogation.leaveRequest',
        'leaveRequest',
      )
      .leftJoinAndSelect(
        'derogation.decidedByRh',
        'decidedByRh',
      );

    if (authenticatedUser.role === UserRole.DIRECTEUR) {
      queryBuilder.where('derogation.decidedByRhId IS NOT NULL');
      if (query.status) {
        queryBuilder.andWhere('derogation.status = :status', {
          status: query.status,
        });
      }
    } else if (query.status) {
      queryBuilder.where('derogation.status = :status', {
        status: query.status,
      });
    }

    const derogations = await queryBuilder
      .orderBy('derogation.requestedAt', 'ASC')
      .addOrderBy('derogation.id', 'ASC')
      .getMany();

    return derogations.map((derogation) =>
      this.decorateWorkflowStatus(derogation),
    );
  }

  async findOneForManagement(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<Derogation> {
    await this.expireOutdatedDerogations();

    const derogation = await this.derogationRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        leaveType: true,
        leaveRequest: true,
        decidedByRh: true,
      },
    });

    if (!derogation) {
      throw new NotFoundException(
        `La dérogation ${id} est introuvable.`,
      );
    }

    if (
      authenticatedUser.role === UserRole.DIRECTEUR &&
      derogation.decidedByRhId === null
    ) {
      throw new ForbiddenException(
        'Cette dérogation ne relève pas encore de la validation du Directeur.',
      );
    }

    return this.decorateWorkflowStatus(derogation);
  }

  async decide(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: DecideDerogationDto,
  ): Promise<Derogation> {
    let expiredDuringDecision = false;

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Derogation);
      const derogation = await repository
        .createQueryBuilder('derogation')
        .setLock('pessimistic_write')
        .where('derogation.id = :id', { id })
        .getOne();

      if (!derogation) {
        throw new NotFoundException(
          `La dérogation ${id} est introuvable.`,
        );
      }

      if (derogation.status !== DerogationStatus.EN_ATTENTE_RH) {
        throw new BadRequestException(
          'Cette dérogation a déjà reçu une décision finale.',
        );
      }

      if (this.isExpired(derogation)) {
        expiredDuringDecision = true;
        return;
      }

      if (!derogation.leaveRequestId) {
        throw new BadRequestException(
          'La demande de congé associée à cette dérogation n’existe plus.',
        );
      }

      const leaveRequest = await manager
        .getRepository(LeaveRequest)
        .createQueryBuilder('leaveRequest')
        .setLock('pessimistic_write')
        .where('leaveRequest.id = :leaveRequestId', {
          leaveRequestId: derogation.leaveRequestId,
        })
        .getOne();

      if (!leaveRequest) {
        throw new BadRequestException(
          'La demande de congé associée à cette dérogation n’existe plus.',
        );
      }

      if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
        throw new BadRequestException(
          'La demande de congé associée n’est plus au statut BROUILLON.',
        );
      }

      if (!this.matchesRequestSnapshot(derogation, leaveRequest)) {
        throw new BadRequestException(
          'Le type ou les dates du brouillon ont changé. La dérogation ne correspond plus à la demande.',
        );
      }

      const now = new Date();
      const isGranted = dto.decision === DerogationDecision.ACCORDER;
      const comment = dto.decisionComment?.trim() || null;
      const isRhStage = derogation.decidedByRhId === null;

      if (isRhStage) {
        if (authenticatedUser.role !== UserRole.RH) {
          throw new ForbiddenException(
            'La RH doit valider la dérogation avant le Directeur.',
          );
        }

        derogation.decidedByRhId = authenticatedUser.id;
        derogation.decisionComment = comment;
        derogation.decidedAt = now;

        if (!isGranted) {
          derogation.status = DerogationStatus.REFUSEE;
          derogation.expiresAt = null;
          await repository.save(derogation);

          await this.createHistory(manager, {
            leaveRequest,
            action: AuditAction.DEROGATION_REFUSEE,
            actorId: authenticatedUser.id,
            comment,
            metadata: {
              derogationId: derogation.id,
              status: derogation.status,
              validationLevel: 'RH',
              expiresAt: derogation.expiresAt,
            },
          });

          await this.notificationsService.create(
            {
              userId: derogation.employeeId,
              type: 'DEROGATION_REFUSED',
              title: 'Dérogation refusée',
              message: `Votre dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été refusée par la RH.`,
              leaveRequestId: leaveRequest.id,
              derogationId: derogation.id,
            },
            manager,
          );
          return;
        }

        // Accord RH : la dérogation reste techniquement en attente afin d'éviter
        // une migration d'enum SQL, mais le statut métier exposé devient EN_ATTENTE_DIRECTEUR.
        derogation.status = DerogationStatus.EN_ATTENTE_RH;
        await repository.save(derogation);

        await this.createHistory(manager, {
          leaveRequest,
          action: AuditAction.DEROGATION_PREVALIDEE_RH,
          actorId: authenticatedUser.id,
          comment,
          metadata: {
            derogationId: derogation.id,
            status: 'EN_ATTENTE_DIRECTEUR',
            validationLevel: 'RH',
            nextValidatorRole: UserRole.DIRECTEUR,
            expiresAt: derogation.expiresAt,
          },
        });

        await this.notificationsService.createForActiveRoles(
          [UserRole.DIRECTEUR],
          {
            type: 'DEROGATION_WAITING_DIRECTOR',
            title: 'Dérogation à valider',
            message: `La RH a validé la dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate}. Votre décision finale est requise.`,
            leaveRequestId: leaveRequest.id,
            derogationId: derogation.id,
          },
          manager,
        );

        await this.notificationsService.create(
          {
            userId: derogation.employeeId,
            type: 'DEROGATION_IN_PROGRESS',
            title: 'Dérogation en cours de validation',
            message: 'La RH a validé votre dérogation. Elle est maintenant transmise au Directeur pour décision finale.',
            leaveRequestId: leaveRequest.id,
            derogationId: derogation.id,
          },
          manager,
        );
        return;
      }

      if (authenticatedUser.role !== UserRole.DIRECTEUR) {
        throw new ForbiddenException(
          'La validation finale de cette dérogation relève du Directeur.',
        );
      }

      derogation.status = isGranted
        ? DerogationStatus.ACCORDEE
        : DerogationStatus.REFUSEE;
      derogation.expiresAt = null;
      await repository.save(derogation);

      await this.createHistory(manager, {
        leaveRequest,
        action: isGranted
          ? AuditAction.DEROGATION_ACCORDEE
          : AuditAction.DEROGATION_REFUSEE,
        actorId: authenticatedUser.id,
        comment,
        metadata: {
          derogationId: derogation.id,
          status: derogation.status,
          validationLevel: 'DIRECTEUR',
          rhValidatorId: derogation.decidedByRhId,
          expiresAt: derogation.expiresAt,
        },
      });

      await this.notificationsService.create(
        {
          userId: derogation.employeeId,
          type: isGranted
            ? 'DEROGATION_APPROVED'
            : 'DEROGATION_REFUSED',
          title: isGranted
            ? 'Dérogation accordée'
            : 'Dérogation refusée',
          message: isGranted
            ? `Votre dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été validée par la RH puis accordée par le Directeur.`
            : `Votre dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été refusée par le Directeur.`,
          leaveRequestId: leaveRequest.id,
          derogationId: derogation.id,
        },
        manager,
      );

      if (derogation.decidedByRhId) {
        await this.notificationsService.create(
          {
            userId: derogation.decidedByRhId,
            type: 'DEROGATION_FINAL_DECISION_INFO',
            title: isGranted
              ? 'Dérogation validée par le Directeur'
              : 'Dérogation refusée par le Directeur',
            message: isGranted
              ? `La dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a terminé son traitement et peut être appliquée à la demande de congé.`
              : `La dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été refusée lors de la décision finale.`,
            leaveRequestId: leaveRequest.id,
            derogationId: derogation.id,
          },
          manager,
        );
      }
    });

    if (expiredDuringDecision) {
      await this.expireOutdatedDerogations();
      throw new BadRequestException(
        'Le délai de traitement de cette dérogation est dépassé. La limite était fixée à 16 h (heure de Martinique).',
      );
    }

    return this.findOneForManagement(id, authenticatedUser);
  }

  private decorateWorkflowStatus(derogation: Derogation): Derogation {
    if (
      derogation.status === DerogationStatus.EN_ATTENTE_RH &&
      derogation.decidedByRhId !== null
    ) {
      return Object.assign(derogation, {
        workflowStatus: 'EN_ATTENTE_DIRECTEUR',
      });
    }

    return Object.assign(derogation, {
      workflowStatus: derogation.status,
    });
  }

  async consumeGrantedDerogation(
    manager: EntityManager,
    data: {
      leaveRequest: LeaveRequest;
      actorId: number;
    },
  ): Promise<Derogation> {
    const now = new Date();
    const repository = manager.getRepository(Derogation);

    const derogation = await repository
      .createQueryBuilder('derogation')
      .setLock('pessimistic_write')
      .where('derogation.leaveRequestId = :leaveRequestId', {
        leaveRequestId: data.leaveRequest.id,
      })
      .andWhere('derogation.employeeId = :employeeId', {
        employeeId: data.leaveRequest.employeeId,
      })
      .andWhere('derogation.status = :status', {
        status: DerogationStatus.ACCORDEE,
      })
      .andWhere('derogation.usedAt IS NULL')
      .getOne();

    if (
      !derogation ||
      !this.matchesRequestSnapshot(
        derogation,
        data.leaveRequest,
      )
    ) {
      throw new BadRequestException(
        'Une dérogation validée par la RH puis le Directeur et correspondant exactement à cette demande est obligatoire.',
      );
    }

    derogation.status = DerogationStatus.UTILISEE;
    derogation.usedAt = now;

    await repository.save(derogation);

    await this.createHistory(manager, {
      leaveRequest: data.leaveRequest,
      action: AuditAction.DEROGATION_UTILISEE,
      actorId: data.actorId,
      comment: null,
      metadata: {
        derogationId: derogation.id,
        usedAt: now,
      },
    });

    return derogation;
  }

  async invalidateForDraftChange(
    manager: EntityManager,
    data: {
      leaveRequest: LeaveRequest;
    },
  ): Promise<{
    derogationId: number;
    previousStatus: DerogationStatus;
    newStatus: DerogationStatus;
  } | null> {
    const repository = manager.getRepository(Derogation);
    const derogation = await repository
      .createQueryBuilder('derogation')
      .setLock('pessimistic_write')
      .where('derogation.leaveRequestId = :leaveRequestId', {
        leaveRequestId: data.leaveRequest.id,
      })
      .getOne();

    if (
      !derogation ||
      this.matchesRequestSnapshot(derogation, data.leaveRequest) ||
      (
        derogation.status !== DerogationStatus.EN_ATTENTE_RH &&
        derogation.status !== DerogationStatus.ACCORDEE
      )
    ) {
      return null;
    }

    const previousStatus = derogation.status;
    derogation.status = DerogationStatus.EXPIREE;
    derogation.usedAt = null;

    await repository.save(derogation);

    return {
      derogationId: derogation.id,
      previousStatus,
      newStatus: derogation.status,
    };
  }

  async prepareForRequestResubmission(
    manager: EntityManager,
    data: {
      leaveRequest: LeaveRequest;
    },
  ): Promise<{
    derogationId: number;
    status: DerogationStatus;
    requiresRhDecision: boolean;
  } | null> {
    const notice = await this.evaluateSubmissionNoticeWithSettings(
      data.leaveRequest.startDate,
      data.leaveRequest.endDate,
      data.leaveRequest.calendarDuration,
    );

    if (notice.isNoticeCompliant) {
      return null;
    }

    const repository = manager.getRepository(Derogation);
    const derogation = await repository
      .createQueryBuilder('derogation')
      .setLock('pessimistic_write')
      .where('derogation.leaveRequestId = :leaveRequestId', {
        leaveRequestId: data.leaveRequest.id,
      })
      .getOne();

    if (!derogation) {
      return null;
    }

    const stillMatchesApprovedRequest =
      this.matchesRequestSnapshot(
        derogation,
        data.leaveRequest,
      );

    derogation.leaveTypeId = data.leaveRequest.leaveTypeId;
    derogation.requestedStartDate =
      data.leaveRequest.startDate;
    derogation.requestedEndDate =
      data.leaveRequest.endDate;
    derogation.usedAt = null;

    if (
      derogation.status === DerogationStatus.UTILISEE &&
      stillMatchesApprovedRequest
    ) {
      derogation.status = DerogationStatus.ACCORDEE;
      derogation.expiresAt = null;

      await repository.save(derogation);

      return {
        derogationId: derogation.id,
        status: derogation.status,
        requiresRhDecision: false,
      };
    }

    derogation.status = DerogationStatus.EN_ATTENTE_RH;
    derogation.decidedByRhId = null;
    derogation.decisionComment = null;
    derogation.decidedAt = null;
    derogation.expiresAt = await this.calculateDerogationExpiryWithSettings(
      data.leaveRequest.startDate,
    );
    this.ensureBeforeDecisionCutoff(new Date(), derogation.expiresAt);

    await repository.save(derogation);

    return {
      derogationId: derogation.id,
      status: derogation.status,
      requiresRhDecision: true,
    };
  }

  async expireForCancelledRequest(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<{
    derogationId: number;
    previousStatus: DerogationStatus;
    newStatus: DerogationStatus;
  } | null> {
    const repository = manager.getRepository(Derogation);
    const derogation = await repository
      .createQueryBuilder('derogation')
      .setLock('pessimistic_write')
      .where('derogation.leaveRequestId = :leaveRequestId', {
        leaveRequestId,
      })
      .getOne();

    if (!derogation) {
      return null;
    }

    if (
      ![
        DerogationStatus.EN_ATTENTE_RH,
        DerogationStatus.ACCORDEE,
      ].includes(derogation.status)
    ) {
      return {
        derogationId: derogation.id,
        previousStatus: derogation.status,
        newStatus: derogation.status,
      };
    }

    const previousStatus = derogation.status;

    derogation.status = DerogationStatus.EXPIREE;
    derogation.usedAt = null;

    await repository.save(derogation);

    return {
      derogationId: derogation.id,
      previousStatus,
      newStatus: derogation.status,
    };
  }

  private async evaluateSubmissionNoticeWithSettings(
    startDate: string,
    endDate: string,
    calendarDuration: number,
  ): Promise<ReturnType<typeof evaluateSubmissionNotice>> {
    const rules = await this.settingsService.getSubmissionRules();
    return evaluateSubmissionNotice(
      startDate,
      endDate,
      calendarDuration,
      new Date(),
      rules,
    );
  }

  private async calculateDerogationExpiryWithSettings(
    startDate: string,
  ): Promise<Date> {
    const rules = await this.settingsService.getSubmissionRules();
    return calculateDerogationExpiry(
      startDate,
      rules.derogationLastAllowedDay,
    );
  }

  private ensureBeforeDecisionCutoff(
    now: Date,
    cutoff: Date | null,
  ): void {
    if (cutoff && now.getTime() >= cutoff.getTime()) {
      throw new BadRequestException(
        'Le délai de traitement de la dérogation est terminé. La limite est fixée à J-3 à 16 h (heure de Martinique).',
      );
    }
  }

  private validateDerogationWindow(
    notice: ReturnType<typeof evaluateSubmissionNotice>,
  ): void {
    if (notice.daysBeforeStart < 0) {
      throw new BadRequestException(
        'Une dérogation ne peut pas être demandée après la date de début du congé.',
      );
    }

    if (notice.daysBeforeStart < 3) {
      throw new BadRequestException(
        'Une dérogation ne peut plus être demandée après J-3 à 16 h (heure de Martinique).',
      );
    }

    if (notice.isNoticeCompliant) {
      throw new BadRequestException(
        'Le délai de prévenance est respecté. Aucune dérogation n’est nécessaire.',
      );
    }

    if (!notice.isDerogationWindow) {
      throw new BadRequestException(
        `Les dérogations sont autorisées uniquement entre J-29 et J-3, avec une limite à 16 h le dernier jour. Cette demande exige normalement un délai de ${notice.requiredNoticeDays} jours.`,
      );
    }
  }

  private ensureLeaveRequestIsDraft(
    leaveRequest: LeaveRequest,
  ): void {
    if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
      throw new BadRequestException(
        'Une dérogation ne peut être associée qu’à une demande de congé en brouillon.',
      );
    }
  }

  private ensureDerogationIsDraft(
    derogation: Derogation,
  ): void {
    if (
      derogation.status !== DerogationStatus.EN_ATTENTE_RH ||
      derogation.decidedByRhId !== null
    ) {
      throw new BadRequestException(
        'Seule une dérogation encore en attente de décision RH peut être modifiée, supprimée ou transmise.',
      );
    }
  }

  private async findOwnedLeaveRequestForUpdate(
    manager: EntityManager,
    leaveRequestId: number,
    employeeId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('leaveRequest')
      .setLock('pessimistic_write')
      .where('leaveRequest.id = :leaveRequestId', {
        leaveRequestId,
      })
      .andWhere('leaveRequest.employeeId = :employeeId', {
        employeeId,
      })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${leaveRequestId} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private async findOwnedDerogationForUpdate(
    manager: EntityManager,
    id: number,
    employeeId: number,
  ): Promise<Derogation> {
    const derogation = await manager
      .getRepository(Derogation)
      .createQueryBuilder('derogation')
      .setLock('pessimistic_write')
      .where('derogation.id = :id', { id })
      .andWhere('derogation.employeeId = :employeeId', {
        employeeId,
      })
      .getOne();

    if (!derogation) {
      throw new NotFoundException(
        `La dérogation ${id} est introuvable.`,
      );
    }

    return derogation;
  }

  private matchesRequestSnapshot(
    derogation: Derogation,
    leaveRequest: LeaveRequest,
  ): boolean {
    return (
      derogation.employeeId === leaveRequest.employeeId &&
      derogation.leaveTypeId === leaveRequest.leaveTypeId &&
      derogation.requestedStartDate === leaveRequest.startDate &&
      derogation.requestedEndDate === leaveRequest.endDate
    );
  }

  private isExpired(derogation: Derogation): boolean {
    return Boolean(
      derogation.expiresAt &&
        derogation.expiresAt.getTime() <= Date.now(),
    );
  }

  async expireOutdatedDerogations(now = new Date()): Promise<number> {
    const candidates = await this.derogationRepository
      .createQueryBuilder('derogation')
      .leftJoinAndSelect('derogation.employee', 'employee')
      .leftJoinAndSelect('derogation.leaveRequest', 'leaveRequest')
      .where('derogation.status IN (:...statuses)', {
        statuses: EXPIRABLE_DEROGATION_STATUSES,
      })
      .andWhere('derogation.usedAt IS NULL')
      .andWhere('derogation.expiresAt IS NOT NULL')
      .andWhere('derogation.expiresAt <= :now', { now })
      .orderBy('derogation.expiresAt', 'ASC')
      .getMany();

    let expired = 0;

    for (const candidate of candidates) {
      const didExpire = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Derogation);
        const derogation = await repository
          .createQueryBuilder('derogation')
          .setLock('pessimistic_write')
          .where('derogation.id = :id', { id: candidate.id })
          .getOne();

        if (
          !derogation ||
          !EXPIRABLE_DEROGATION_STATUSES.includes(derogation.status) ||
          derogation.usedAt !== null ||
          !derogation.expiresAt ||
          derogation.expiresAt.getTime() > now.getTime()
        ) {
          return false;
        }

        const directorStage = derogation.decidedByRhId !== null;
        derogation.status = DerogationStatus.EXPIREE;
        await repository.save(derogation);

        const leaveRequestId = derogation.leaveRequestId;
        const employeeName = candidate.employee
          ? `${candidate.employee.nom} ${candidate.employee.prenom}`
          : 'le collaborateur';
        const period = `${candidate.requestedStartDate} au ${candidate.requestedEndDate}`;

        await this.notificationsService.create(
          {
            userId: derogation.employeeId,
            type: 'DEROGATION_DEADLINE_EXPIRED',
            title: 'Délai de traitement de la dérogation dépassé',
            message: `Le délai de traitement de votre dérogation pour la période du ${period} s’est terminé à 16 h (heure de Martinique).`,
            leaveRequestId,
            derogationId: derogation.id,
          },
          manager,
        );

        await this.notificationsService.createForActiveRoles(
          [directorStage ? UserRole.DIRECTEUR : UserRole.RH],
          {
            type: 'DEROGATION_DEADLINE_EXPIRED_ACTION',
            title: 'Délai de dérogation dépassé',
            message: `La dérogation n°${derogation.id} de ${employeeName} n’a pas été traitée avant l’échéance de 16 h.`,
            leaveRequestId,
            derogationId: derogation.id,
          },
          manager,
        );

        if (directorStage && derogation.decidedByRhId) {
          await this.notificationsService.create(
            {
              userId: derogation.decidedByRhId,
              type: 'DEROGATION_DEADLINE_EXPIRED_INFO',
              title: 'Dérogation clôturée à l’échéance',
              message: `La dérogation n°${derogation.id} de ${employeeName}, transmise au Directeur, a atteint son échéance à 16 h sans décision finale.`,
              leaveRequestId,
              derogationId: derogation.id,
            },
            manager,
          );
        }

        return true;
      });

      if (didExpire) expired += 1;
    }

    return expired;
  }

  private async createHistory(
    manager: EntityManager,
    data: {
      leaveRequest: LeaveRequest;
      action: AuditAction;
      actorId: number;
      comment: string | null;
      metadata: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await this.auditService.recordStatusChange(
      {
        actorId: data.actorId,
        action: data.action,
        resourceType: 'DEROGATIONS',
        resourceId: data.leaveRequest.id,
        oldStatus: data.leaveRequest.status,
        newStatus: data.leaveRequest.status,
        comment: data.comment,
        metadata: data.metadata,
      },
      manager,
    );
  }
}
