import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
  DerogationStatus.EN_ATTENTE_RH,
  DerogationStatus.ACCORDEE,
];

@Injectable()
export class DerogationsService {
  constructor(
    @InjectRepository(Derogation)
    private readonly derogationRepository: Repository<Derogation>,

    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
            'Une demande de dérogation est déjà en attente de décision RH pour cette période.',
          );
        }

        if (
          sameRequest &&
          existingDerogation.status === DerogationStatus.ACCORDEE
        ) {
          throw new ConflictException(
            'Une dérogation RH est déjà accordée pour cette période.',
          );
        }

        if (
          sameRequest &&
          existingDerogation.status === DerogationStatus.UTILISEE
        ) {
          throw new ConflictException(
            'La dérogation liée à cette période a déjà été utilisée.',
          );
        }

        const requestedAt = new Date();
        const expiresAt =
          await this.calculateDerogationExpiryWithSettings(
            leaveRequest.startDate,
          );

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
        derogation.reason = dto.reason.trim();
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
          'La demande de congé liée à cette dérogation n’existe plus.',
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
      derogation.reason = dto.reason.trim();
      derogation.expiresAt = await this.calculateDerogationExpiryWithSettings(
        leaveRequest.startDate,
      );

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
          'La demande de congé liée à cette dérogation n’existe plus.',
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

      await this.notificationsService.createForActiveRoles(
        [UserRole.DIRECTEUR],
        {
          type: 'DEROGATION_DIRECTOR_INFO',
          title: 'Nouvelle dérogation',
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

    if (query.status) {
      queryBuilder.where('derogation.status = :status', {
        status: query.status,
      });
    }

    return queryBuilder
      .orderBy('derogation.requestedAt', 'DESC')
      .addOrderBy('derogation.id', 'DESC')
      .getMany();
  }

  async findOneForManagement(id: number): Promise<Derogation> {
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

    return derogation;
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
          'Seule une dérogation au statut EN_ATTENTE_RH peut être traitée.',
        );
      }

      if (this.isExpired(derogation)) {
        derogation.status = DerogationStatus.EXPIREE;
        await repository.save(derogation);
        expiredDuringDecision = true;
        return;
      }

      if (!derogation.leaveRequestId) {
        throw new BadRequestException(
          'La demande de congé liée à cette dérogation n’existe plus.',
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
          'La demande de congé liée à cette dérogation n’existe plus.',
        );
      }

      if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
        throw new BadRequestException(
          'La demande de congé liée n’est plus au statut EN_ATTENTE_RH.',
        );
      }

      if (!this.matchesRequestSnapshot(derogation, leaveRequest)) {
        throw new BadRequestException(
          'Le type ou les dates du brouillon ont changé. La dérogation ne correspond plus à la demande.',
        );
      }

      const now = new Date();
      const isGranted =
        dto.decision === DerogationDecision.ACCORDER;
      const comment = dto.decisionComment?.trim() || null;

      derogation.status = isGranted
        ? DerogationStatus.ACCORDEE
        : DerogationStatus.REFUSEE;
      derogation.decidedByRhId = authenticatedUser.id;
      derogation.decisionComment = comment;
      derogation.decidedAt = now;

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
            ? `Votre dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été accordée.`
            : `Votre dérogation pour la période du ${leaveRequest.startDate} au ${leaveRequest.endDate} a été refusée.`,
          leaveRequestId: leaveRequest.id,
          derogationId: derogation.id,
        },
        manager,
      );
    });

    if (expiredDuringDecision) {
      throw new BadRequestException(
        'Cette dérogation a expiré et ne peut plus être traitée.',
      );
    }

    return this.findOneForManagement(id);
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

    await repository
      .createQueryBuilder()
      .update(Derogation)
      .set({ status: DerogationStatus.EXPIREE })
      .where('leave_request_id = :leaveRequestId', {
        leaveRequestId: data.leaveRequest.id,
      })
      .andWhere('status = :status', {
        status: DerogationStatus.ACCORDEE,
      })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at IS NOT NULL')
      .andWhere('expires_at <= :now', { now })
      .execute();

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
      .andWhere('derogation.expiresAt > :now', { now })
      .getOne();

    if (
      !derogation ||
      !this.matchesRequestSnapshot(
        derogation,
        data.leaveRequest,
      )
    ) {
      throw new BadRequestException(
        'Une dérogation RH accordée, valide et correspondant exactement à cette demande est obligatoire.',
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
    derogation.expiresAt = await this.calculateDerogationExpiryWithSettings(
      data.leaveRequest.startDate,
    );
    derogation.usedAt = null;

    if (
      derogation.status === DerogationStatus.UTILISEE &&
      stillMatchesApprovedRequest
    ) {
      derogation.status = DerogationStatus.ACCORDEE;

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
        'Une dérogation ne peut plus être demandée à partir de J-2.',
      );
    }

    if (notice.isNoticeCompliant) {
      throw new BadRequestException(
        'Le délai de prévenance est respecté. Aucune dérogation n’est nécessaire.',
      );
    }

    if (!notice.isDerogationWindow) {
      throw new BadRequestException(
        `Les dérogations sont autorisées uniquement entre J-29 et J-3. Cette demande exige normalement un délai de ${notice.requiredNoticeDays} jours.`,
      );
    }
  }

  private ensureLeaveRequestIsDraft(
    leaveRequest: LeaveRequest,
  ): void {
    if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
      throw new BadRequestException(
        'Une dérogation ne peut être liée qu’à une demande de congé au statut EN_ATTENTE_RH.',
      );
    }
  }

  private ensureDerogationIsDraft(
    derogation: Derogation,
  ): void {
    if (derogation.status !== DerogationStatus.EN_ATTENTE_RH) {
      throw new BadRequestException(
        'Seule une dérogation au statut EN_ATTENTE_RH peut être modifiée, supprimée ou transmise à la RH.',
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

  private async expireOutdatedDerogations(): Promise<void> {
    await this.derogationRepository
      .createQueryBuilder()
      .update(Derogation)
      .set({ status: DerogationStatus.EXPIREE })
      .where('status IN (:...statuses)', {
        statuses: EXPIRABLE_DEROGATION_STATUSES,
      })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at IS NOT NULL')
      .andWhere('expires_at <= :now', {
        now: new Date(),
      })
      .execute();
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
