import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  In,
  Repository,
} from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  Document,
  DocumentStatus,
} from '../documents/document.entity';
import { DerogationsService } from '../derogations/derogations.service';
import { DocumentPdfService } from '../documents/document-pdf.service';
import type { Holiday } from '../holidays/holiday.entity';
import { HolidaysService } from '../holidays/holidays.service';
import {
  LeaveBalancesService,
  type PaidLeaveReservationSummary,
} from '../leave-balances/leave-balances.service';
import {
  LeaveType,
  LeaveTypeCategory,
} from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import {
  ServiceType,
  ValidationMode,
} from '../services/service.entity';
import {
  PresenceStatus,
  User,
  UserRole,
} from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PresenceService } from '../presence/presence.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CancelLeaveRequestDto } from './dto/cancel-leave-request.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RefuseLeaveRequestDto } from './dto/refuse-leave-request.dto';
import { RequestCancellationAfterValidationDto } from './dto/request-cancellation-after-validation.dto';
import { RespondCancellationDto } from './dto/respond-cancellation.dto';
import { SubmitLeaveRequestDto } from './dto/submit-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { ValidateLeaveRequestDto } from './dto/validate-leave-request.dto';
import {
  evaluateSubmissionNotice,
  type SubmissionNoticeInfo,
} from './leave-request-notice.util';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { ServiceAvailabilityService } from './service-availability.service';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
  SignatureType,
} from './leave-request.entity';


type DecisionAccessKind =
  | 'RESPONSABLE_PRINCIPAL'
  | 'DIRECTEUR_RH'
  | 'DIRECTEUR_SEUL'
  | 'RELAIS'
  | 'URGENCE';

interface DecisionAccess {
  kind: DecisionAccessKind;
  reason: string | null;
}

@Injectable()
export class LeaveRequestsService {
  private readonly logger = new Logger(
    LeaveRequestsService.name,
  );

  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    private readonly auditService: AuditService,

    private readonly usersService: UsersService,
    private readonly leaveTypesService: LeaveTypesService,
    private readonly holidaysService: HolidaysService,
    private readonly derogationsService: DerogationsService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly documentPdfService: DocumentPdfService,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly serviceAvailabilityService: ServiceAvailabilityService,
    private readonly presenceService: PresenceService,
    private readonly dataSource: DataSource,
  ) {}

  async createDraft(
    authenticatedUser: AuthenticatedUser,
    createLeaveRequestDto: CreateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    const employee = await this.resolveEmployee(
      authenticatedUser,
      createLeaveRequestDto.employeeId,
    );

    const employeeServiceId = employee.serviceId;
    const employeeService = employee.service;

    if (!employeeServiceId || !employeeService) {
      throw new BadRequestException(
        'Un service actif doit être affecté à l’utilisateur avant de créer une demande de congé.',
      );
    }

    if (!employeeService.isActive) {
      throw new BadRequestException(
        'Le service du collaborateur est inactif : aucune demande de congé ne peut être créée.',
      );
    }

    const leaveType = await this.leaveTypesService.findOne(
      createLeaveRequestDto.leaveTypeId,
    );

    this.validateLeaveType(leaveType);

    const startPeriod =
      createLeaveRequestDto.startPeriod ?? DayPeriod.MATIN;
    const endPeriod =
      createLeaveRequestDto.endPeriod ?? DayPeriod.APRES_MIDI;

    const dates = await this.validateAndCalculateDates(
      createLeaveRequestDto.startDate,
      createLeaveRequestDto.endDate,
      startPeriod,
      endPeriod,
      leaveType.allowsHalfDays,
    );

    const leaveRequest = this.leaveRequestRepository.create({
      employeeId: employee.id,
      employee,
      createdById: authenticatedUser.id,
      createdBy: { id: authenticatedUser.id } as User,
      leaveTypeId: leaveType.id,
      leaveType,
      serviceId: employeeServiceId,
      service: employeeService,
      startDate: createLeaveRequestDto.startDate,
      endDate: createLeaveRequestDto.endDate,
      startPeriod,
      endPeriod,
      calendarDuration: dates.calendarDuration,
      deductedDays: dates.deductedDays,
      status: LeaveRequestStatus.BROUILLON,
      comment: createLeaveRequestDto.comment?.trim() || null,
      submittedAt: null,
      modificationDeadline: await this.calculateModificationDeadline(
        createLeaveRequestDto.startDate,
      ),
      realBalanceBefore: null,
      potentialBalanceBefore: null,
      realBalanceAfter: null,
      finalDeciderId: null,
      finalDecider: null,
      finalDeciderRole: null,
      decisionAt: null,
      refusalComment: null,
      employeeSignatureType: null,
      employeeSignatureData: null,
      employeeSignedAt: null,
      validatorSignatureType: null,
      validatorSignatureData: null,
      validatorSignedAt: null,
      rhConfirmedDirectorAgreement: false,
      rhDirectorAgreementConfirmedAt: null,
      isUrgent: false,
      urgentReason: null,
      version: 1,
      lockedAt: null,
      cancellationRequestedById: null,
      cancellationRequestedBy: null,
      cancellationReason: null,
      employeeCancellationConsent: null,
      employeeCancellationResponseAt: null,
      cancelledAt: null,
    });

    const savedRequest = await this.leaveRequestRepository.save(
      leaveRequest,
    );

    await this.auditService.recordStatusChange({
      actorId: authenticatedUser.id,
      action: AuditAction.BROUILLON_CREE,
      resourceType: 'LEAVE_REQUESTS',
      resourceId: savedRequest.id,
      oldStatus: null,
      newStatus: LeaveRequestStatus.BROUILLON,
      comment: null,
      metadata: {
        startDate: savedRequest.startDate,
        endDate: savedRequest.endDate,
        deductedDays: savedRequest.deductedDays,
      },
    });

    return this.findOwnedRequest(savedRequest.id, employee.id);
  }

  async createDirectorRequest(
    authenticatedUser: AuthenticatedUser,
    createLeaveRequestDto: CreateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    const employee = await this.usersService.findOne(
      authenticatedUser.id,
    );

    if (employee.role !== UserRole.DIRECTEUR) {
      throw new ForbiddenException(
        'Seul le Directeur peut enregistrer directement ses congés.',
      );
    }

    if (!employee.isActive) {
      throw new ForbiddenException(
        'Le compte utilisateur est désactivé.',
      );
    }

    const employeeServiceId = employee.serviceId;
    const employeeService = employee.service;

    if (!employeeServiceId || !employeeService) {
      throw new BadRequestException(
        'Un service actif doit être affecté au Directeur avant d’enregistrer un congé.',
      );
    }

    if (!employeeService.isActive) {
      throw new BadRequestException(
        'Le service du Directeur est inactif : aucun congé ne peut être enregistré.',
      );
    }

    const leaveType = await this.leaveTypesService.findOne(
      createLeaveRequestDto.leaveTypeId,
    );

    this.validateLeaveType(leaveType);

    const startPeriod =
      createLeaveRequestDto.startPeriod ?? DayPeriod.MATIN;
    const endPeriod =
      createLeaveRequestDto.endPeriod ?? DayPeriod.APRES_MIDI;

    const dates = await this.validateAndCalculateDates(
      createLeaveRequestDto.startDate,
      createLeaveRequestDto.endDate,
      startPeriod,
      endPeriod,
      leaveType.allowsHalfDays,
    );

    let requestId = 0;
    let requestEmployeeId = employee.id;

    await this.dataSource.transaction(async (manager) => {
      const savedRequest = await manager
        .getRepository(LeaveRequest)
        .save(
          this.leaveRequestRepository.create({
            employeeId: employee.id,
            employee,
            createdById: employee.id,
            createdBy: employee,
            leaveTypeId: leaveType.id,
            leaveType,
            serviceId: employeeServiceId,
            service: employeeService,
            startDate: createLeaveRequestDto.startDate,
            endDate: createLeaveRequestDto.endDate,
            startPeriod,
            endPeriod,
            calendarDuration: dates.calendarDuration,
            deductedDays: dates.deductedDays,
            status: LeaveRequestStatus.VALIDEE,
            comment: createLeaveRequestDto.comment?.trim() || null,
            submittedAt: new Date(),
            modificationDeadline: null,
            realBalanceBefore: null,
            potentialBalanceBefore: null,
            realBalanceAfter: null,
            finalDeciderId: authenticatedUser.id,
            finalDecider: employee,
            finalDeciderRole: UserRole.DIRECTEUR,
            decisionAt: new Date(),
            refusalComment: null,
            employeeSignatureType: null,
            employeeSignatureData: null,
            employeeSignedAt: null,
            validatorSignatureType: null,
            validatorSignatureData: null,
            validatorSignedAt: null,
            rhConfirmedDirectorAgreement: false,
            rhDirectorAgreementConfirmedAt: null,
            isUrgent: false,
            urgentReason: null,
            version: 1,
            lockedAt: new Date(),
            cancellationRequestedById: null,
            cancellationReason: null,
            employeeCancellationConsent: null,
            employeeCancellationResponseAt: null,
            cancelledAt: null,
          }),
        );

      await this.ensureNoPersonalOverlap(manager, savedRequest);

      if (leaveType.deductsPaidLeaveBalance) {
        const reservation =
          await this.leaveBalancesService.reservePaidLeaveForRequest(
            manager,
            {
              employeeId: employee.id,
              leaveRequestId: savedRequest.id,
              days: dates.deductedDays,
              actorId: authenticatedUser.id,
              reason:
                'Réservation et déduction immédiates pour un congé enregistré par le Directeur.',
            },
          );
        const balanceResult =
          await this.leaveBalancesService.finalizePaidLeaveReservation(
            manager,
            {
              employeeId: employee.id,
              leaveRequestId: savedRequest.id,
              actorId: authenticatedUser.id,
              expectedDays: dates.deductedDays,
              decision: 'VALIDATE',
            },
          );

        savedRequest.realBalanceBefore =
          reservation.realBalanceBefore;
        savedRequest.potentialBalanceBefore =
          reservation.potentialBalanceBefore;
        savedRequest.realBalanceAfter =
          balanceResult.realBalanceAfter;

        await manager.getRepository(LeaveRequest).save(
          savedRequest,
        );
      }

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: AuditAction.CONGE_DIRECTEUR_ENREGISTRE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: savedRequest.id,
          oldStatus: null,
          newStatus: LeaveRequestStatus.VALIDEE,
          comment: null,
          metadata: {
            startDate: savedRequest.startDate,
            endDate: savedRequest.endDate,
            deductedDays: savedRequest.deductedDays,
            realBalanceBefore: savedRequest.realBalanceBefore,
            realBalanceAfter: savedRequest.realBalanceAfter,
            signature: 'NON_REQUISE',
          },
        },
        manager,
      );

      await this.notificationsService.create(
        {
          userId: employee.id,
          type: 'CONGE_DIRECTEUR_ENREGISTRE',
          title: 'Congé enregistré',
          message: `Votre congé du ${savedRequest.startDate} au ${savedRequest.endDate} a été enregistré.`,
          leaveRequestId: savedRequest.id,
        },
        manager,
      );

      requestId = savedRequest.id;
      requestEmployeeId = savedRequest.employeeId;
    });

    await this.presenceService.refreshUserStatus(employee.id);

    return this.findOwnedRequest(requestId, requestEmployeeId);
  }

  private async resolveEmployee(
    authenticatedUser: AuthenticatedUser,
    requestedEmployeeId?: number,
  ): Promise<User> {
    const employeeId = requestedEmployeeId ?? authenticatedUser.id;

    if (
      requestedEmployeeId !== undefined &&
      requestedEmployeeId !== authenticatedUser.id &&
      authenticatedUser.role !== UserRole.RH
    ) {
      throw new ForbiddenException(
        'Seule la RH peut créer une demande pour un autre collaborateur.',
      );
    }

    const employee = await this.usersService.findOne(employeeId);

    if (!employee.isActive) {
      throw new ForbiddenException(
        'Le compte utilisateur est désactivé.',
      );
    }

    return employee;
  }

  async findMyRequests(
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest[]> {
    return this.leaveRequestRepository.find({
      where: {
        employeeId: authenticatedUser.id,
      },
      relations: {
        leaveType: true,
        service: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findMyRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    const canRead =
      leaveRequest.employeeId === authenticatedUser.id ||
      leaveRequest.createdById === authenticatedUser.id ||
      authenticatedUser.role === UserRole.RH;

    if (!canRead) {
      throw new ForbiddenException(
        'Vous ne pouvez consulter que vos propres demandes de congé.',
      );
    }

    return leaveRequest;
  }

  async updateRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
    updateLeaveRequestDto: UpdateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    let requestEmployeeId = authenticatedUser.id;

    await this.dataSource.transaction(async (manager) => {
      const leaveRequest = await this.findRequestForUpdateLocked(
        manager,
        id,
      );

      requestEmployeeId = leaveRequest.employeeId;
      const oldStatus = leaveRequest.status;
      const isSubmittedRequest =
        oldStatus === LeaveRequestStatus.EN_ATTENTE_VALIDATION;

      const isOwner = leaveRequest.employeeId === authenticatedUser.id;
      const isCreator = leaveRequest.createdById === authenticatedUser.id;
      if (!isOwner && !isCreator) {
        throw new ForbiddenException(
          'Vous ne pouvez pas modifier cette demande.',
        );
      }
      if (isSubmittedRequest && !isOwner) {
        throw new ForbiddenException(
          'Seul le collaborateur concerné peut modifier une demande soumise.',
        );
      }

      if (
        oldStatus !== LeaveRequestStatus.BROUILLON &&
        !isSubmittedRequest
      ) {
        throw new BadRequestException(
          'Seule une demande en brouillon ou en attente de validation peut être modifiée.',
        );
      }

      if (isSubmittedRequest) {
        await this.ensureModificationAllowed(leaveRequest.startDate);
      }

      const oldLeaveType = leaveRequest.leaveType;
      const oldSnapshot = {
        leaveTypeId: leaveRequest.leaveTypeId,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        startPeriod: leaveRequest.startPeriod,
        endPeriod: leaveRequest.endPeriod,
        calendarDuration: leaveRequest.calendarDuration,
        deductedDays: leaveRequest.deductedDays,
        comment: leaveRequest.comment,
        submittedAt: leaveRequest.submittedAt,
        employeeSignatureType:
          leaveRequest.employeeSignatureType,
        employeeSignedAt: leaveRequest.employeeSignedAt,
        employeeSignatureHash: this.hashSignature(
          leaveRequest.employeeSignatureData,
        ),
        version: leaveRequest.version,
      };

      const leaveType =
        updateLeaveRequestDto.leaveTypeId !== undefined &&
        updateLeaveRequestDto.leaveTypeId !==
          leaveRequest.leaveTypeId
          ? await manager.getRepository(LeaveType).findOneBy({
              id: updateLeaveRequestDto.leaveTypeId,
            })
          : oldLeaveType;

      if (!leaveType) {
        throw new NotFoundException(
          `Le type de congé ${updateLeaveRequestDto.leaveTypeId} est introuvable.`,
        );
      }

      this.validateLeaveType(leaveType);

      const startDate =
        updateLeaveRequestDto.startDate ??
        leaveRequest.startDate;
      const endDate =
        updateLeaveRequestDto.endDate ?? leaveRequest.endDate;
      const startPeriod =
        updateLeaveRequestDto.startPeriod ??
        leaveRequest.startPeriod;
      const endPeriod =
        updateLeaveRequestDto.endPeriod ??
        leaveRequest.endPeriod;

      if (isSubmittedRequest) {
        await this.ensureModificationAllowed(startDate);
      }

      const dates = await this.validateAndCalculateDates(
        startDate,
        endDate,
        startPeriod,
        endPeriod,
        leaveType.allowsHalfDays,
      );

      if (isSubmittedRequest) {
        const notice = await this.evaluateSubmissionNoticeWithSettings(
          startDate,
          endDate,
          dates.calendarDuration,
        );

        this.validateSubmissionTiming(notice);
      }

      leaveRequest.leaveTypeId = leaveType.id;
      leaveRequest.leaveType = leaveType;
      leaveRequest.startDate = startDate;
      leaveRequest.endDate = endDate;
      leaveRequest.startPeriod = startPeriod;
      leaveRequest.endPeriod = endPeriod;
      leaveRequest.calendarDuration = dates.calendarDuration;
      leaveRequest.deductedDays = dates.deductedDays;
      leaveRequest.modificationDeadline =
        await this.calculateModificationDeadline(startDate);

      if (updateLeaveRequestDto.comment !== undefined) {
        leaveRequest.comment =
          updateLeaveRequestDto.comment.trim() || null;
      }

      let releasedReservation:
        | Awaited<
            ReturnType<
              LeaveBalancesService['releasePaidLeaveReservationForRequest']
            >
          >
        | null = null;

      let derogationPreparation:
        | Awaited<
            ReturnType<
              DerogationsService['prepareForRequestResubmission']
            >
          >
        | null = null;

      if (isSubmittedRequest) {
        await this.ensureNoPersonalOverlap(
          manager,
          leaveRequest,
        );

        if (oldLeaveType.deductsPaidLeaveBalance) {
          releasedReservation =
            await this.leaveBalancesService.releasePaidLeaveReservationForRequest(
              manager,
              {
                employeeId: leaveRequest.employeeId,
                leaveRequestId: leaveRequest.id,
                actorId: authenticatedUser.id,
                reason:
                  'Libération de la réservation après modification de la demande avant décision.',
              },
            );
        }

        derogationPreparation =
          await this.derogationsService.prepareForRequestResubmission(
            manager,
            {
              leaveRequest,
            },
          );

        leaveRequest.status = LeaveRequestStatus.BROUILLON;
        leaveRequest.submittedAt = null;
        leaveRequest.employeeSignatureType = null;
        leaveRequest.employeeSignatureData = null;
        leaveRequest.employeeSignedAt = null;
        leaveRequest.realBalanceBefore = null;
        leaveRequest.potentialBalanceBefore = null;
        leaveRequest.realBalanceAfter = null;
        leaveRequest.finalDeciderId = null;
        leaveRequest.finalDeciderRole = null;
        leaveRequest.decisionAt = null;
        leaveRequest.refusalComment = null;
        leaveRequest.validatorSignatureType = null;
        leaveRequest.validatorSignatureData = null;
        leaveRequest.validatorSignedAt = null;
        leaveRequest.rhConfirmedDirectorAgreement = false;
        leaveRequest.rhDirectorAgreementConfirmedAt = null;
        leaveRequest.lockedAt = null;
      }

      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(
        leaveRequest,
      );

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: isSubmittedRequest
            ? AuditAction.DEMANDE_MODIFIEE_AVANT_DECISION
            : AuditAction.BROUILLON_MODIFIE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus,
          newStatus: leaveRequest.status,
          comment: null,
          metadata: {
            previousVersion: oldSnapshot.version,
            version: leaveRequest.version,
            previousRequest: oldSnapshot,
            updatedRequest: {
              leaveTypeId: leaveRequest.leaveTypeId,
              startDate: leaveRequest.startDate,
              endDate: leaveRequest.endDate,
              startPeriod: leaveRequest.startPeriod,
              endPeriod: leaveRequest.endPeriod,
              calendarDuration:
                leaveRequest.calendarDuration,
              deductedDays: leaveRequest.deductedDays,
              comment: leaveRequest.comment,
            },
            signatureInvalidated: isSubmittedRequest,
            reservationReleasedDays:
              releasedReservation?.releasedDays ?? 0,
            releasedReservations:
              releasedReservation?.releases ?? [],
            derogationPreparation,
            requiresNewSignature: isSubmittedRequest,
          },
        },
        manager,
      );
    });

    return this.findOwnedRequest(id, requestEmployeeId);
  }

  async submit(
    id: number,
    authenticatedUser: AuthenticatedUser,
    submitLeaveRequestDto: SubmitLeaveRequestDto,
  ): Promise<LeaveRequest> {
    let requestEmployeeId = authenticatedUser.id;

    await this.dataSource.transaction(async (manager) => {
      const leaveRequest = await this.findRequestForUpdateLocked(
        manager,
        id,
      );

      requestEmployeeId = leaveRequest.employeeId;

      if (leaveRequest.employeeId !== authenticatedUser.id) {
        throw new ForbiddenException(
          'Seul le collaborateur concerné peut soumettre et signer sa demande de congé.',
        );
      }

      this.ensureDraft(leaveRequest);

      const leaveType = await manager
        .getRepository(LeaveType)
        .findOneBy({ id: leaveRequest.leaveTypeId });

      if (!leaveType) {
        throw new NotFoundException(
          `Le type de congé ${leaveRequest.leaveTypeId} est introuvable.`,
        );
      }

      this.validateLeaveType(leaveType);

      if (
        leaveType.documentRequired &&
        !leaveType.documentCanBeAddedLater
      ) {
        const hasActiveDocument =
          await this.hasActiveRequiredDocument(
            manager,
            leaveRequest.id,
          );

        if (!hasActiveDocument) {
          throw new BadRequestException(
            'Le justificatif obligatoire doit être ajouté avant la soumission de cette demande.',
          );
        }
      }

      const dates = await this.validateAndCalculateDates(
        leaveRequest.startDate,
        leaveRequest.endDate,
        leaveRequest.startPeriod,
        leaveRequest.endPeriod,
        leaveType.allowsHalfDays,
      );

      leaveRequest.calendarDuration = dates.calendarDuration;
      leaveRequest.deductedDays = dates.deductedDays;

      const notice = await this.evaluateSubmissionNoticeWithSettings(
        leaveRequest.startDate,
        leaveRequest.endDate,
        dates.calendarDuration,
      );

      this.validateSubmissionTiming(notice);

      await this.ensureNoPersonalOverlap(manager, leaveRequest);

      const signatureData = this.validateAndNormalizeSignature(
        submitLeaveRequestDto.signatureType,
        submitLeaveRequestDto.signatureData,
      );

      let derogationId: number | null = null;

      if (!notice.isNoticeCompliant) {
        const derogation =
          await this.derogationsService.consumeGrantedDerogation(
            manager,
            {
              leaveRequest,
              actorId: authenticatedUser.id,
            },
          );

        derogationId = derogation.id;
      }

      let reservation: PaidLeaveReservationSummary | null = null;

      if (leaveType.deductsPaidLeaveBalance) {
        reservation =
          await this.leaveBalancesService.reservePaidLeaveForRequest(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              days: leaveRequest.deductedDays,
              actorId: authenticatedUser.id,
              reason:
                'Réservation lors de la soumission de la demande de congés.',
            },
          );
      }

      const submittedAt = new Date();
      const oldStatus = leaveRequest.status;

      leaveRequest.status = LeaveRequestStatus.EN_ATTENTE_VALIDATION;
      leaveRequest.submittedAt = submittedAt;
      leaveRequest.employeeSignatureType =
        submitLeaveRequestDto.signatureType;
      leaveRequest.employeeSignatureData = signatureData;
      leaveRequest.employeeSignedAt = submittedAt;
      leaveRequest.realBalanceBefore =
        reservation?.realBalanceBefore ?? null;
      leaveRequest.potentialBalanceBefore =
        reservation?.potentialBalanceBefore ?? null;
      leaveRequest.realBalanceAfter = null;
      leaveRequest.finalDeciderId = null;
      leaveRequest.finalDeciderRole = null;
      leaveRequest.decisionAt = null;
      leaveRequest.refusalComment = null;
      leaveRequest.validatorSignatureType = null;
      leaveRequest.validatorSignatureData = null;
      leaveRequest.validatorSignedAt = null;
      leaveRequest.rhConfirmedDirectorAgreement = false;
      leaveRequest.rhDirectorAgreementConfirmedAt = null;
      leaveRequest.lockedAt = null;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: AuditAction.DEMANDE_SOUMISE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus,
          newStatus: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
          comment: null,
          metadata: {
            daysBeforeStart: notice.daysBeforeStart,
            requiredNoticeDays: notice.requiredNoticeDays,
            isLongLeave: notice.isLongLeave,
            overlapsSummerPeriod: notice.overlapsSummerPeriod,
            derogationId,
            deductedDays: leaveRequest.deductedDays,
            potentialBalanceAfter:
              reservation?.potentialBalanceAfter ?? null,
            reservations: reservation?.reservations ?? [],
          },
        },
        manager,
      );
    });

    const submittedRequest = await this.findOwnedRequest(
      id,
      requestEmployeeId,
    );
    await this.notificationsService.notifyLeaveRequestSubmitted(
      submittedRequest,
    );

    return submittedRequest;
  }

  async findPendingForDecision(
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest[]> {
    const requests = await this.leaveRequestRepository.find({
      where: {
        status: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
      },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
        finalDecider: true,
      },
      order: {
        submittedAt: 'ASC',
        id: 'ASC',
      },
    });

    if (
      authenticatedUser.role === UserRole.DIRECTEUR ||
      authenticatedUser.role === UserRole.RH
    ) {
      return requests;
    }

    if (
      authenticatedUser.role ===
      UserRole.RESPONSABLE_SERVICE
    ) {
      return requests.filter(
        (leaveRequest) =>
          leaveRequest.service.validationMode ===
            ValidationMode.RESPONSABLE_PUIS_RELAIS &&
          leaveRequest.service.primaryManagerId ===
            authenticatedUser.id &&
          leaveRequest.employeeId !== authenticatedUser.id &&
          ![
            UserRole.RESPONSABLE_SERVICE,
            UserRole.RH,
            UserRole.DIRECTEUR,
          ].includes(leaveRequest.employee.role),
      );
    }

    return [];
  }

  async findRequestForDecision(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
        finalDecider: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    if (
      authenticatedUser.role === UserRole.DIRECTEUR ||
      authenticatedUser.role === UserRole.RH
    ) {
      return leaveRequest;
    }

    if (
      authenticatedUser.role ===
        UserRole.RESPONSABLE_SERVICE &&
      leaveRequest.service.validationMode ===
        ValidationMode.RESPONSABLE_PUIS_RELAIS &&
      leaveRequest.service.primaryManagerId ===
        authenticatedUser.id &&
      leaveRequest.employeeId !== authenticatedUser.id &&
      ![
        UserRole.RESPONSABLE_SERVICE,
        UserRole.RH,
        UserRole.DIRECTEUR,
      ].includes(leaveRequest.employee.role)
    ) {
      return leaveRequest;
    }

    throw new ForbiddenException(
      'Cette demande ne relève pas de votre périmètre.',
    );
  }

  async getServiceAvailability(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ) {
    const leaveRequest = await this.findRequestForDecision(
      id,
      authenticatedUser,
    );

    return this.serviceAvailabilityService.analyzeLeaveRequest(
      leaveRequest,
    );
  }

  async validateRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: ValidateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    await this.dataSource.transaction(async (manager) => {
      const leaveRequest =
        await this.findRequestForDecisionUpdate(manager, id);

      this.ensureRequestCanReceiveDecision(leaveRequest);
      await this.ensureRequiredDocumentsAccepted(
        manager,
        leaveRequest,
      );

      const access = await this.determineDecisionAccess(
        manager,
        leaveRequest,
        authenticatedUser,
        dto.emergencyTakeover ?? false,
        dto.takeoverReason,
      );

      const availability =
        await this.serviceAvailabilityService.analyzeLeaveRequest(
          leaveRequest,
          manager,
        );
      const minimumPresenceJustification =
        dto.minimumPresenceJustification?.trim() || null;

      if (
        availability.minimumPresenceBreached &&
        !minimumPresenceJustification
      ) {
        throw new BadRequestException(
          `La validation ferait passer la présence du service sous le minimum de ${availability.minimumPresence} personne(s). Une justification est obligatoire.`,
        );
      }

      if (
        authenticatedUser.role === UserRole.RH &&
        dto.rhConfirmedDirectorAgreement !== true
      ) {
        throw new BadRequestException(
          'La RH doit confirmer avoir obtenu l’accord du Directeur avant de valider.',
        );
      }

      const validatorSignatureData =
        this.validateAndNormalizeSignature(
          dto.signatureType,
          dto.signatureData,
        );

      let realBalanceAfter: number | null = null;

      if (leaveRequest.leaveType.deductsPaidLeaveBalance) {
        const balanceResult =
          await this.leaveBalancesService.finalizePaidLeaveReservation(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              actorId: authenticatedUser.id,
              expectedDays: leaveRequest.deductedDays,
              decision: 'VALIDATE',
            },
          );

        realBalanceAfter = balanceResult.realBalanceAfter;
      }

      const decisionAt = new Date();
      const oldStatus = leaveRequest.status;

      leaveRequest.status = LeaveRequestStatus.VALIDEE;
      leaveRequest.finalDeciderId = authenticatedUser.id;
      leaveRequest.finalDeciderRole = authenticatedUser.role;
      leaveRequest.decisionAt = decisionAt;
      leaveRequest.refusalComment = null;
      leaveRequest.validatorSignatureType = dto.signatureType;
      leaveRequest.validatorSignatureData =
        validatorSignatureData;
      leaveRequest.validatorSignedAt = decisionAt;
      leaveRequest.rhConfirmedDirectorAgreement =
        authenticatedUser.role === UserRole.RH;
      leaveRequest.rhDirectorAgreementConfirmedAt =
        authenticatedUser.role === UserRole.RH
          ? decisionAt
          : null;
      leaveRequest.realBalanceAfter = realBalanceAfter;
      leaveRequest.isUrgent = access.kind === 'URGENCE';
      leaveRequest.urgentReason =
        access.kind === 'URGENCE' ? access.reason : null;
      leaveRequest.lockedAt = decisionAt;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.saveDecisionAccessHistory(
        manager,
        leaveRequest,
        authenticatedUser,
        access,
      );

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: AuditAction.DEMANDE_VALIDEE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus,
          newStatus: LeaveRequestStatus.VALIDEE,
          comment: null,
          metadata: {
            finalDeciderRole: authenticatedUser.role,
            accessKind: access.kind,
            realBalanceBefore: leaveRequest.realBalanceBefore,
            realBalanceAfter,
            rhConfirmedDirectorAgreement:
              leaveRequest.rhConfirmedDirectorAgreement,
            serviceAvailability: availability,
            minimumPresenceJustification,
          },
        },
        manager,
      );
    });

    const validatedRequest = await this.findRequestForDecision(
      id,
      authenticatedUser,
    );
    await this.notificationsService.notifyLeaveRequestDecision(
      validatedRequest,
      'VALIDEE',
      authenticatedUser.id,
    );

    await this.presenceService.refreshUserStatus(
      validatedRequest.employeeId,
    );

    try {
      await this.documentPdfService.ensureValidationPdf(
        id,
        authenticatedUser.id,
      );
    } catch (error) {
      this.logger.error(
        `La demande ${id} a été validée, mais son PDF n’a pas pu être généré immédiatement. Le téléchargement relancera automatiquement la génération.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return validatedRequest;
  }

  async refuseRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: RefuseLeaveRequestDto,
  ): Promise<LeaveRequest> {
    await this.dataSource.transaction(async (manager) => {
      const leaveRequest =
        await this.findRequestForDecisionUpdate(manager, id);

      this.ensureRequestCanReceiveDecision(leaveRequest);
      await this.ensureRequiredDocumentsAccepted(
        manager,
        leaveRequest,
      );

      const access = await this.determineDecisionAccess(
        manager,
        leaveRequest,
        authenticatedUser,
        dto.emergencyTakeover ?? false,
        dto.takeoverReason,
      );

      let realBalanceAfter: number | null = null;

      if (leaveRequest.leaveType.deductsPaidLeaveBalance) {
        const balanceResult =
          await this.leaveBalancesService.finalizePaidLeaveReservation(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              actorId: authenticatedUser.id,
              expectedDays: leaveRequest.deductedDays,
              decision: 'REFUSE',
            },
          );

        realBalanceAfter = balanceResult.realBalanceAfter;
      }

      const decisionAt = new Date();
      const oldStatus = leaveRequest.status;
      const refusalComment = dto.comment?.trim() || null;

      leaveRequest.status = LeaveRequestStatus.REFUSEE;
      leaveRequest.finalDeciderId = authenticatedUser.id;
      leaveRequest.finalDeciderRole = authenticatedUser.role;
      leaveRequest.decisionAt = decisionAt;
      leaveRequest.refusalComment = refusalComment;
      leaveRequest.validatorSignatureType = null;
      leaveRequest.validatorSignatureData = null;
      leaveRequest.validatorSignedAt = null;
      leaveRequest.rhConfirmedDirectorAgreement = false;
      leaveRequest.rhDirectorAgreementConfirmedAt = null;
      leaveRequest.realBalanceAfter = realBalanceAfter;
      leaveRequest.isUrgent = access.kind === 'URGENCE';
      leaveRequest.urgentReason =
        access.kind === 'URGENCE' ? access.reason : null;
      leaveRequest.lockedAt = decisionAt;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.saveDecisionAccessHistory(
        manager,
        leaveRequest,
        authenticatedUser,
        access,
      );

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: AuditAction.DEMANDE_REFUSEE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus,
          newStatus: LeaveRequestStatus.REFUSEE,
          comment: refusalComment,
          metadata: {
            finalDeciderRole: authenticatedUser.role,
            accessKind: access.kind,
            realBalanceBefore: leaveRequest.realBalanceBefore,
            realBalanceAfter,
          },
        },
        manager,
      );
    });

    const refusedRequest = await this.findRequestForDecision(
      id,
      authenticatedUser,
    );
    await this.notificationsService.notifyLeaveRequestDecision(
      refusedRequest,
      'REFUSEE',
      authenticatedUser.id,
    );

    return refusedRequest;
  }

  async cancelBeforeDecision(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: CancelLeaveRequestDto,
  ): Promise<LeaveRequest> {
    let requestEmployeeId = authenticatedUser.id;

    await this.dataSource.transaction(async (manager) => {
      const leaveRequest = await this.findRequestForUpdateLocked(
        manager,
        id,
      );

      requestEmployeeId = leaveRequest.employeeId;

      if (leaveRequest.employeeId !== authenticatedUser.id) {
        throw new ForbiddenException(
          'Seul le collaborateur concerné peut annuler sa demande avant décision.',
        );
      }

      if (
        ![
          LeaveRequestStatus.BROUILLON,
          LeaveRequestStatus.EN_ATTENTE_VALIDATION,
        ].includes(leaveRequest.status)
      ) {
        throw new BadRequestException(
          'Seule une demande en brouillon ou en attente de validation peut être annulée avant décision.',
        );
      }

      const oldStatus = leaveRequest.status;
      const reason = dto.reason?.trim() || null;
      let releasedReservation: Awaited<
        ReturnType<
          LeaveBalancesService['releasePaidLeaveReservationForRequest']
        >
      > | null = null;

      if (
        oldStatus === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
        leaveRequest.leaveType.deductsPaidLeaveBalance
      ) {
        releasedReservation =
          await this.leaveBalancesService.releasePaidLeaveReservationForRequest(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              actorId: authenticatedUser.id,
              reason:
                'Libération de la réservation après annulation de la demande avant décision.',
            },
          );

        if (
          releasedReservation.releasedDays !==
          leaveRequest.deductedDays
        ) {
          throw new ConflictException(
            'La réservation active du solde ne correspond pas au nombre de jours de la demande.',
          );
        }
      }

      const derogation =
        await this.derogationsService.expireForCancelledRequest(
          manager,
          leaveRequest.id,
        );

      const cancelledAt = new Date();

      leaveRequest.status = LeaveRequestStatus.ANNULEE;
      leaveRequest.lockedAt = cancelledAt;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: AuditAction.DEMANDE_ANNULEE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus,
          newStatus: LeaveRequestStatus.ANNULEE,
          comment: reason,
          metadata: {
            cancelledAt,
            submittedRequest:
              oldStatus ===
              LeaveRequestStatus.EN_ATTENTE_VALIDATION,
            releasedReservationDays:
              releasedReservation?.releasedDays ?? 0,
            releasedReservations:
              releasedReservation?.releases ?? [],
            derogation,
          },
        },
        manager,
      );
    });

    return this.findOwnedRequest(id, requestEmployeeId);
  }

  async requestCancellationAfterValidation(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: RequestCancellationAfterValidationDto,
  ): Promise<LeaveRequest> {
    await this.dataSource.transaction(async (manager) => {
      const leaveRequest =
        await this.findRequestForDecisionUpdate(manager, id);

      const isOwner =
        leaveRequest.employeeId === authenticatedUser.id;
      const isRh = authenticatedUser.role === UserRole.RH;

      if (!isOwner && !isRh) {
        throw new ForbiddenException(
          'Seul le collaborateur concerné ou la RH peut demander cette annulation.',
        );
      }

      if (leaveRequest.status !== LeaveRequestStatus.VALIDEE) {
        throw new BadRequestException(
          'Seule une demande validée peut faire l’objet d’une annulation après validation.',
        );
      }

      const requestedAt = new Date();
      const reason = dto.reason.trim();

      leaveRequest.cancellationRequestedById =
        authenticatedUser.id;
      leaveRequest.cancellationReason = reason;
      leaveRequest.employeeCancellationConsent = isOwner
        ? true
        : null;
      leaveRequest.employeeCancellationResponseAt = isOwner
        ? requestedAt
        : null;
      leaveRequest.cancelledAt = null;
      leaveRequest.status =
        LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action:
            AuditAction.ANNULATION_APRES_VALIDATION_DEMANDEE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus: LeaveRequestStatus.VALIDEE,
          newStatus:
            LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
          comment: reason,
          metadata: {
            initiatedByRole: authenticatedUser.role,
            employeeConsent: isOwner ? true : null,
          },
        },
        manager,
      );
    });

    return this.findCancellationRequest(id, authenticatedUser);
  }

  async respondToCancellation(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: RespondCancellationDto,
  ): Promise<LeaveRequest> {
    await this.dataSource.transaction(async (manager) => {
      const leaveRequest =
        await this.findRequestForDecisionUpdate(manager, id);

      if (leaveRequest.employeeId !== authenticatedUser.id) {
        throw new ForbiddenException(
          'Seul le collaborateur concerné peut répondre à cette demande d’annulation.',
        );
      }

      if (
        leaveRequest.status !==
        LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD
      ) {
        throw new BadRequestException(
          'Cette demande n’est pas en attente d’un accord d’annulation.',
        );
      }

      if (leaveRequest.employeeCancellationConsent !== null) {
        throw new ConflictException(
          'Une réponse a déjà été enregistrée pour cette demande d’annulation.',
        );
      }

      const respondedAt = new Date();
      leaveRequest.employeeCancellationConsent = dto.consent;
      leaveRequest.employeeCancellationResponseAt = respondedAt;

      if (!dto.consent) {
        leaveRequest.status = LeaveRequestStatus.VALIDEE;
      }

      leaveRequest.version += 1;
      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action: dto.consent
            ? AuditAction.ANNULATION_ACCEPTEE_PAR_COLLABORATEUR
            : AuditAction.ANNULATION_REFUSEE_PAR_COLLABORATEUR,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus:
            LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
          newStatus: dto.consent
            ? LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD
            : LeaveRequestStatus.VALIDEE,
          comment: null,
          metadata: {
            consent: dto.consent,
            respondedAt,
          },
        },
        manager,
      );
    });

    return this.findCancellationRequest(id, authenticatedUser);
  }

  async completeCancellationAfterValidation(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    if (authenticatedUser.role !== UserRole.RH) {
      throw new ForbiddenException(
        'Seule la RH peut finaliser une annulation après validation.',
      );
    }

    let requestEmployeeId = authenticatedUser.id;

    await this.dataSource.transaction(async (manager) => {
      const leaveRequest =
        await this.findRequestForDecisionUpdate(manager, id);

      requestEmployeeId = leaveRequest.employeeId;

      if (
        leaveRequest.status !==
        LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD
      ) {
        throw new BadRequestException(
          'Cette demande n’est pas en cours d’annulation.',
        );
      }

      if (leaveRequest.employeeCancellationConsent !== true) {
        throw new BadRequestException(
          'L’accord du collaborateur est obligatoire avant la finalisation.',
        );
      }

      let realBalanceAfter = leaveRequest.realBalanceAfter;
      let recreditedDays = 0;

      if (leaveRequest.leaveType.deductsPaidLeaveBalance) {
        const recredit =
          await this.leaveBalancesService.recreditPaidLeaveForCancelledRequest(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              actorId: authenticatedUser.id,
              expectedDays: leaveRequest.deductedDays,
            },
          );

        realBalanceAfter = recredit.realBalanceAfter;
        recreditedDays = recredit.recreditedDays;
      }

      const cancelledAt = new Date();
      leaveRequest.status =
        LeaveRequestStatus.ANNULEE_APRES_VALIDATION;
      leaveRequest.cancelledAt = cancelledAt;
      leaveRequest.realBalanceAfter = realBalanceAfter;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await this.auditService.recordStatusChange(
        {
          actorId: authenticatedUser.id,
          action:
            AuditAction.ANNULATION_APRES_VALIDATION_TERMINEE,
          resourceType: 'LEAVE_REQUESTS',
          resourceId: leaveRequest.id,
          oldStatus:
            LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
          newStatus:
            LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
          comment: leaveRequest.cancellationReason,
          metadata: {
            cancelledAt,
            recreditedDays,
            realBalanceAfter,
          },
        },
        manager,
      );
    });

    try {
      await this.documentPdfService.ensureCancellationPdf(
        id,
        authenticatedUser.id,
      );
    } catch (error) {
      this.logger.error(
        `La demande ${id} a été annulée, mais son PDF d’annulation n’a pas pu être généré immédiatement.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    await this.presenceService.refreshUserStatus(requestEmployeeId);

    return this.findCancellationRequest(id, authenticatedUser);
  }

  async findCancellationRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
        finalDecider: true,
        cancellationRequestedBy: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    const canRead =
      leaveRequest.employeeId === authenticatedUser.id ||
      authenticatedUser.role === UserRole.RH ||
      authenticatedUser.role === UserRole.DIRECTEUR ||
      (authenticatedUser.role ===
        UserRole.RESPONSABLE_SERVICE &&
        authenticatedUser.serviceId === leaveRequest.serviceId);

    if (!canRead) {
      throw new ForbiddenException(
        'Vous ne pouvez pas consulter cette annulation.',
      );
    }

    return leaveRequest;
  }

  async deleteDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    const isOwner = leaveRequest.employeeId === authenticatedUser.id;
    const isCreator = leaveRequest.createdById === authenticatedUser.id;
    if (!isOwner && !isCreator) {
      throw new ForbiddenException(
        'Vous ne pouvez pas supprimer ce brouillon.',
      );
    }

    this.ensureDraft(leaveRequest);

    await this.leaveRequestRepository.remove(leaveRequest);
  }

  private async hasActiveRequiredDocument(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<boolean> {
    const count = await manager.getRepository(Document).count({
      where: {
        leaveRequestId,
        status: In([
          DocumentStatus.EN_ATTENTE,
          DocumentStatus.ACCEPTE,
          DocumentStatus.REJETE,
        ]),
      },
    });

    return count > 0;
  }

  private async ensureRequiredDocumentsAccepted(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
  ): Promise<void> {
    if (!leaveRequest.leaveType.documentRequired) {
      return;
    }

    const documents = await manager.getRepository(Document).find({
      where: {
        leaveRequestId: leaveRequest.id,
        status: In([
          DocumentStatus.EN_ATTENTE,
          DocumentStatus.ACCEPTE,
          DocumentStatus.REJETE,
        ]),
      },
    });

    if (documents.length === 0) {
      throw new BadRequestException(
        'Le justificatif obligatoire doit être fourni avant toute décision.',
      );
    }

    if (
      documents.some(
        (document) =>
          document.status !== DocumentStatus.ACCEPTE,
      )
    ) {
      throw new BadRequestException(
        'Tous les justificatifs actifs doivent être acceptés par la RH avant toute décision.',
      );
    }
  }

  private async findRequestForDecisionUpdate(
    manager: EntityManager,
    id: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('leaveRequest')
      .setLock('pessimistic_write')
      .leftJoinAndSelect('leaveRequest.employee', 'employee')
      .leftJoinAndSelect('leaveRequest.createdBy', 'createdBy')
      .leftJoinAndSelect('leaveRequest.leaveType', 'leaveType')
      .leftJoinAndSelect('leaveRequest.service', 'service')
      .leftJoinAndSelect(
        'leaveRequest.finalDecider',
        'finalDecider',
      )
      .where('leaveRequest.id = :id', { id })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private ensureRequestCanReceiveDecision(
    leaveRequest: LeaveRequest,
  ): void {
    if (
      leaveRequest.status !==
        LeaveRequestStatus.EN_ATTENTE_VALIDATION ||
      leaveRequest.finalDeciderId !== null ||
      leaveRequest.lockedAt !== null
    ) {
      const decisionMessage = leaveRequest.finalDecider
        ? ` Cette demande a déjà été traitée par ${leaveRequest.finalDecider.prenom} ${leaveRequest.finalDecider.nom}.`
        : '';

      throw new ConflictException(
        `Cette demande ne peut plus recevoir de décision.${decisionMessage}`,
      );
    }
  }

  private async determineDecisionAccess(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    emergencyTakeover: boolean,
    takeoverReasonValue?: string,
  ): Promise<DecisionAccess> {
    if (leaveRequest.employeeId === authenticatedUser.id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas traiter votre propre demande.',
      );
    }

    if (leaveRequest.employee.role === UserRole.RH) {
      if (authenticatedUser.role !== UserRole.DIRECTEUR) {
        throw new ForbiddenException(
          'Une demande déposée par la RH doit être traitée par le Directeur.',
        );
      }

      return {
        kind: 'DIRECTEUR_SEUL',
        reason: null,
      };
    }

    if (
      leaveRequest.employee.role ===
      UserRole.RESPONSABLE_SERVICE
    ) {
      if (
        authenticatedUser.role !== UserRole.DIRECTEUR &&
        authenticatedUser.role !== UserRole.RH
      ) {
        throw new ForbiddenException(
          'La demande d’un Responsable de service doit être traitée par le Directeur ou la RH.',
        );
      }

      return {
        kind: 'DIRECTEUR_RH',
        reason: null,
      };
    }

    if (leaveRequest.service.serviceType === ServiceType.EXTERNE) {
      if (
        authenticatedUser.role !== UserRole.DIRECTEUR &&
        authenticatedUser.role !== UserRole.RH
      ) {
        throw new ForbiddenException(
          'La demande d’un collaborateur externe doit être traitée par le Directeur ou la RH.',
        );
      }

      return {
        kind: 'DIRECTEUR_RH',
        reason: null,
      };
    }

    switch (leaveRequest.service.validationMode) {
      case ValidationMode.DIRECTEUR_ET_RH:
        if (
          authenticatedUser.role !== UserRole.DIRECTEUR &&
          authenticatedUser.role !== UserRole.RH
        ) {
          throw new ForbiddenException(
            'Cette demande doit être traitée par le Directeur ou la RH.',
          );
        }

        return {
          kind: 'DIRECTEUR_RH',
          reason: null,
        };

      case ValidationMode.DIRECTEUR_SEUL:
        if (authenticatedUser.role !== UserRole.DIRECTEUR) {
          throw new ForbiddenException(
            'Cette demande doit être traitée par le Directeur.',
          );
        }

        return {
          kind: 'DIRECTEUR_SEUL',
          reason: null,
        };

      case ValidationMode.SANS_VALIDATION:
        throw new BadRequestException(
          'Ce service est configuré sans circuit de validation.',
        );

      case ValidationMode.RESPONSABLE_PUIS_RELAIS:
        return this.determineManagerFirstAccess(
          manager,
          leaveRequest,
          authenticatedUser,
          emergencyTakeover,
          takeoverReasonValue,
        );

      default:
        throw new BadRequestException(
          'Le circuit de validation du service est invalide.',
        );
    }
  }

  private async determineManagerFirstAccess(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    emergencyTakeover: boolean,
    takeoverReasonValue?: string,
  ): Promise<DecisionAccess> {
    if (
      authenticatedUser.role ===
        UserRole.RESPONSABLE_SERVICE &&
      leaveRequest.service.primaryManagerId ===
        authenticatedUser.id
    ) {
      return {
        kind: 'RESPONSABLE_PRINCIPAL',
        reason: null,
      };
    }

    if (
      authenticatedUser.role !== UserRole.DIRECTEUR &&
      authenticatedUser.role !== UserRole.RH
    ) {
      throw new ForbiddenException(
        'Cette demande relève du Responsable principal du service.',
      );
    }

    const primaryManager =
      leaveRequest.service.primaryManagerId === null
        ? null
        : await manager.getRepository(User).findOneBy({
            id: leaveRequest.service.primaryManagerId,
          });

    const managerUnavailable =
      !primaryManager ||
      !primaryManager.isActive ||
      primaryManager.role !== UserRole.RESPONSABLE_SERVICE ||
      primaryManager.serviceId !== leaveRequest.serviceId ||
      (await this.presenceService.computeStatus(
        primaryManager.id,
        undefined,
        manager,
      )) !== PresenceStatus.PRESENT;

    if (managerUnavailable) {
      return {
        kind: 'RELAIS',
        reason:
          'Le Responsable principal est absent ou indisponible.',
      };
    }

    const takeoverAt = new Date(
      (leaveRequest.submittedAt ?? leaveRequest.createdAt).getTime() +
        leaveRequest.service.takeoverDelayDays *
          24 *
          60 *
          60 *
          1000,
    );

    if (Date.now() >= takeoverAt.getTime()) {
      return {
        kind: 'RELAIS',
        reason: `Le délai de ${leaveRequest.service.takeoverDelayDays} jour(s) calendaires accordé au Responsable est expiré.`,
      };
    }

    if (emergencyTakeover) {
      const takeoverReason = takeoverReasonValue?.trim();

      if (!takeoverReason) {
        throw new BadRequestException(
          'Le motif de l’intervention urgente est obligatoire.',
        );
      }

      return {
        kind: 'URGENCE',
        reason: takeoverReason,
      };
    }

    throw new ForbiddenException(
      `Le Responsable principal reste prioritaire jusqu’au ${takeoverAt.toISOString()}. Une intervention anticipée du Directeur ou de la RH doit être déclarée comme urgente et motivée.`,
    );
  }

  private async saveDecisionAccessHistory(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    access: DecisionAccess,
  ): Promise<void> {
    if (access.kind !== 'RELAIS' && access.kind !== 'URGENCE') {
      return;
    }

    await this.auditService.recordStatusChange(
      {
        actorId: authenticatedUser.id,
        action:
          access.kind === 'RELAIS'
            ? AuditAction.REPRISE_PAR_RELAIS
            : AuditAction.INTERVENTION_URGENCE,
        resourceType: 'LEAVE_REQUESTS',
        resourceId: leaveRequest.id,
        oldStatus: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
        newStatus: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
        comment: access.reason,
        metadata: {
          actorRole: authenticatedUser.role,
          primaryManagerId:
            leaveRequest.service.primaryManagerId,
          takeoverDelayDays:
            leaveRequest.service.takeoverDelayDays,
        },
      },
      manager,
    );
  }

  private async findOwnedRequest(
    id: number,
    employeeId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: {
        id,
        employeeId,
      },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private async findRequestForUpdateLocked(
    manager: EntityManager,
    id: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('leaveRequest')
      .setLock('pessimistic_write')
      .leftJoinAndSelect(
        'leaveRequest.employee',
        'employee',
      )
      .leftJoinAndSelect(
        'leaveRequest.createdBy',
        'createdBy',
      )
      .leftJoinAndSelect(
        'leaveRequest.leaveType',
        'leaveType',
      )
      .leftJoinAndSelect(
        'leaveRequest.service',
        'service',
      )
      .addSelect('leaveRequest.employeeSignatureData')
      .where('leaveRequest.id = :id', { id })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private validateLeaveType(leaveType: LeaveType): void {
    if (!leaveType.isActive) {
      throw new BadRequestException(
        'Le type de congé sélectionné est désactivé.',
      );
    }

    if (leaveType.category !== LeaveTypeCategory.DEMANDE_CONGE) {
      throw new BadRequestException(
        'Le type sélectionné ne correspond pas à une demande de congé.',
      );
    }

    if (!leaveType.employeeCanCreate || leaveType.rhOnly) {
      throw new ForbiddenException(
        'Ce type ne peut pas être demandé directement par un collaborateur.',
      );
    }

    if (!leaveType.allowsDays && !leaveType.allowsHalfDays) {
      throw new BadRequestException(
        'Ce type ne peut pas être saisi en jours ou en demi-journées.',
      );
    }

    if (!leaveType.requiresValidation) {
      throw new BadRequestException(
        'Ce type de congé doit être configuré avec une validation.',
      );
    }
  }

  private ensureDraft(leaveRequest: LeaveRequest): void {
    if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
      throw new BadRequestException(
        'Seule une demande au statut BROUILLON peut être modifiée, supprimée ou soumise.',
      );
    }
  }

  private async ensureNoPersonalOverlap(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
  ): Promise<void> {
    const ignoredStatuses = [
      LeaveRequestStatus.REFUSEE,
      LeaveRequestStatus.ANNULEE,
      LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
      LeaveRequestStatus.EXPIREE_NON_VALIDEE,
    ];

    const overlappingRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('otherRequest')
      .where('otherRequest.employeeId = :employeeId', {
        employeeId: leaveRequest.employeeId,
      })
      .andWhere('otherRequest.id <> :requestId', {
        requestId: leaveRequest.id,
      })
      .andWhere('otherRequest.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .andWhere('otherRequest.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('otherRequest.status NOT IN (:...ignoredStatuses)', {
        ignoredStatuses,
      })
      .orderBy('otherRequest.startDate', 'ASC')
      .getOne();

    if (overlappingRequest) {
      throw new BadRequestException(
        `Cette demande chevauche votre demande n°${overlappingRequest.id} du ${overlappingRequest.startDate} au ${overlappingRequest.endDate}.`,
      );
    }

    const overlappingAbsence = await manager
      .getRepository(AbsenceDeclaration)
      .createQueryBuilder('absence')
      .where('absence.employeeId = :employeeId', {
        employeeId: leaveRequest.employeeId,
      })
      .andWhere('absence.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .andWhere('absence.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('absence.status <> :cancelledStatus', {
        cancelledStatus: AbsenceDeclarationStatus.ANNULEE,
      })
      .orderBy('absence.startDate', 'ASC')
      .getOne();

    if (overlappingAbsence) {
      throw new BadRequestException(
        `Cette demande chevauche votre déclaration d’absence n°${overlappingAbsence.id} du ${overlappingAbsence.startDate} au ${overlappingAbsence.endDate}.`,
      );
    }
  }

  private validateSubmissionTiming(
    notice: SubmissionNoticeInfo,
  ): void {
    if (notice.daysBeforeStart < 0) {
      throw new BadRequestException(
        'Une demande ne peut pas être soumise après sa date de début.',
      );
    }

    if (notice.daysBeforeStart < 3) {
      throw new BadRequestException(
        'La demande ne peut plus être soumise à partir de J-2. Le départ doit être prévu au moins trois jours calendaires à l’avance.',
      );
    }

    if (
      !notice.isNoticeCompliant &&
      !notice.isDerogationWindow
    ) {
      throw new BadRequestException(
        `Cette demande exige un délai de ${notice.requiredNoticeDays} jours calendaires. Les dérogations RH sont autorisées uniquement entre J-29 et J-3. Le délai actuel est de ${notice.daysBeforeStart} jours.`,
      );
    }
  }

  private validateAndNormalizeSignature(
    signatureType: SignatureType,
    signatureDataValue: string,
  ): string {
    const signatureData = signatureDataValue.trim();

    if (signatureType === SignatureType.INITIALS) {
      const letterCount = (signatureData.match(/\p{L}/gu) ?? [])
        .length;

      if (
        letterCount < 2 ||
        letterCount > 6 ||
        !/^[\p{L}.\-\s]+$/u.test(signatureData)
      ) {
        throw new BadRequestException(
          'Les initiales doivent contenir entre 2 et 6 lettres.',
        );
      }

      return signatureData.toUpperCase();
    }

    const prefix = 'data:image/png;base64,';

    if (!signatureData.startsWith(prefix)) {
      throw new BadRequestException(
        'La signature dessinée doit être transmise au format PNG encodé en base64.',
      );
    }

    const base64Value = signatureData.slice(prefix.length);

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Value)) {
      throw new BadRequestException(
        'Les données de la signature dessinée ne sont pas valides.',
      );
    }

    const decodedSignature = Buffer.from(base64Value, 'base64');

    if (decodedSignature.length === 0) {
      throw new BadRequestException(
        'La signature dessinée est vide.',
      );
    }

    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    if (
      decodedSignature.length < pngHeader.length ||
      !decodedSignature
        .subarray(0, pngHeader.length)
        .equals(pngHeader)
    ) {
      throw new BadRequestException(
        'La signature dessinée doit contenir une véritable image PNG.',
      );
    }

    if (decodedSignature.length > 500 * 1024) {
      throw new BadRequestException(
        'La signature dessinée ne doit pas dépasser 500 Ko.',
      );
    }

    return signatureData;
  }

  private async validateAndCalculateDates(
    startDateValue: string,
    endDateValue: string,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
    allowsHalfDays: boolean,
  ): Promise<{
    calendarDuration: number;
    deductedDays: number;
  }> {
    const startDate = this.parseDate(startDateValue);
    const endDate = this.parseDate(endDateValue);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début.',
      );
    }

    const nonDeductibleDays =
      await this.holidaysService.findNonDeductibleBetween(
        startDateValue,
        endDateValue,
      );

    const nonDeductibleDaysByDate = new Map(
      nonDeductibleDays.map((day) => [day.date, day]),
    );

    this.validateBoundaryDate(
      startDateValue,
      startDate,
      nonDeductibleDaysByDate.get(startDateValue),
      'début',
    );

    this.validateBoundaryDate(
      endDateValue,
      endDate,
      nonDeductibleDaysByDate.get(endDateValue),
      'fin',
    );

    if (
      !allowsHalfDays &&
      (startPeriod !== DayPeriod.MATIN ||
        endPeriod !== DayPeriod.APRES_MIDI)
    ) {
      throw new BadRequestException(
        'Le type sélectionné n’autorise pas les demi-journées.',
      );
    }

    if (
      startDate.getTime() === endDate.getTime() &&
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.MATIN
    ) {
      throw new BadRequestException(
        'La période de fin ne peut pas précéder la période de début.',
      );
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const calendarDuration =
      Math.floor(
        (endDate.getTime() - startDate.getTime()) /
          millisecondsPerDay,
      ) + 1;

    return {
      calendarDuration,
      deductedDays: this.calculateDeductedDays(
        startDate,
        endDate,
        startPeriod,
        endPeriod,
        new Set(nonDeductibleDaysByDate.keys()),
      ),
    };
  }

  private calculateDeductedDays(
    startDate: Date,
    endDate: Date,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
    nonDeductibleDates: Set<string>,
  ): number {
    let total = 0;
    const currentDate = new Date(startDate);

    while (currentDate.getTime() <= endDate.getTime()) {
      const currentDateValue = currentDate.toISOString().slice(0, 10);
      const isSunday = currentDate.getUTCDay() === 0;
      const isNonDeductible =
        nonDeductibleDates.has(currentDateValue);

      if (!isSunday && !isNonDeductible) {
        let value = 1;

        if (
          currentDate.getTime() === startDate.getTime() &&
          startPeriod === DayPeriod.APRES_MIDI
        ) {
          value -= 0.5;
        }

        if (
          currentDate.getTime() === endDate.getTime() &&
          endPeriod === DayPeriod.MATIN
        ) {
          value -= 0.5;
        }

        total += value;
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return Math.max(total, 0);
  }

  private validateBoundaryDate(
    dateValue: string,
    date: Date,
    nonDeductibleDay: Holiday | undefined,
    boundary: 'début' | 'fin',
  ): void {
    if (date.getUTCDay() === 0) {
      throw new BadRequestException(
        `La date de ${boundary} ne peut pas être un dimanche.`,
      );
    }

    if (nonDeductibleDay) {
      throw new BadRequestException(
        `La date de ${boundary} ${dateValue} correspond à « ${nonDeductibleDay.name} » et n’est pas décomptable.`,
      );
    }
  }

  private async ensureModificationAllowed(
    startDateValue: string,
  ): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const deadlineDays =
      await this.settingsService.getModificationDeadlineDays();

    const modificationDeadline = this.parseDate(
      await this.calculateModificationDeadline(startDateValue),
    );

    if (today.getTime() > modificationDeadline.getTime()) {
      throw new BadRequestException(
        `Cette demande ne peut plus être modifiée : la limite de J-${deadlineDays} calendaires avant le départ est dépassée.`,
      );
    }
  }

  private hashSignature(
    signatureData: string | null,
  ): string | null {
    if (!signatureData) {
      return null;
    }

    return createHash('sha256')
      .update(signatureData)
      .digest('hex');
  }

  private async calculateModificationDeadline(
    startDateValue: string,
  ): Promise<string> {
    const deadlineDays =
      await this.settingsService.getModificationDeadlineDays();
    const startDate = this.parseDate(startDateValue);
    startDate.setUTCDate(startDate.getUTCDate() - deadlineDays);

    return startDate.toISOString().slice(0, 10);
  }

  private async evaluateSubmissionNoticeWithSettings(
    startDate: string,
    endDate: string,
    calendarDuration: number,
  ): Promise<SubmissionNoticeInfo> {
    const rules = await this.settingsService.getSubmissionRules();
    return evaluateSubmissionNotice(
      startDate,
      endDate,
      calendarDuration,
      new Date(),
      rules,
    );
  }

  private parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        'Une des dates fournies n’est pas valide.',
      );
    }

    return date;
  }
}
