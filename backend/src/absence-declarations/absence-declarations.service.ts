import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { AuditService } from '../audit/audit.service';
import { BirthEventsService } from '../birth-events/birth-events.service';
import {
  Document,
  DocumentStatus,
} from '../documents/document.entity';
import { ArreteChevauchementService } from '../leave-balances/arrete-chevauchement.service';
import type { ArreteChevauchementResult } from '../leave-balances/arrete-chevauchement.service';
import { MonthlyAccrualService } from '../leave-balances/monthly-accrual.service';
import { HolidaysService } from '../holidays/holidays.service';
import {
  FAMILY_EVENT_KINDS,
  applicableFamilyEventRule,
  type FamilyEventApplicableRule,
  type FamilyEventKind,
  type FamilyEventUnit,
} from '../leave-balances/family-event-rules.util';
import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';
import {
  LeaveRequest,
  LeaveRequestStatus,
  DayPeriod,
} from '../leave-requests/leave-request.entity';
import { getMartiniqueDateString } from '../leave-requests/leave-request-period.util';
import {
  findPeriodConflict,
  formatSlotConflictDate,
  formatSlotConflictPeriod,
  type PeriodSlot,
} from '../leave-requests/slot-overlap.util';
import {
  LeaveType,
  LeaveTypeAbsenceKind,
  LeaveTypeCategory,
} from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import {
  PATERNITY_DEADLINE_MONTHS,
  PATERNITY_SECOND_PERIOD_MAX_FRACTIONS,
  addMonthsIso as paternityAddMonthsIso,
  applicablePaternityLeaveRule,
  paternityCalendarDays,
  validatePaternityPeriodShape,
  type PaternityLeaveRule,
  type PaternityPeriodLabel,
} from '../leave-balances/paternity-leave.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from './absence-declaration.entity';
import { AbsenceDeclarationQueryDto } from './dto/absence-declaration-query.dto';
import { CreateAbsenceDeclarationDto } from './dto/create-absence-declaration.dto';
import { FamilyEventPreviewDto } from './dto/family-event-preview.dto';
import { RegisterAbsenceDeclarationDto } from './dto/register-absence-declaration.dto';
import { SubmitAbsenceDeclarationDto } from './dto/submit-absence-declaration.dto';
import { UpdateAbsenceDeclarationDto } from './dto/update-absence-declaration.dto';

function countWorkingDays(
  startDate: string,
  endDate: string,
  unit: FamilyEventUnit,
  nonDeductible: ReadonlySet<string>,
): number {
  let count = 0;
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    if (!nonDeductible.has(date)) {
      if (unit === 'OUVRES') {
        if (dow !== 0 && dow !== 6) count += 1;
      } else {
        if (dow !== 0) count += 1;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function addYearsIso(dateIso: string, years: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface FamilyEventQuota {
  kind: FamilyEventKind | 'PATERNITE_ACCUEIL';
  periodKey: string;
  authorizedDays: number;
  consumedDays: number;
  reservedDays: number;
  alreadyUsedDays: number;
  remainingDays: number;
  periodsCount?: number;
  exceeded: boolean;
  /** Jours du même événement répartis sur plus de quinze jours (Syntec naissance). */
  spanExceeded15?: boolean;
}

interface FamilyEventUsage {
  consumedDays: number;
  reservedDays: number;
  periodsCount: number;
}

interface FamilyEventResolution {
  kind: FamilyEventKind;
  rule: FamilyEventApplicableRule;
  requestedDays: number;
  uncertain: boolean;
  quota: FamilyEventQuota | null;
}

interface PaternityResolution {
  kind: 'PATERNITE_ACCUEIL';
  rule: PaternityLeaveRule;
  requestedDays: number;
  uncertain: boolean;
  quota: FamilyEventQuota | null;
  /** Le total (25/32) peut-il être contrôlé de façon fiable (infos complètes) ? */
  quotaEnforceable: boolean;
}

type AbsenceBusinessResolution = FamilyEventResolution | PaternityResolution;

interface PaternityUsage {
  consumedDays: number;
  reservedDays: number;
  firstPeriodCount: number;
  secondPeriodCount: number;
  secondPeriodDaysUsed: number;
}

interface FamilyEventInput {
  leaveTypeId: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  startPeriod: DayPeriod | null;
  endPeriod: DayPeriod | null;
  context: Record<string, unknown> | undefined;
  ignoredDeclarationId?: number | null;
}

@Injectable()
export class AbsenceDeclarationsService {
  private readonly logger = new Logger(AbsenceDeclarationsService.name);

  constructor(
    @InjectRepository(AbsenceDeclaration)
    private readonly absenceDeclarationRepository: Repository<AbsenceDeclaration>,

    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,

    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    private readonly usersService: UsersService,
    private readonly leaveTypesService: LeaveTypesService,
    private readonly birthEventsService: BirthEventsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly presenceService: PresenceService,
    private readonly arreteChevauchementService: ArreteChevauchementService,
    private readonly monthlyAccrualService: MonthlyAccrualService,
    private readonly dataSource: DataSource,
    private readonly holidaysService: HolidaysService,
  ) {}

  async createDraft(
    authenticatedUser: AuthenticatedUser,
    dto: CreateAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    this.ensureRhOnly(authenticatedUser);
    const employee = await this.resolveEmployee(
      authenticatedUser,
      dto.employeeId,
    );
    const employeeServiceId = employee.serviceId;
    const employeeService = employee.service;

    if (!employeeServiceId || !employeeService) {
      throw new BadRequestException(
        'Un service actif doit être affecté au collaborateur avant de déclarer une absence.',
      );
    }

    if (!employeeService.isActive) {
      throw new BadRequestException(
        'Le service du collaborateur est inactif : aucune absence ne peut être déclarée.',
      );
    }

    const creator = await this.usersService.findOne(
      authenticatedUser.id,
    );
    const leaveType = await this.leaveTypesService.findOne(
      dto.leaveTypeId,
    );

    this.validateLeaveType(leaveType, authenticatedUser.role);

    this.ensureSingleMode(dto);

    let duration = this.validateAndCalculateDuration({
      leaveType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: dto.startPeriod ?? DayPeriod.MATIN,
      endPeriod: dto.endPeriod ?? DayPeriod.APRES_MIDI,
      durationHours: dto.durationHours,
    });

    // JUR-029/030 + JUR-031 — contrôle des droits (non contournable).
    const businessResolution = await this.validateAbsenceBusiness({
      leaveTypeId: leaveType.id,
      employeeId: employee.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      context: dto.familyEventContext as Record<string, unknown> | undefined,
    });

    // JUR-031 : le congé de paternité est décompté en jours calendaires.
    if (businessResolution?.kind === 'PATERNITE_ACCUEIL') {
      duration = { ...duration, durationDays: businessResolution.requestedDays };
    }

    await this.ensureNoPersonalOverlap({
      employeeId: employee.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      ignoredAbsenceId: null,
      allowLeaveRequestOverlap: await this.arreteChevauchementService.shouldRelaxLeaveOverlap(leaveType),
    });

    const declaration = this.absenceDeclarationRepository.create({
      employeeId: employee.id,
      employee,
      createdById: creator.id,
      createdBy: creator,
      leaveTypeId: leaveType.id,
      leaveType,
      serviceId: employeeServiceId,
      service: employeeService,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      durationDays: duration.durationDays,
      durationHours: duration.durationHours,
      status: AbsenceDeclarationStatus.BROUILLON,
      comment: dto.comment?.trim() || null,
      familyEventContext: dto.familyEventContext
        ? JSON.stringify(dto.familyEventContext)
        : null,
      familyEventRule: this.serializeFamilyEvent(businessResolution),
      declaredAt: null,
      verifiedByRhId: null,
      verifiedByRh: null,
      verifiedAt: null,
    });

    const saved = await this.absenceDeclarationRepository.save(
      declaration,
    );

    return this.findAccessibleOne(saved.id, authenticatedUser);
  }

  /**
   * JUR-029/030 — aperçu non persistant du droit d'événement familial, utilisé
   * par les formulaires RH et collaborateur pour afficher la durée autorisée,
   * son unité, sa source, les jours réellement demandés et les anomalies.
   */
  async previewFamilyEvent(
    authenticatedUser: AuthenticatedUser,
    dto: FamilyEventPreviewDto,
  ): Promise<unknown> {
    const employeeId =
      authenticatedUser.role === UserRole.RH && dto.employeeId
        ? dto.employeeId
        : authenticatedUser.id;

    const resolution = await this.resolveFamilyEvent({
      leaveTypeId: dto.leaveTypeId,
      employeeId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: dto.startPeriod ?? DayPeriod.MATIN,
      endPeriod: dto.endPeriod ?? DayPeriod.APRES_MIDI,
      context: (dto.familyEventContext ?? {}) as Record<string, unknown>,
    });

    if (!resolution) return null;

    return {
      rule: resolution.rule,
      requestedDays: resolution.requestedDays,
      uncertain: resolution.uncertain,
      quota: resolution.quota,
    };
  }

  /**
   * JUR-031 — aperçu non persistant du droit de paternité (règle, jours
   * calendaires demandés, quota et erreurs de forme).
   */
  async previewPaternity(
    authenticatedUser: AuthenticatedUser,
    dto: FamilyEventPreviewDto,
  ): Promise<unknown> {
    const employeeId =
      authenticatedUser.role === UserRole.RH && dto.employeeId
        ? dto.employeeId
        : authenticatedUser.id;
    const context = (dto.familyEventContext ?? {}) as Record<string, unknown>;

    try {
      const resolution = await this.resolvePaternityLeave({
        leaveTypeId: dto.leaveTypeId,
        employeeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        startPeriod: dto.startPeriod ?? DayPeriod.MATIN,
        endPeriod: dto.endPeriod ?? DayPeriod.APRES_MIDI,
        context,
      });
      if (!resolution) return null;
      return {
        rule: resolution.rule,
        requestedDays: resolution.requestedDays,
        uncertain: resolution.uncertain,
        quota: resolution.quota,
        quotaEnforceable: resolution.quotaEnforceable,
        errors: [],
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        const nbEnfants =
          typeof context.nbEnfants === 'number' ? context.nbEnfants : undefined;
        return {
          rule: applicablePaternityLeaveRule(nbEnfants),
          requestedDays: paternityCalendarDays(dto.startDate, dto.endDate),
          uncertain: true,
          quota: null,
          errors: [error.message],
        };
      }
      throw error;
    }
  }

  async findMy(
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration[]> {
    const rows = await this.absenceDeclarationRepository.find({
      where: { employeeId: authenticatedUser.id },
      relations: {
        leaveType: true,
        service: true,
        createdBy: true,
        verifiedByRh: true,
      },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.hydrateFamilyEvent(row));
  }

  async findAccessibleOne(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findOneWithRelations(id);

    if (
      authenticatedUser.role !== UserRole.RH &&
      declaration.employeeId !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez consulter que vos propres déclarations d’absence.',
      );
    }

    return declaration;
  }

  async findForManagement(
    query: AbsenceDeclarationQueryDto,
  ): Promise<AbsenceDeclaration[]> {
    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .leftJoinAndSelect('absence.employee', 'employee')
      .leftJoinAndSelect('absence.createdBy', 'createdBy')
      .leftJoinAndSelect('absence.leaveType', 'leaveType')
      .leftJoinAndSelect('absence.service', 'service')
      .leftJoinAndSelect('absence.verifiedByRh', 'verifiedByRh')
      .orderBy('absence.createdAt', 'DESC');

    if (query.status) {
      qb.andWhere('absence.status = :status', {
        status: query.status,
      });
    }

    if (query.employeeId) {
      qb.andWhere('absence.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    }

    if (query.serviceId) {
      qb.andWhere('absence.serviceId = :serviceId', {
        serviceId: query.serviceId,
      });
    }

    if (query.from) {
      qb.andWhere('absence.endDate >= :from', {
        from: query.from,
      });
    }

    if (query.to) {
      qb.andWhere('absence.startDate <= :to', {
        to: query.to,
      });
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.hydrateFamilyEvent(row));
  }

  async findOneForManagement(
    id: number,
  ): Promise<AbsenceDeclaration> {
    return this.findOneWithRelations(id);
  }

  async updateDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: UpdateAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    this.ensureRhOnly(authenticatedUser);
    const declaration = await this.findAccessibleOne(
      id,
      authenticatedUser,
    );

    // JUR-031 — ancienne situation conservée pour l'historique d'audit
    // (une modification de période enregistrée doit laisser une trace de
    // l'ancien et du nouvel état, pas seulement updatedAt).
    const auditOldValue = {
      startDate: declaration.startDate,
      endDate: declaration.endDate,
      durationDays: declaration.durationDays,
      status: declaration.status,
      leaveTypeId: declaration.leaveTypeId,
    };

    if (declaration.status === AbsenceDeclarationStatus.BROUILLON) {
      if (
        authenticatedUser.role !== UserRole.RH &&
        declaration.createdById !== authenticatedUser.id
      ) {
        throw new ForbiddenException(
          'Seule la personne ayant créé le brouillon peut le modifier.',
        );
      }
    } else {
      if (authenticatedUser.role !== UserRole.RH) {
        throw new ForbiddenException(
          'Seule la RH peut modifier une absence déjà transmise.',
        );
      }

      if (
        ![
          AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
          AbsenceDeclarationStatus.A_VERIFIER_PAR_RH,
          AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
          AbsenceDeclarationStatus.ENREGISTREE,
        ].includes(declaration.status)
      ) {
        throw new BadRequestException(
          'Cette absence ne peut pas être modifiée dans son statut actuel.',
        );
      }
    }

    const leaveType =
      dto.leaveTypeId !== undefined &&
      dto.leaveTypeId !== declaration.leaveTypeId
        ? await this.leaveTypesService.findOne(dto.leaveTypeId)
        : declaration.leaveType;

    this.validateLeaveType(leaveType, authenticatedUser.role);

    this.ensureSingleMode(dto);

    // ANO-015 : un brouillon en mode heures ne peut pas être converti
    // silencieusement en jours/demi-journées en fournissant uniquement
    // des périodes sans durationHours.
    const isHoursDraft =
      declaration.durationHours !== null &&
      declaration.durationHours !== undefined;

    if (
      isHoursDraft &&
      dto.durationHours === undefined &&
      (dto.startPeriod !== undefined || dto.endPeriod !== undefined)
    ) {
      throw new BadRequestException(
        'Une absence saisie en heures ne peut pas être convertie en jours/demi-journées en fournissant uniquement des périodes.',
      );
    }

    const startDate = dto.startDate ?? declaration.startDate;
    const endDate = dto.endDate ?? declaration.endDate;

    const usesHours = dto.durationHours !== undefined;
    const usesPeriods =
      dto.startPeriod !== undefined || dto.endPeriod !== undefined;

    let startPeriod: DayPeriod | null;
    let endPeriod: DayPeriod | null;
    let durationHours: number | undefined;

    if (usesHours) {
      startPeriod = null;
      endPeriod = null;
      durationHours = dto.durationHours;
    } else if (usesPeriods) {
      startPeriod =
        dto.startPeriod ??
        declaration.startPeriod ??
        DayPeriod.MATIN;
      endPeriod =
        dto.endPeriod ??
        declaration.endPeriod ??
        DayPeriod.APRES_MIDI;
      durationHours = undefined;
    } else if (
      declaration.durationHours !== null &&
      declaration.durationHours !== undefined
    ) {
      startPeriod = null;
      endPeriod = null;
      durationHours = declaration.durationHours;
    } else {
      startPeriod = declaration.startPeriod;
      endPeriod = declaration.endPeriod;
      durationHours = undefined;
    }

    let duration = this.validateAndCalculateDuration({
      leaveType,
      startDate,
      endDate,
      startPeriod,
      endPeriod,
      durationHours,
    });

    await this.ensureNoPersonalOverlap({
      employeeId: declaration.employeeId,
      startDate,
      endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      ignoredAbsenceId: declaration.id,
      allowLeaveRequestOverlap: await this.arreteChevauchementService.shouldRelaxLeaveOverlap(leaveType),
    });

    const businessResolution = await this.validateAbsenceBusiness({
      leaveTypeId: leaveType.id,
      employeeId: declaration.employeeId,
      startDate,
      endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      context: (dto.familyEventContext as Record<string, unknown> | undefined) ??
        this.parseFamilyContext(declaration.familyEventContext),
      ignoredDeclarationId: declaration.id,
    });

    if (businessResolution?.kind === 'PATERNITE_ACCUEIL') {
      duration = { ...duration, durationDays: businessResolution.requestedDays };
    }

    declaration.leaveTypeId = leaveType.id;
    declaration.leaveType = leaveType;
    declaration.startDate = startDate;
    declaration.endDate = endDate;
    declaration.startPeriod = duration.startPeriod;
    declaration.endPeriod = duration.endPeriod;
    declaration.durationDays = duration.durationDays;
    declaration.durationHours = duration.durationHours;
    if (dto.familyEventContext !== undefined) {
      declaration.familyEventContext = JSON.stringify(dto.familyEventContext);
    }
    declaration.familyEventRule = this.serializeFamilyEvent(businessResolution);

    if (dto.comment !== undefined) {
      declaration.comment = dto.comment.trim() || null;
    }

    await this.absenceDeclarationRepository.save(declaration);

    if (
      declaration.status === AbsenceDeclarationStatus.ENREGISTREE
    ) {
      await this.presenceService.refreshUserStatus(
        declaration.employeeId,
      );
    }

    // JUR-031 — historisation réelle de la modification (ancien + nouvel état).
    await this.auditService.record({
      actorId: authenticatedUser.id,
      action: 'ABSENCE_DECLARATION_MODIFIED',
      resourceType: 'ABSENCE_DECLARATION',
      resourceId: declaration.id,
      oldValue: auditOldValue,
      newValue: {
        startDate: declaration.startDate,
        endDate: declaration.endDate,
        durationDays: declaration.durationDays,
        status: declaration.status,
        leaveTypeId: declaration.leaveTypeId,
      },
    });

    // JUR-025/037 — régularisation de l'acquisition après modification d'une
    // absence déjà enregistrée (dates ou classification).
    if (declaration.status === AbsenceDeclarationStatus.ENREGISTREE) {
      const oldStart = (auditOldValue.startDate as string) ?? declaration.startDate;
      const oldEnd = (auditOldValue.endDate as string) ?? declaration.endDate;
      const regularizeStart =
        oldStart < declaration.startDate ? oldStart : declaration.startDate;
      const regularizeEnd =
        oldEnd > declaration.endDate ? oldEnd : declaration.endDate;
      await this.triggerAccrualRegularization(
        declaration.employeeId,
        regularizeStart,
        regularizeEnd,
      );
    }

    return this.findAccessibleOne(id, authenticatedUser);
  }

  async submit(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: SubmitAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    this.ensureRhOnly(authenticatedUser);
    const preload = await this.findAccessibleOne(id, authenticatedUser);
    const key = this.familyQuotaLockKey(
      preload.leaveType?.absenceKind,
      preload.employeeId,
    );
    return this.runFamilyQuotaExclusive(key, () =>
      this.submitInner(id, authenticatedUser, dto),
    );
  }

  private async submitInner(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: SubmitAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findAccessibleOne(
      id,
      authenticatedUser,
    );

    this.ensureDraft(declaration);

    if (
      authenticatedUser.role !== UserRole.RH &&
      declaration.createdById !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Seule la personne ayant créé le brouillon peut le transmettre.',
      );
    }

    if (
      authenticatedUser.role !== UserRole.RH &&
      dto.certifiedAccurate !== true
    ) {
      throw new BadRequestException(
        'Vous devez certifier l’exactitude des informations avant de transmettre la déclaration.',
      );
    }

    await this.ensureNoPersonalOverlap({
      employeeId: declaration.employeeId,
      startDate: declaration.startDate,
      endDate: declaration.endDate,
      startPeriod: declaration.startPeriod,
      endPeriod: declaration.endPeriod,
      ignoredAbsenceId: declaration.id,
      allowLeaveRequestOverlap: await this.arreteChevauchementService.shouldRelaxLeaveOverlap(declaration.leaveType),
    });

    const businessResolution = await this.validateAbsenceBusiness({
      leaveTypeId: declaration.leaveTypeId,
      employeeId: declaration.employeeId,
      startDate: declaration.startDate,
      endDate: declaration.endDate,
      startPeriod: declaration.startPeriod,
      endPeriod: declaration.endPeriod,
      context: this.parseFamilyContext(declaration.familyEventContext),
      ignoredDeclarationId: declaration.id,
    });

    if (businessResolution?.kind === 'PATERNITE_ACCUEIL') {
      declaration.durationDays = businessResolution.requestedDays;
    }

    const now = new Date();

    declaration.declaredAt = now;

    const isDirectorSelfDeclaration =
      declaration.employee.role === UserRole.DIRECTEUR &&
      declaration.employeeId === authenticatedUser.id;
    const isRhOnlyDeclaration =
      declaration.leaveType.rhOnly &&
      authenticatedUser.role === UserRole.RH;

    if (isDirectorSelfDeclaration) {
      declaration.status = AbsenceDeclarationStatus.ENREGISTREE;
      declaration.verifiedByRhId = null;
      declaration.verifiedAt = now;
    } else if (
      isRhOnlyDeclaration &&
      !declaration.leaveType.documentRequired
    ) {
      declaration.status = AbsenceDeclarationStatus.ENREGISTREE;
      declaration.verifiedByRhId = authenticatedUser.id;
      declaration.verifiedAt = now;
    } else if (declaration.leaveType.documentRequired) {
      const hasActiveDocument = await this.hasActiveDocument(
        declaration.id,
      );

      if (
        !hasActiveDocument &&
        !declaration.leaveType.documentCanBeAddedLater
      ) {
        throw new BadRequestException(
          'Le justificatif obligatoire doit être ajouté avant la transmission de cette déclaration.',
        );
      }

      declaration.status = hasActiveDocument
        ? AbsenceDeclarationStatus.A_VERIFIER_PAR_RH
        : AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE;
    } else {
      declaration.status =
        AbsenceDeclarationStatus.A_VERIFIER_PAR_RH;
    }

    // JUR-029/030 + JUR-031 — cas incertains (anomalies, droits non
    // vérifiables) : la déclaration est toujours soumise à une vérification RH.
    if (businessResolution?.uncertain) {
      declaration.status = AbsenceDeclarationStatus.A_VERIFIER_PAR_RH;
      declaration.verifiedByRhId = null;
      declaration.verifiedAt = null;
    }

    declaration.familyEventRule = this.serializeFamilyEvent(businessResolution);

    const arreteResult = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AbsenceDeclaration).save(declaration);
      return this.processArreteChevauchement(
        declaration,
        authenticatedUser.id,
        manager,
      );
    });

    await this.notifyArreteChevauchement(arreteResult, declaration);

    await this.presenceService.refreshUserStatus(
      declaration.employeeId,
    );

    if (isDirectorSelfDeclaration) {
      await this.notificationsService.createForActiveRoles(
        [UserRole.RH],
        {
          type: 'ABSENCE_DIRECTEUR_INFORMATION',
          title: 'Indisponibilité du Directeur',
          message: `${declaration.employee.nom} ${declaration.employee.prenom} a enregistré une indisponibilité du ${declaration.startDate} au ${declaration.endDate}.`,
          absenceDeclarationId: declaration.id,
        },
      );
    } else {
      await this.notificationsService.create({
        userId: declaration.employeeId,
        type: 'ABSENCE_DECLARATION_RECORDED',
        title: 'Absence déclarée',
        message: `Votre absence du ${declaration.startDate} au ${declaration.endDate} a bien été enregistrée.`,
        absenceDeclarationId: declaration.id,
      });

      await this.notificationsService.createForActiveRoles(
        [UserRole.RH],
        {
          type: 'ABSENCE_DECLARATION_SUBMITTED_RH',
          title: 'Nouvelle déclaration d’absence',
          message: `${declaration.employee.nom} ${declaration.employee.prenom} a déclaré une absence du ${declaration.startDate} au ${declaration.endDate}.`,
          absenceDeclarationId: declaration.id,
        },
      );

      if (declaration.serviceId) {
        await this.notificationsService.createForServiceManagers(
          declaration.serviceId,
          {
            type: 'ABSENCE_DECLARATION_SUBMITTED_MANAGER',
            title: 'Nouvelle absence dans votre service',
            message: `${declaration.employee.nom} ${declaration.employee.prenom} a déclaré une absence du ${declaration.startDate} au ${declaration.endDate}.`,
            absenceDeclarationId: declaration.id,
          },
        );
      }

      if (
        declaration.status === AbsenceDeclarationStatus.A_VERIFIER_PAR_RH
      ) {
        await this.notificationsService.createForActiveRoles(
          [UserRole.RH],
          {
            type: 'ABSENCE_DECLARATION_TO_REVIEW',
            title: 'Absence à vérifier',
            message: `La déclaration d’absence de ${declaration.employee.nom} ${declaration.employee.prenom} est prête à être vérifiée.`,
            absenceDeclarationId: declaration.id,
          },
        );
      }

      if (
        declaration.status ===
        AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE
      ) {
        await this.notificationsService.create({
          userId: declaration.employeeId,
          type: 'SUPPORTING_DOCUMENT_REQUIRED',
          title: 'Justificatif à fournir',
          message: `Un justificatif doit être ajouté pour votre absence du ${declaration.startDate} au ${declaration.endDate}.`,
          absenceDeclarationId: declaration.id,
        });
      }
    }

    return this.findAccessibleOne(id, authenticatedUser);
  }


  async updateDirectorRecorded(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: UpdateAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    if (authenticatedUser.role !== UserRole.DIRECTEUR) {
      throw new ForbiddenException(
        'Seul le Directeur peut modifier cette indisponibilité.',
      );
    }

    const declaration = await this.findAccessibleOne(id, authenticatedUser);
    if (declaration.status !== AbsenceDeclarationStatus.ENREGISTREE) {
      throw new BadRequestException(
        'Seule une indisponibilité active peut être modifiée.',
      );
    }

    const today = getMartiniqueDateString(new Date());
    if (declaration.startDate <= today) {
      throw new BadRequestException(
        'Une indisponibilité en cours ou terminée ne peut plus être modifiée.',
      );
    }

    const leaveType =
      dto.leaveTypeId !== undefined && dto.leaveTypeId !== declaration.leaveTypeId
        ? await this.leaveTypesService.findOne(dto.leaveTypeId)
        : declaration.leaveType;
    this.validateLeaveType(leaveType, authenticatedUser.role);
    this.ensureSingleMode(dto);

    const startDate = dto.startDate ?? declaration.startDate;
    const endDate = dto.endDate ?? declaration.endDate;
    if (startDate <= today) {
      throw new BadRequestException(
        'La nouvelle période doit commencer après la date du jour.',
      );
    }

    const startPeriod = dto.startPeriod ?? declaration.startPeriod;
    const endPeriod = dto.endPeriod ?? declaration.endPeriod;
    const durationHours = dto.durationHours !== undefined
      ? dto.durationHours
      : dto.startPeriod !== undefined || dto.endPeriod !== undefined
        ? undefined
        : declaration.durationHours ?? undefined;
    const duration = this.validateAndCalculateDuration({
      leaveType,
      startDate,
      endDate,
      startPeriod,
      endPeriod,
      durationHours,
    });

    await this.ensureNoPersonalOverlap({
      employeeId: declaration.employeeId,
      startDate,
      endDate,
      startPeriod: duration.startPeriod,
      endPeriod: duration.endPeriod,
      ignoredAbsenceId: declaration.id,
      allowLeaveRequestOverlap: await this.arreteChevauchementService.shouldRelaxLeaveOverlap(leaveType),
    });

    declaration.leaveTypeId = leaveType.id;
    declaration.leaveType = leaveType;
    declaration.startDate = startDate;
    declaration.endDate = endDate;
    declaration.startPeriod = duration.startPeriod;
    declaration.endPeriod = duration.endPeriod;
    declaration.durationDays = duration.durationDays;
    declaration.durationHours = duration.durationHours;
    if (dto.comment !== undefined) {
      declaration.comment = dto.comment.trim() || null;
    }

    await this.absenceDeclarationRepository.save(declaration);
    await this.presenceService.refreshUserStatus(declaration.employeeId);
    await this.notificationsService.createForActiveRoles(
      [UserRole.RH],
      {
        type: 'ABSENCE_DIRECTEUR_MODIFIEE',
        title: 'Indisponibilité du Directeur modifiée',
        message: `${declaration.employee.nom} ${declaration.employee.prenom} a modifié son indisponibilité : du ${declaration.startDate} au ${declaration.endDate}.`,
        absenceDeclarationId: declaration.id,
      },
    );

    return this.findAccessibleOne(id, authenticatedUser);
  }

  async cancelDirectorRecorded(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration> {
    if (authenticatedUser.role !== UserRole.DIRECTEUR) {
      throw new ForbiddenException(
        'Seul le Directeur peut annuler cette indisponibilité.',
      );
    }

    const declaration = await this.findAccessibleOne(id, authenticatedUser);
    if (declaration.status !== AbsenceDeclarationStatus.ENREGISTREE) {
      throw new BadRequestException(
        'Cette indisponibilité est déjà annulée ou n’est plus active.',
      );
    }

    const today = getMartiniqueDateString(new Date());
    if (declaration.startDate <= today) {
      throw new BadRequestException(
        'Une indisponibilité en cours ou terminée ne peut plus être annulée.',
      );
    }

    declaration.status = AbsenceDeclarationStatus.ANNULEE;
    await this.absenceDeclarationRepository.save(declaration);
    await this.presenceService.refreshUserStatus(declaration.employeeId);
    await this.notificationsService.createForActiveRoles(
      [UserRole.RH],
      {
        type: 'ABSENCE_DIRECTEUR_ANNULEE',
        title: 'Indisponibilité du Directeur annulée',
        message: `${declaration.employee.nom} ${declaration.employee.prenom} a annulé son indisponibilité du ${declaration.startDate} au ${declaration.endDate}.`,
        absenceDeclarationId: declaration.id,
      },
    );

    return this.findAccessibleOne(id, authenticatedUser);
  }

  async registerByRh(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: RegisterAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    const preload = await this.findOneWithRelations(id);
    const key = this.familyQuotaLockKey(
      preload.leaveType?.absenceKind,
      preload.employeeId,
    );
    return this.runFamilyQuotaExclusive(key, () =>
      this.registerByRhInner(id, authenticatedUser, dto),
    );
  }

  private async registerByRhInner(
    id: number,
    authenticatedUser: AuthenticatedUser,
    dto: RegisterAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findOneWithRelations(id);

    if (
      declaration.status !==
      AbsenceDeclarationStatus.A_VERIFIER_PAR_RH
    ) {
      throw new BadRequestException(
        'Seule une déclaration complète au statut A_VERIFIER_PAR_RH peut être enregistrée.',
      );
    }

    if (declaration.leaveType.documentRequired) {
      await this.ensureRequiredDocumentsAccepted(declaration.id);
    }

    const businessResolution = await this.validateAbsenceBusiness({
      leaveTypeId: declaration.leaveTypeId,
      employeeId: declaration.employeeId,
      startDate: declaration.startDate,
      endDate: declaration.endDate,
      startPeriod: declaration.startPeriod,
      endPeriod: declaration.endPeriod,
      context: this.parseFamilyContext(declaration.familyEventContext),
      ignoredDeclarationId: declaration.id,
    });

    if (businessResolution?.kind === 'PATERNITE_ACCUEIL') {
      declaration.durationDays = businessResolution.requestedDays;
    }

    // JUR-031 — décision finale : un événement de naissance fiable est
    // obligatoire. Une justification libre ne peut pas autoriser des périodes
    // dont le quota n'est pas calculable.
    if (
      declaration.leaveType.absenceKind ===
      LeaveTypeAbsenceKind.PATERNITE_ACCUEIL
    ) {
      const ctx = this.parseFamilyContext(declaration.familyEventContext);
      const naissanceId =
        typeof ctx?.naissanceId === 'string' ? ctx.naissanceId : undefined;
      if (!naissanceId) {
        throw new BadRequestException(
          'Le rattachement à un événement de naissance est requis pour enregistrer une période de paternité.',
        );
      }
      await this.birthEventsService.assertOwnedBy(
        naissanceId,
        declaration.employeeId,
      );
    }

    const decisionReason = dto?.decisionReason?.trim();
    const decisionSource = dto?.decisionSource?.trim();
    if (businessResolution?.uncertain && (!decisionReason || !decisionSource)) {
      throw new BadRequestException(
        'Motif ET source/fondement de la durée sont requis pour autoriser une demande incertaine.',
      );
    }

    declaration.familyEventRule = this.serializeFamilyEvent(
      businessResolution,
      decisionReason
        ? {
            reason: decisionReason,
            source: decisionSource ?? '',
            decidedAt: new Date().toISOString(),
            decidedBy: authenticatedUser.id,
          }
        : null,
    );

    declaration.status = AbsenceDeclarationStatus.ENREGISTREE;
    declaration.verifiedByRhId = authenticatedUser.id;
    declaration.verifiedAt = new Date();

    const arreteResult = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AbsenceDeclaration).save(declaration);
      return this.processArreteChevauchement(
        declaration,
        authenticatedUser.id,
        manager,
      );
    });

    await this.notifyArreteChevauchement(arreteResult, declaration);

    await this.presenceService.refreshUserStatus(
      declaration.employeeId,
    );

    await this.notificationsService.create({
      userId: declaration.employeeId,
      type: 'ABSENCE_DECLARATION_AUTHORIZED',
      title: 'Absence autorisée',
      message: `Votre absence du ${declaration.startDate} au ${declaration.endDate} a été autorisée par la RH.`,
      absenceDeclarationId: declaration.id,
    });

    if (declaration.serviceId) {
      await this.notificationsService.createForServiceManagers(
        declaration.serviceId,
        {
          type: 'ABSENCE_DECLARATION_DECISION_INFO',
          title: 'Absence autorisée dans votre service',
          message: `L’absence de ${declaration.employee.nom} ${declaration.employee.prenom} du ${declaration.startDate} au ${declaration.endDate} a été autorisée.`,
          absenceDeclarationId: declaration.id,
        },
      );
    }

    // JUR-025/037 — régularisation de l'acquisition si l'absence porte sur des
    // mois déjà crédités (enregistrement tardif). Idempotente et non bloquante.
    await this.triggerAccrualRegularization(
      declaration.employeeId,
      declaration.startDate,
      declaration.endDate,
    );

    return this.findOneWithRelations(id);
  }

  /**
   * JUR-025/037 — recalcul contrôlé et idempotent des mois d'acquisition déjà
   * crédités impactés par une absence. Meilleure-effort : un échec est journalisé
   * sans bloquer le traitement de l'absence (relançable via l'endpoint RH).
   */
  private async triggerAccrualRegularization(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    try {
      await this.monthlyAccrualService.regularizeAbsenceImpact(
        employeeId,
        startDate,
        endDate,
        null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Régularisation d'acquisition différée (relançable via l'endpoint RH) : ${message}`,
      );
      // Anomalie persistante et visible pour la RH (jamais silencieuse).
      await this.notificationsService.createForActiveRoles([UserRole.RH], {
        type: 'ACCRUAL_REGULARIZATION_FAILED',
        title: 'Régularisation d’acquisition à relancer',
        message: `La régularisation des congés du salarié #${employeeId} (période ${startDate} → ${endDate}) a échoué. Relancez-la via l’endpoint de régularisation. Détail : ${message}`,
      });
    }
  }

  async deleteDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
    this.ensureRhOnly(authenticatedUser);
    const declaration = await this.findAccessibleOne(
      id,
      authenticatedUser,
    );

    this.ensureDraft(declaration);

    if (
      authenticatedUser.role !== UserRole.RH &&
      declaration.createdById !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Seule la personne ayant créé le brouillon peut le supprimer.',
      );
    }

    const activeDocuments = await this.documentRepository.count({
      where: {
        absenceDeclarationId: declaration.id,
        status: In([
          DocumentStatus.EN_ATTENTE,
          DocumentStatus.ACCEPTE,
          DocumentStatus.REJETE,
        ]),
      },
    });

    if (activeDocuments > 0) {
      throw new BadRequestException(
        'Supprimez les justificatifs du brouillon avant de supprimer la déclaration.',
      );
    }

    await this.absenceDeclarationRepository.remove(declaration);
  }

  async cancel(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration> {
    if (authenticatedUser.role !== UserRole.RH) {
      throw new ForbiddenException(
        'Seule la RH peut annuler une déclaration d’absence.',
      );
    }

    const declaration = await this.findAccessibleOne(
      id,
      authenticatedUser,
    );

    if (declaration.status === AbsenceDeclarationStatus.ANNULEE) {
      throw new BadRequestException(
        'Cette déclaration est déjà annulée.',
      );
    }

    const cancelledByRh =
      declaration.employeeId !== authenticatedUser.id;

    const cancelledStartDate = declaration.startDate;
    const cancelledEndDate = declaration.endDate;

    declaration.status = AbsenceDeclarationStatus.ANNULEE;

    const arreteResult = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AbsenceDeclaration).save(declaration);
      return this.processArreteChevauchement(
        declaration,
        authenticatedUser.id,
        manager,
      );
    });

    await this.notifyArreteChevauchement(arreteResult, declaration);

    await this.presenceService.refreshUserStatus(
      declaration.employeeId,
    );

    if (cancelledByRh) {
      await this.notificationsService.create({
        userId: declaration.employeeId,
        type: 'ABSENCE_DECLARATION_REFUSED',
        title: 'Absence annulée',
        message: `Votre absence du ${declaration.startDate} au ${declaration.endDate} a été annulée par la RH.`,
        absenceDeclarationId: declaration.id,
      });

      if (declaration.serviceId) {
        await this.notificationsService.createForServiceManagers(
          declaration.serviceId,
          {
            type: 'ABSENCE_DECLARATION_DECISION_INFO',
            title: 'Absence annulée dans votre service',
            message: `L’absence de ${declaration.employee.nom} ${declaration.employee.prenom} du ${declaration.startDate} au ${declaration.endDate} a été annulée par la RH.`,
            absenceDeclarationId: declaration.id,
          },
        );
      }
    }

    // JUR-025/037 — régularisation des mois déjà crédités impactés par l'annulation.
    await this.triggerAccrualRegularization(
      declaration.employeeId,
      cancelledStartDate,
      cancelledEndDate,
    );

    return this.findAccessibleOne(id, authenticatedUser);
  }

  /**
   * JUR-028 — déclenche la restitution (arrêt enregistré) ou l'inversion
   * (arrêt annulé) des jours de congé chevauchés. Meilleure-effort : un échec
   * est journalisé sans bloquer l'enregistrement de l'absence (le traitement
   * reste relançable via l'endpoint RH dédié, de façon idempotente).
   */
  /**
   * JUR-028 — restitution (arrêt enregistré) ou inversion (arrêt annulé),
   * exécutée DANS la transaction de l'absence : cohérence atomique, aucune
   * erreur ignorée silencieusement (elle annule l'enregistrement).
   */
  private async processArreteChevauchement(
    declaration: AbsenceDeclaration,
    actorId: number,
    manager: EntityManager,
  ): Promise<ArreteChevauchementResult | null> {
    if (declaration.status === AbsenceDeclarationStatus.ENREGISTREE) {
      return this.arreteChevauchementService.restoreForAbsence(
        declaration.id,
        actorId,
        manager,
      );
    }
    if (declaration.status === AbsenceDeclarationStatus.ANNULEE) {
      await this.arreteChevauchementService.reverseForAbsence(
        declaration.id,
        actorId,
        manager,
      );
    }
    return null;
  }

  /**
   * JUR-028 — signalement visible (notification RH) lorsqu'un chevauchement
   * arrêt/congé n'a pas été régularisé automatiquement (désactivé ou incertain).
   */
  private async notifyArreteChevauchement(
    result: ArreteChevauchementResult | null,
    declaration: AbsenceDeclaration,
  ): Promise<void> {
    if (!result?.manualActionNeeded) return;

    const employee = declaration.employee as
      | { nom?: string; prenom?: string }
      | undefined;
    await this.notificationsService.createForActiveRoles(
      [UserRole.RH],
      {
        type: 'ARRET_CHEVAUCHEMENT_REGULARISATION',
        title: 'Chevauchement arrêt/congé à régulariser',
        message: `L'arrêt de ${employee?.nom ?? ''} ${employee?.prenom ?? ''} (${declaration.startDate} → ${declaration.endDate}) chevauche des congés validés. Restitution automatique non appliquée (désactivée ou incertaine) : régularisation manuelle requise.`,
        absenceDeclarationId: declaration.id,
      },
    );
  }

  async markDocumentReadyForReview(
    id: number,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findOneWithRelations(id);

    if (
      ![
        AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
        AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
      ].includes(declaration.status)
    ) {
      throw new BadRequestException(
        'Cette déclaration n’attend pas de justificatif.',
      );
    }

    declaration.status =
      AbsenceDeclarationStatus.A_VERIFIER_PAR_RH;

    await this.absenceDeclarationRepository.save(declaration);

    return this.findOneWithRelations(id);
  }

  async markDocumentRejected(
    id: number,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findOneWithRelations(id);

    if (
      declaration.status !==
      AbsenceDeclarationStatus.A_VERIFIER_PAR_RH
    ) {
      throw new BadRequestException(
        'Le justificatif ne peut être rejeté que pendant la vérification RH.',
      );
    }

    // Le refus porte uniquement sur le justificatif : l’absence elle-même
    // n’est jamais refusée par la RH. Un nouveau document est attendu.
    declaration.status =
      AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE;
    declaration.verifiedByRhId = null;
    declaration.verifiedAt = null;

    await this.absenceDeclarationRepository.save(declaration);

    return this.findOneWithRelations(id);
  }

  async markDocumentMissing(
    id: number,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.findOneWithRelations(id);

    if (
      [
        AbsenceDeclarationStatus.BROUILLON,
        AbsenceDeclarationStatus.ENREGISTREE,
        AbsenceDeclarationStatus.ANNULEE,
      ].includes(declaration.status)
    ) {
      return declaration;
    }

    if (declaration.leaveType.documentRequired) {
      declaration.status =
        AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE;
      declaration.verifiedByRhId = null;
      declaration.verifiedAt = null;

      await this.absenceDeclarationRepository.save(declaration);
    }

    return this.findOneWithRelations(id);
  }

  private async hasActiveDocument(
    absenceDeclarationId: number,
  ): Promise<boolean> {
    const count = await this.documentRepository.count({
      where: {
        absenceDeclarationId,
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
    absenceDeclarationId: number,
  ): Promise<void> {
    const documents = await this.documentRepository.find({
      where: {
        absenceDeclarationId,
        status: In([
          DocumentStatus.EN_ATTENTE,
          DocumentStatus.ACCEPTE,
          DocumentStatus.REJETE,
        ]),
      },
    });

    if (documents.length === 0) {
      throw new BadRequestException(
        'Le justificatif obligatoire doit être fourni avant l’enregistrement de l’absence.',
      );
    }

    if (
      documents.some(
        (document) =>
          document.status !== DocumentStatus.ACCEPTE,
      )
    ) {
      throw new BadRequestException(
        'Tous les justificatifs actifs doivent être acceptés par la RH avant l’enregistrement de l’absence.',
      );
    }
  }

  /**
   * Défense en profondeur : seule la RH peut déclarer, modifier, soumettre ou
   * supprimer une absence (le contrôle de rôles du contrôleur est doublé ici).
   */
  private ensureRhOnly(authenticatedUser: AuthenticatedUser): void {
    if (authenticatedUser.role !== UserRole.RH) {
      throw new ForbiddenException(
        'Seule la RH peut déclarer une absence.',
      );
    }
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
        'Seule la RH peut créer une déclaration pour un autre collaborateur.',
      );
    }

    const employee = await this.usersService.findOne(employeeId);

    if (!employee.isActive) {
      throw new ForbiddenException(
        'Le compte du collaborateur est désactivé.',
      );
    }

    if (employee.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Un compte administrateur ne peut pas recevoir une déclaration d’absence métier.',
      );
    }

    return employee;
  }

  private ensureSingleMode(dto: {
    startPeriod?: DayPeriod;
    endPeriod?: DayPeriod;
    durationHours?: number;
  }): void {
    if (
      dto.durationHours !== undefined &&
      (dto.startPeriod !== undefined || dto.endPeriod !== undefined)
    ) {
      throw new BadRequestException(
        'Une absence doit être saisie soit en jours/demi-journées, soit en heures, mais pas dans les deux modes simultanément.',
      );
    }
  }

  private validateLeaveType(
    leaveType: LeaveType,
    actorRole: UserRole,
  ): void {
    if (!leaveType.isActive) {
      throw new BadRequestException(
        'Le type d’absence sélectionné est désactivé.',
      );
    }

    if (leaveType.category !== LeaveTypeCategory.DECLARATION_ABSENCE) {
      throw new BadRequestException(
        'Une déclaration d’absence doit utiliser un type de la catégorie ABSENCE.',
      );
    }

    if (
      leaveType.rhOnly &&
      actorRole !== UserRole.RH &&
      actorRole !== UserRole.DIRECTEUR
    ) {
      throw new ForbiddenException(
        'Ce type d’absence peut être saisi uniquement par la RH.',
      );
    }

    if (
      !leaveType.employeeCanCreate &&
      actorRole !== UserRole.RH &&
      actorRole !== UserRole.DIRECTEUR
    ) {
      throw new ForbiddenException(
        'Ce type d’absence ne peut pas être déclaré par un collaborateur.',
      );
    }
  }

  private validateAndCalculateDuration(input: {
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    startPeriod: DayPeriod | null;
    endPeriod: DayPeriod | null;
    durationHours?: number;
  }): {
    startPeriod: DayPeriod | null;
    endPeriod: DayPeriod | null;
    durationDays: number | null;
    durationHours: number | null;
  } {
    const startDate = this.parseDate(input.startDate);
    const endDate = this.parseDate(input.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début.',
      );
    }

    if (input.durationHours !== undefined) {
      if (!input.leaveType.allowsHours) {
        throw new BadRequestException(
          'Le type sélectionné ne peut pas être saisi en heures.',
        );
      }

      if (input.startDate !== input.endDate) {
        throw new BadRequestException(
          'Une absence saisie en heures doit concerner une seule date.',
        );
      }

      return {
        startPeriod: null,
        endPeriod: null,
        durationDays: null,
        durationHours: this.round(input.durationHours),
      };
    }

    const startPeriod = input.startPeriod ?? DayPeriod.MATIN;
    const endPeriod = input.endPeriod ?? DayPeriod.APRES_MIDI;

    if (
      !input.leaveType.allowsDays &&
      !input.leaveType.allowsHalfDays
    ) {
      throw new BadRequestException(
        'Le type sélectionné doit être saisi en heures.',
      );
    }

    if (
      !input.leaveType.allowsHalfDays &&
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
    let durationDays =
      Math.floor(
        (endDate.getTime() - startDate.getTime()) /
          millisecondsPerDay,
      ) + 1;

    if (startPeriod === DayPeriod.APRES_MIDI) {
      durationDays -= 0.5;
    }

    if (endPeriod === DayPeriod.MATIN) {
      durationDays -= 0.5;
    }

    return {
      startPeriod,
      endPeriod,
      durationDays: this.round(Math.max(durationDays, 0)),
      durationHours: null,
    };
  }

  /**
   * JUR-029/030 — résolution d'un événement familial : règle versionnée,
   * jours réellement demandés (calendrier + unité réelle), anomalies et quota
   * (droits annuels enfant malade, délai/fractionnement du congé de deuil).
   */
  private async resolveFamilyEvent(
    input: FamilyEventInput,
  ): Promise<FamilyEventResolution | null> {
    const leaveType = await this.leaveTypesService.findOne(input.leaveTypeId);
    const kind = leaveType.absenceKind as FamilyEventKind;
    if (!FAMILY_EVENT_KINDS.includes(kind)) return null;

    const startPeriod = input.startPeriod ?? DayPeriod.MATIN;
    const endPeriod = input.endPeriod ?? DayPeriod.APRES_MIDI;
    if (startPeriod !== DayPeriod.MATIN || endPeriod !== DayPeriod.APRES_MIDI) {
      throw new BadRequestException(
        'Les congés pour événements familiaux se décomptent en jours entiers (pas de demi-journées).',
      );
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: input.employeeId },
      relations: { legalEntity: true },
    });
    const convention = (user?.legalEntity?.conventionType ??
      LegalEntityConventionType.NON_RENSEIGNEE) as LegalEntityConventionType;

    const c = (input.context ?? {}) as Record<string, unknown>;
    const eventDate =
      typeof c.eventDate === 'string' ? c.eventDate : input.startDate;
    const rule = applicableFamilyEventRule(kind, eventDate, convention, {
      lien: (typeof c.lien === 'string' ? c.lien : undefined) as never,
      enfantAge: typeof c.enfantAge === 'number' ? c.enfantAge : undefined,
      aCharge: c.aCharge === true,
      nbEnfantsCharge:
        typeof c.nbEnfantsCharge === 'number' ? c.nbEnfantsCharge : undefined,
      enfantEstParent: c.enfantEstParent === true,
      personneChargeMoins25: c.personneChargeMoins25 === true,
      natureAnnonce:
        typeof c.natureAnnonce === 'string'
          ? (c.natureAnnonce as never)
          : undefined,
    });

    // JUR-029/030 — fenêtre temporelle stricte définie par la version
    // applicable (naissance « entourant » l'événement, adoption « suivant »).
    if (rule.temporalWindow) {
      const windowStart = addDaysIso(
        eventDate,
        -rule.temporalWindow.beforeDays,
      );
      const windowEnd = addDaysIso(
        eventDate,
        rule.temporalWindow.afterDays,
      );
      if (input.startDate < windowStart || input.endDate > windowEnd) {
        throw new BadRequestException(
          `La période doit être comprise entre le ${windowStart} et le ${windowEnd} (${rule.reference}).`,
        );
      }
    }

    // Calendrier applicable : on charge les jours non déductibles sur une
    // fenêtre élargie autour de l'événement et de la période demandée, afin
    // que les jours fériés situés AVANT le début du congé soient pris en
    // compte pour déterminer le premier jour ouvré suivant.
    const calendarStart =
      addDaysIso(eventDate, -14) < input.startDate
        ? addDaysIso(eventDate, -14)
        : input.startDate;
    const calendarEnd =
      addDaysIso(eventDate, 14) > input.endDate
        ? addDaysIso(eventDate, 14)
        : input.endDate;
    const holidays = await this.holidaysService.findNonDeductibleBetween(
      calendarStart,
      calendarEnd,
    );
    const holidaySet = new Set(holidays.map((h) => h.date));
    const requestedDays = countWorkingDays(
      input.startDate,
      input.endDate,
      rule.unit,
      holidaySet,
    );

    // JUR-029/030 — jours consécutifs (Syntec 2026 naissance/adoption).
    // Un ensemble de 3 jours ouvrés récupérés par listWorkingDays est, par
    // construction, un bloc de jours ouvrés consécutifs (aucun jour ouvré
    // intermédiaire ne peut manquer) : les week-ends et jours fériés
    // intermédiaires sont naturellement ignorés.
    if (rule.consecutive && rule.unit === 'OUVRES') {
      const workingDays = this.listWorkingDays(
        input.startDate,
        input.endDate,
        holidaySet,
      );
      if (workingDays.length !== 3) {
        throw new BadRequestException(
          'Le congé doit comporter exactement 3 jours ouvrés consécutifs.',
        );
      }
    }

    // JUR-029/030 — jour de début imposé (Syntec 2026 naissance/adoption).
    if (rule.startMode === 'BIRTH_OR_NEXT_WORKING') {
      const nextWorking = this.nextWorkingDay(eventDate, holidaySet);
      if (input.startDate !== eventDate && input.startDate !== nextWorking) {
        throw new BadRequestException(
          `Le congé doit commencer le jour de la naissance (${eventDate}) ou le premier jour ouvré suivant (${nextWorking}).`,
        );
      }
    } else if (rule.startMode === 'ADOPTION_2026') {
      const earliest = addDaysIso(eventDate, -7);
      const nextWorking = this.nextWorkingDay(eventDate, holidaySet);
      const allowed =
        (input.startDate >= earliest && input.startDate <= eventDate) ||
        input.startDate === nextWorking;
      if (!allowed) {
        throw new BadRequestException(
          `Le congé doit commencer pendant les sept jours précédant l’arrivée (${earliest} → ${eventDate}), le jour de l’arrivée ou le premier jour ouvré suivant (${nextWorking}).`,
        );
      }
    }

    const quota = await this.computeFamilyEventQuota(
      kind,
      input.employeeId,
      rule,
      eventDate,
      input.startDate,
      input.endDate,
      requestedDays,
      input.ignoredDeclarationId ?? null,
    );

    const effectiveAnomalies = [...rule.anomalies];
    if (quota?.spanExceeded15) {
      effectiveAnomalies.push(
        'Journées de naissance réparties sur plus de quinze jours pour le même événement — vérification RH requise (période de quinze jours entourant la naissance).',
      );
    }
    const effectiveRule =
      effectiveAnomalies.length === rule.anomalies.length
        ? rule
        : { ...rule, anomalies: effectiveAnomalies };
    const uncertain = effectiveRule.anomalies.length > 0;

    return { kind, rule: effectiveRule, requestedDays, uncertain, quota };
  }

  /**
   * JUR-029/030 — validation non contournable : refuse les dépassements
   * prouvés (droits et quotas) ; les cas incertains (anomalies) sont remontés
   * pour vérification RH plutôt que refusés automatiquement.
   */
  private async validateFamilyEvent(
    input: FamilyEventInput,
  ): Promise<FamilyEventResolution | null> {
    const resolution = await this.resolveFamilyEvent(input);
    if (!resolution) return null;

    // Une information manquante (daysCertain=false) suspend uniquement les
    // dépassements de durée/quota qui dépendent de cette information ; elle ne
    // désactive pas les violations certaines et structurelles (délai, nombre
    // de périodes, chevauchements).
    const certain = resolution.rule.daysCertain;

    if (resolution.quota?.exceeded && certain) {
      throw new BadRequestException(
        `Dépassement du quota « ${resolution.quota.kind} » : ${resolution.quota.authorizedDays} jour(s) autorisé(s) sur ${resolution.quota.periodKey} (consommés : ${resolution.quota.consumedDays}, réservés : ${resolution.quota.reservedDays}).`,
      );
    }

    if (resolution.requestedDays > resolution.rule.days && certain) {
      throw new BadRequestException(
        `Dépassement des droits : ${resolution.requestedDays} jour(s) ${resolution.rule.unit.toLowerCase()} demandé(s) pour ${resolution.rule.days} jour(s) autorisé(s) (${resolution.rule.reference}).`,
      );
    }

    return resolution;
  }

  /**
   * JUR-029/030 + JUR-031 — point d'entrée unique de validation métier :
   * événements familiaux (JUR-029/030) ou congé de paternité (JUR-031).
   */
  private async validateAbsenceBusiness(
    input: FamilyEventInput,
  ): Promise<AbsenceBusinessResolution | null> {
    const paternity = await this.resolvePaternityLeave(input);
    if (paternity) {
      if (paternity.quota?.exceeded && paternity.quotaEnforceable) {
        throw new BadRequestException(
          `Dépassement du droit de paternité : ${paternity.quota.authorizedDays} jour(s) calendaires autorisé(s) pour cet événement (consommés : ${paternity.quota.consumedDays}, réservés : ${paternity.quota.reservedDays}).`,
        );
      }
      return paternity;
    }
    return this.validateFamilyEvent(input);
  }

  /**
   * JUR-031 — résolution du congé de paternité et d'accueil de l'enfant :
   * jours calendaires, périodes, fractionnement, délai et cumul par événement.
   */
  private async resolvePaternityLeave(
    input: FamilyEventInput,
  ): Promise<PaternityResolution | null> {
    const leaveType = await this.leaveTypesService.findOne(input.leaveTypeId);
    if (leaveType.absenceKind !== LeaveTypeAbsenceKind.PATERNITE_ACCUEIL) {
      return null;
    }

    const startPeriod = input.startPeriod ?? DayPeriod.MATIN;
    const endPeriod = input.endPeriod ?? DayPeriod.APRES_MIDI;
    if (startPeriod !== DayPeriod.MATIN || endPeriod !== DayPeriod.APRES_MIDI) {
      throw new BadRequestException(
        'Le congé de paternité se décompte en jours calendaires entiers (pas de demi-journées).',
      );
    }

    const c = (input.context ?? {}) as Record<string, unknown>;
    const naissanceId =
      typeof c.naissanceId === 'string' && c.naissanceId.trim()
        ? c.naissanceId.trim()
        : undefined;
    const periode: PaternityPeriodLabel =
      c.periode === 'SECONDE' ? 'SECONDE' : 'PREMIERE';

    // JUR-031 — la date de naissance et le nombre d'enfants sont AUTORITATIFS
    // côté événement (backend), jamais issus de valeurs clientes lorsque
    // l'événement est identifié. Empêche le passage frauduleux de 1 à 2
    // enfants ou le report artificiel du délai de six mois.
    let dateNaissance: string | undefined;
    let nbEnfants: number | undefined;
    if (naissanceId) {
      const event = await this.birthEventsService.assertOwnedBy(
        naissanceId,
        input.employeeId,
      );
      dateNaissance = event.dateNaissance;
      nbEnfants = event.nbEnfants;
    } else {
      dateNaissance =
        typeof c.dateNaissance === 'string' ? c.dateNaissance : undefined;
      nbEnfants = typeof c.nbEnfants === 'number' ? c.nbEnfants : undefined;
    }

    const rule = applicablePaternityLeaveRule(nbEnfants);
    const anomalies = [...rule.anomalies];

    if (!dateNaissance) {
      anomalies.push(
        'Date de naissance manquante — vérification RH requise.',
      );
    }
    if (!naissanceId) {
      anomalies.push(
        'Événement de naissance non rattaché — sélectionnez ou créez une naissance (vérification RH requise sinon).',
      );
    }

    const requestedDays = paternityCalendarDays(
      input.startDate,
      input.endDate,
    );
    if (requestedDays <= 0) {
      throw new BadRequestException('La période de paternité est invalide.');
    }

    // Forme de la période (structurelle, non contournable).
    const shapeErrors = validatePaternityPeriodShape({
      periode,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    if (shapeErrors.length > 0) {
      throw new BadRequestException(shapeErrors.join(' '));
    }

    // Enchaînement (L1225-35) : la première période de 4 jours suit
    // immédiatement le congé de naissance effectivement enregistré. Seule une
    // absence ENREGISTREE compte ; une déclaration en attente n'est jamais
    // considérée comme un congé pris. Exception : hospitalisation immédiate.
    if (periode === 'PREMIERE' && dateNaissance) {
      if (c.hospitalisationEnfant === true) {
        anomalies.push(
          'Hospitalisation immédiate de l’enfant : prolongation ou décalage de la première période à vérifier par la RH (justificatif requis).',
        );
      } else {
        const birthLeave = await this.resolveBirthLeave(
          input.employeeId,
          dateNaissance,
        );
        if (!birthLeave) {
          anomalies.push(
            'Congé de naissance (3 jours) non enregistré dans le module — enchaînement à régulariser par la RH (attestation ou dates effectives).',
          );
        } else if (birthLeave.days < 3) {
          anomalies.push(
            `Congé de naissance incomplet (${birthLeave.days} jour(s) ${birthLeave.unit.toLowerCase()}) — enchaînement à régulariser par la RH.`,
          );
        } else {
          const expectedStart = addDaysIso(birthLeave.endDate, 1);
          if (input.startDate !== expectedStart) {
            throw new BadRequestException(
              `La première période doit débuter le ${expectedStart}, le jour suivant la fin du congé de naissance (${birthLeave.endDate}).`,
            );
          }
        }
      }
    }

    // Délai de 6 mois (seconde période), avec exceptions légales.
    if (periode === 'SECONDE' && dateNaissance) {
      const deadline = paternityAddMonthsIso(
        dateNaissance,
        PATERNITY_DEADLINE_MONTHS,
      );
      const exception =
        c.hospitalisationEnfant === true || c.decesMere === true;
      if (input.endDate > deadline && !exception) {
        throw new BadRequestException(
          `La seconde période doit être prise dans les ${PATERNITY_DEADLINE_MONTHS} mois suivant la naissance (au plus tard le ${deadline}).`,
        );
      }
      if (input.endDate > deadline && exception) {
        anomalies.push(
          'Dépassement du délai de 6 mois justifié par une exception (hospitalisation de l’enfant ou décès de la mère) — vérification RH requise.',
        );
      }
    }

    // Prévenance de l'employeur : au moins UN MOIS CIVIL (D1225-8), et non
    // 30 jours. Exceptions légales (naissance prématurée, hospitalisation,
    // décès de la mère) : la seconde période peut débuter sans délai, mais une
    // case cochée n'est PAS un justificatif — le cas est toujours remonté en
    // vérification RH, sans suppression silencieuse des contrôles.
    if (periode === 'SECONDE') {
      const exception =
        c.hospitalisationEnfant === true ||
        c.decesMere === true ||
        c.naissancePrematuree === true;
      if (exception) {
        const details: string[] = [];
        if (c.naissancePrematuree === true) {
          details.push('naissance avant la date prévue (début sans délai possible)');
        }
        if (c.hospitalisationEnfant === true) {
          details.push('hospitalisation de l’enfant (report à compter de la fin de l’hospitalisation)');
        }
        if (c.decesMere === true) {
          details.push('décès de la mère (délai applicable après le congé concerné)');
        }
        anomalies.push(
          `Exception de prévenance/délai déclarée (${details.join(' ; ')}) — justificatifs et dates à vérifier par la RH (aucun contrôle supprimé automatiquement).`,
        );
      } else if (!c.prevenanceDate) {
        anomalies.push(
          'Prévenance de l’employeur (au moins un mois) non renseignée — à justifier auprès de la RH.',
        );
      } else if (typeof c.prevenanceDate === 'string') {
        const minNoticeDate = paternityAddMonthsIso(input.startDate, -1);
        if (c.prevenanceDate > minNoticeDate) {
          anomalies.push(
            'Prévenance de moins d’un mois civil avant la seconde période — vérification RH requise.',
          );
        }
      }
    }

    const quota = await this.computePaternityQuota({
      employeeId: input.employeeId,
      naissanceId,
      dateNaissance,
      rule,
      periode,
      requestedDays,
      ignoredDeclarationId: input.ignoredDeclarationId ?? null,
    });

    const quotaEnforceable =
      nbEnfants !== undefined && !!naissanceId && !!dateNaissance;
    const uncertain =
      anomalies.length > 0 || !quotaEnforceable;

    return {
      kind: 'PATERNITE_ACCUEIL',
      rule,
      requestedDays,
      uncertain,
      quota,
      quotaEnforceable,
    };
  }

  private async computePaternityQuota(input: {
    employeeId: number;
    naissanceId: string | undefined;
    dateNaissance: string | undefined;
    rule: PaternityLeaveRule;
    periode: PaternityPeriodLabel;
    requestedDays: number;
    ignoredDeclarationId: number | null;
  }): Promise<FamilyEventQuota | null> {
    if (!input.naissanceId) {
      // Impossible de rattacher les périodes à un événement : aucun cumul
      // fiable, la demande est incertaine (vérification RH).
      return null;
    }

    const usage = await this.sumPaternityUsage({
      employeeId: input.employeeId,
      naissanceId: input.naissanceId,
      ignoredDeclarationId: input.ignoredDeclarationId,
    });

    const alreadyUsedDays = usage.consumedDays + usage.reservedDays;
    const periodKey = input.naissanceId;
    const authorizedDays = input.rule.totalDays;
    const exceeded =
      alreadyUsedDays + input.requestedDays > authorizedDays ||
      (input.periode === 'PREMIERE' && usage.firstPeriodCount >= 1) ||
      (input.periode === 'SECONDE' &&
        usage.secondPeriodCount >= PATERNITY_SECOND_PERIOD_MAX_FRACTIONS) ||
      // Plafond INDÉPENDANT de la seconde période : 21 ou 28 jours calendaires,
      // même si la première période n'a pas encore été enregistrée.
      (input.periode === 'SECONDE' &&
        usage.secondPeriodDaysUsed + input.requestedDays >
          input.rule.secondPeriodDays);

    return {
      kind: 'PATERNITE_ACCUEIL',
      periodKey,
      authorizedDays,
      consumedDays: usage.consumedDays,
      reservedDays: usage.reservedDays,
      alreadyUsedDays,
      remainingDays: Math.max(
        0,
        authorizedDays - alreadyUsedDays - input.requestedDays,
      ),
      periodsCount: usage.firstPeriodCount + usage.secondPeriodCount,
      exceeded,
    };
  }

  /**
   * JUR-031 — résolution du congé de naissance ENREGISTRÉ rattaché à une date
   * de naissance : durée réelle (unité du régime), date de fin effective.
   * Une déclaration en attente n'est jamais considérée comme un congé pris.
   */
  private async resolveBirthLeave(
    employeeId: number,
    dateNaissance: string,
  ): Promise<{ endDate: string; days: number; unit: FamilyEventUnit } | null> {
    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .innerJoin('absence.leaveType', 'leaveType')
      .where('absence.employeeId = :employeeId', { employeeId })
      .andWhere('leaveType.absenceKind = :kind', {
        kind: LeaveTypeAbsenceKind.NAISSANCE,
      })
      .andWhere('absence.status = :status', {
        status: AbsenceDeclarationStatus.ENREGISTREE,
      });

    const rows = await qb.getMany();

    let totalDays = 0;
    let endDate: string | null = null;
    let unit: FamilyEventUnit = 'OUVRABLES';

    // Cumul de TOUTES les journées de naissance enregistrées pour le même
    // événement (elles peuvent être réparties sur plusieurs déclarations).
    for (const row of rows) {
      const ctx = this.parseFamilyContext(row.familyEventContext);
      const rowEvent =
        typeof ctx?.eventDate === 'string' ? ctx.eventDate : row.startDate;
      if (rowEvent !== dateNaissance) continue;

      const serialized = this.parseFamilyEventRule(row.familyEventRule) as {
        rule?: { unit?: string };
      } | null;
      const rowUnit: FamilyEventUnit =
        serialized?.rule?.unit === 'OUVRES' ? 'OUVRES' : 'OUVRABLES';
      unit = rowUnit;
      const holidays = await this.holidaysService.findNonDeductibleBetween(
        row.startDate,
        row.endDate,
      );
      const holidaySet = new Set(holidays.map((h) => h.date));
      totalDays += countWorkingDays(
        row.startDate,
        row.endDate,
        rowUnit,
        holidaySet,
      );

      if (endDate === null || row.endDate > endDate) {
        endDate = row.endDate;
      }
    }

    if (endDate === null) return null;
    return { endDate, days: totalDays, unit };
  }

  private async sumPaternityUsage(input: {
    employeeId: number;
    naissanceId: string;
    ignoredDeclarationId: number | null;
  }): Promise<PaternityUsage> {
    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .innerJoin('absence.leaveType', 'leaveType')
      .where('absence.employeeId = :employeeId', {
        employeeId: input.employeeId,
      })
      .andWhere('leaveType.absenceKind = :kind', {
        kind: LeaveTypeAbsenceKind.PATERNITE_ACCUEIL,
      })
      .andWhere('absence.status NOT IN (:...excluded)', {
        excluded: [
          AbsenceDeclarationStatus.BROUILLON,
          AbsenceDeclarationStatus.ANNULEE,
        ],
      });

    if (input.ignoredDeclarationId !== null) {
      qb.andWhere('absence.id <> :ignoredId', {
        ignoredId: input.ignoredDeclarationId,
      });
    }

    const rows = await qb.getMany();

    let consumedDays = 0;
    let reservedDays = 0;
    let firstPeriodCount = 0;
    let secondPeriodCount = 0;
    let secondPeriodDaysUsed = 0;

    for (const row of rows) {
      const ctx = this.parseFamilyContext(row.familyEventContext);
      const rowId =
        typeof ctx?.naissanceId === 'string' ? ctx.naissanceId : undefined;
      if (rowId !== input.naissanceId) continue;

      const days = paternityCalendarDays(row.startDate, row.endDate);
      if (row.status === AbsenceDeclarationStatus.ENREGISTREE) {
        consumedDays += days;
      } else {
        reservedDays += days;
      }

      if ((ctx?.periode ?? 'PREMIERE') === 'PREMIERE') {
        firstPeriodCount += 1;
      } else {
        secondPeriodCount += 1;
        secondPeriodDaysUsed += days;
      }
    }

    return {
      consumedDays,
      reservedDays,
      firstPeriodCount,
      secondPeriodCount,
      secondPeriodDaysUsed,
    };
  }

  private serializeFamilyEvent(
    resolution: AbsenceBusinessResolution | null,
    rhDecision: { reason: string; source?: string; decidedAt: string; decidedBy: number } | null = null,
  ): string | null {
    if (!resolution) return null;
    return JSON.stringify({
      rule: resolution.rule,
      requestedDays: resolution.requestedDays,
      uncertain: resolution.uncertain,
      quota: resolution.quota,
      ...(rhDecision ? { rhDecision } : {}),
    });
  }

  private async computeFamilyEventQuota(
    kind: FamilyEventKind,
    employeeId: number,
    rule: FamilyEventApplicableRule,
    eventDate: string,
    startDate: string,
    endDate: string,
    requestedDays: number,
    ignoredDeclarationId: number | null,
  ): Promise<FamilyEventQuota | null> {
    if (kind === 'ENFANT_MALADE') {
      const year = startDate.slice(0, 4);
      const rangeStart = `${year}-01-01`;
      const rangeEnd = `${year}-12-31`;
      const usage = await this.sumFamilyEventUsage({
        kind,
        employeeId,
        ignoredDeclarationId,
        rangeStart,
        rangeEnd,
      });
      const authorizedDays = rule.days;
      const alreadyUsedDays = usage.consumedDays + usage.reservedDays;
      return {
        kind,
        periodKey: year,
        authorizedDays,
        consumedDays: usage.consumedDays,
        reservedDays: usage.reservedDays,
        alreadyUsedDays,
        remainingDays: Math.max(
          0,
          authorizedDays - alreadyUsedDays - requestedDays,
        ),
        exceeded: alreadyUsedDays + requestedDays > authorizedDays,
      };
    }

    if (kind === 'NAISSANCE' || kind === 'ADOPTION') {
      // Cumul plafonné à rule.days pour le MÊME événement (naissance ou
      // arrivée au foyer) : empêche de multiplier les déclarations pour
      // dépasser les 3 jours (jours non consécutifs compris).
      const usage = await this.sumFamilyEventUsageForEvent({
        kind,
        employeeId,
        eventDate,
        unit: rule.unit,
        ignoredDeclarationId,
      });
      const authorizedDays = rule.days;
      const alreadyUsedDays = usage.consumedDays + usage.reservedDays;

      // JUR-029/030 — pour la naissance Syntec (« quinze jours entourant »),
      // les journées prises (même réparties sur plusieurs déclarations)
      // doivent tenir dans une même période de quinze jours contenant la
      // naissance. Au-delà, vérification RH (aucun découpage 7/7 imposé).
      const spanStart =
        usage.earliestDay === null || startDate < usage.earliestDay
          ? startDate
          : usage.earliestDay;
      const spanEnd =
        usage.latestDay === null || endDate > usage.latestDay
          ? endDate
          : usage.latestDay;
      const spanDays =
        Math.round(
          (new Date(`${spanEnd}T00:00:00.000Z`).getTime() -
            new Date(`${spanStart}T00:00:00.000Z`).getTime()) /
            86_400_000,
        ) + 1;
      const spanExceeded15 = spanDays > 15;

      return {
        kind,
        periodKey: `${eventDate} (${rule.reference})`,
        authorizedDays,
        consumedDays: usage.consumedDays,
        reservedDays: usage.reservedDays,
        alreadyUsedDays,
        remainingDays: Math.max(
          0,
          authorizedDays - alreadyUsedDays - requestedDays,
        ),
        exceeded: alreadyUsedDays + requestedDays > authorizedDays,
        spanExceeded15,
      };
    }

    if (kind === 'DEUIL_ENFANT') {
      // Délai légal d'un an : du jour du décès au jour précédant le premier
      // anniversaire (ex. décès le 01/10/2026 → jusqu'au 30/09/2027).
      const limitEnd = addDaysIso(addYearsIso(eventDate, 1), -1);
      if (startDate < eventDate || endDate > limitEnd) {
        throw new BadRequestException(
          'Le congé de deuil doit être pris dans le délai d’un an à compter du décès.',
        );
      }
      const usage = await this.sumFamilyEventUsage({
        kind,
        employeeId,
        ignoredDeclarationId,
        rangeStart: eventDate,
        rangeEnd: limitEnd,
        eventDate,
      });

      // Fractionnement : deux périodes au maximum.
      if (usage.periodsCount >= 2) {
        throw new BadRequestException(
          'Le congé de deuil ne peut pas être fractionné en plus de deux périodes.',
        );
      }

      const authorizedDays = 8;
      const alreadyUsedDays = usage.consumedDays + usage.reservedDays;
      return {
        kind,
        periodKey: `${eventDate} → ${limitEnd}`,
        authorizedDays,
        consumedDays: usage.consumedDays,
        reservedDays: usage.reservedDays,
        alreadyUsedDays,
        remainingDays: Math.max(
          0,
          authorizedDays - alreadyUsedDays - requestedDays,
        ),
        periodsCount: usage.periodsCount,
        exceeded: alreadyUsedDays + requestedDays > authorizedDays,
      };
    }

    return null;
  }

  /**
   * Cumul des jours d'un événement de naissance/adoption rattaché à une date
   * d'événement précise (jours pleins, unité réelle ouvrés/ouvrables).
   */
  private async sumFamilyEventUsageForEvent(input: {
    kind: FamilyEventKind;
    employeeId: number;
    eventDate: string;
    unit: FamilyEventUnit;
    ignoredDeclarationId: number | null;
  }): Promise<
    FamilyEventUsage & { earliestDay: string | null; latestDay: string | null }
  > {
    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .innerJoin('absence.leaveType', 'leaveType')
      .where('absence.employeeId = :employeeId', {
        employeeId: input.employeeId,
      })
      .andWhere('leaveType.absenceKind = :kind', { kind: input.kind })
      .andWhere('absence.status NOT IN (:...excluded)', {
        excluded: [
          AbsenceDeclarationStatus.BROUILLON,
          AbsenceDeclarationStatus.ANNULEE,
        ],
      });

    if (input.ignoredDeclarationId !== null) {
      qb.andWhere('absence.id <> :ignoredId', {
        ignoredId: input.ignoredDeclarationId,
      });
    }

    const rows = await qb.getMany();
    let consumedDays = 0;
    let reservedDays = 0;
    let periodsCount = 0;
    let earliestDay: string | null = null;
    let latestDay: string | null = null;

    for (const row of rows) {
      const ctx = this.parseFamilyContext(row.familyEventContext);
      const rowEvent =
        typeof ctx?.eventDate === 'string' ? ctx.eventDate : row.startDate;
      if (rowEvent !== input.eventDate) continue;

      periodsCount += 1;
      if (earliestDay === null || row.startDate < earliestDay) {
        earliestDay = row.startDate;
      }
      if (latestDay === null || row.endDate > latestDay) {
        latestDay = row.endDate;
      }

      const holidays = await this.holidaysService.findNonDeductibleBetween(
        row.startDate,
        row.endDate,
      );
      const holidaySet = new Set(holidays.map((h) => h.date));
      const days = countWorkingDays(
        row.startDate,
        row.endDate,
        input.unit,
        holidaySet,
      );

      if (row.status === AbsenceDeclarationStatus.ENREGISTREE) {
        consumedDays += days;
      } else {
        reservedDays += days;
      }
    }

    return {
      consumedDays,
      reservedDays,
      periodsCount,
      earliestDay,
      latestDay,
    };
  }

  private async sumFamilyEventUsage(input: {
    kind: FamilyEventKind;
    employeeId: number;
    ignoredDeclarationId: number | null;
    rangeStart: string;
    rangeEnd: string;
    eventDate?: string;
  }): Promise<FamilyEventUsage> {
    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .innerJoin('absence.leaveType', 'leaveType')
      .where('absence.employeeId = :employeeId', {
        employeeId: input.employeeId,
      })
      .andWhere('leaveType.absenceKind = :kind', { kind: input.kind })
      .andWhere('absence.status NOT IN (:...excluded)', {
        excluded: [
          AbsenceDeclarationStatus.BROUILLON,
          AbsenceDeclarationStatus.ANNULEE,
        ],
      })
      .andWhere('absence.startDate <= :rangeEnd', {
        rangeEnd: input.rangeEnd,
      })
      .andWhere('absence.endDate >= :rangeStart', {
        rangeStart: input.rangeStart,
      });

    if (input.ignoredDeclarationId !== null) {
      qb.andWhere('absence.id <> :ignoredId', {
        ignoredId: input.ignoredDeclarationId,
      });
    }

    const rows = await qb.getMany();
    const holidays = await this.holidaysService.findNonDeductibleBetween(
      input.rangeStart,
      input.rangeEnd,
    );
    const holidaySet = new Set(holidays.map((h) => h.date));

    let consumedDays = 0;
    let reservedDays = 0;
    let periodsCount = 0;

    for (const row of rows) {
      // Pour le congé de deuil, le quota est rattaché au MÊME événement de
      // décès : deux décès distincts ne partagent pas le même quota.
      if (input.eventDate) {
        const ctx = this.parseFamilyContext(row.familyEventContext);
        const rowEvent =
          typeof ctx?.eventDate === 'string' ? ctx.eventDate : row.startDate;
        if (rowEvent !== input.eventDate) continue;
      }

      periodsCount += 1;

      // Ne compter que les jours réellement compris dans la période (année
      // civile pour enfant malade, fenêtre d'un an pour le deuil).
      const overlapStart =
        row.startDate > input.rangeStart ? row.startDate : input.rangeStart;
      const overlapEnd =
        row.endDate < input.rangeEnd ? row.endDate : input.rangeEnd;
      if (overlapStart > overlapEnd) continue;

      const days = countWorkingDays(
        overlapStart,
        overlapEnd,
        'OUVRABLES',
        holidaySet,
      );

      if (row.status === AbsenceDeclarationStatus.ENREGISTREE) {
        consumedDays += days;
      } else {
        reservedDays += days;
      }
    }

    return { consumedDays, reservedDays, periodsCount };
  }

  private hydrateFamilyEvent(
    declaration: AbsenceDeclaration,
  ): AbsenceDeclaration {
    declaration.familyEvent = this.parseFamilyEventRule(
      declaration.familyEventRule,
    );
    return declaration;
  }

  private parseFamilyEventRule(raw: string | null): unknown | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private parseFamilyContext(
    raw: string | null,
  ): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private async ensureNoPersonalOverlap(input: {
    employeeId: number;
    startDate: string;
    endDate: string;
    startPeriod: DayPeriod | null;
    endPeriod: DayPeriod | null;
    ignoredAbsenceId: number | null;
    allowLeaveRequestOverlap: boolean;
  }): Promise<void> {
    const releasedLeaveStatuses = [
      LeaveRequestStatus.REFUSEE,
      LeaveRequestStatus.ANNULEE,
      LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
      LeaveRequestStatus.EXPIREE_NON_VALIDEE,
    ];

    const candidate: PeriodSlot = {
      startDate: input.startDate,
      endDate: input.endDate,
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
    };

    // JUR-028 : un arrêt maladie configuré peut chevaucher un congé validé
    // (les jours chevauchés sont restitués). Le contrôle des demandes de congé
    // est alors ignoré ; celui des absences entre elles est conservé.
    if (!input.allowLeaveRequestOverlap) {
      const overlappingLeaves = await this.leaveRequestRepository
        .createQueryBuilder('leaveRequest')
        .where('leaveRequest.employeeId = :employeeId', {
          employeeId: input.employeeId,
        })
        .andWhere('leaveRequest.startDate <= :endDate', {
          endDate: input.endDate,
        })
        .andWhere('leaveRequest.endDate >= :startDate', {
          startDate: input.startDate,
        })
        .andWhere('leaveRequest.status NOT IN (:...releasedStatuses)', {
          releasedStatuses: releasedLeaveStatuses,
        })
        .orderBy('leaveRequest.startDate', 'ASC')
        .getMany();

      for (const other of overlappingLeaves) {
        const conflict = findPeriodConflict(candidate, {
          startDate: other.startDate,
          endDate: other.endDate,
          startPeriod: other.startPeriod,
          endPeriod: other.endPeriod,
        });

        if (conflict) {
          throw new ConflictException(
            `${formatSlotConflictPeriod(conflict.period)} du ${formatSlotConflictDate(conflict.date)} est déjà couvert par ${this.describeLeaveOccupancy(other)}.`,
          );
        }
      }
    }

    const qb = this.absenceDeclarationRepository
      .createQueryBuilder('absence')
      .where('absence.employeeId = :employeeId', {
        employeeId: input.employeeId,
      })
      .andWhere('absence.startDate <= :endDate', {
        endDate: input.endDate,
      })
      .andWhere('absence.endDate >= :startDate', {
        startDate: input.startDate,
      })
      .andWhere('absence.status <> :cancelledStatus', {
        cancelledStatus: AbsenceDeclarationStatus.ANNULEE,
      });

    if (input.ignoredAbsenceId !== null) {
      qb.andWhere('absence.id <> :ignoredAbsenceId', {
        ignoredAbsenceId: input.ignoredAbsenceId,
      });
    }

    const overlappingAbsences = await qb
      .orderBy('absence.startDate', 'ASC')
      .getMany();

    for (const absence of overlappingAbsences) {
      const conflict = findPeriodConflict(candidate, {
        startDate: absence.startDate,
        endDate: absence.endDate,
        startPeriod: absence.startPeriod,
        endPeriod: absence.endPeriod,
      });

      if (conflict) {
        throw new ConflictException(
          `${formatSlotConflictPeriod(conflict.period)} du ${formatSlotConflictDate(conflict.date)} est déjà couvert par ${this.describeAbsenceOccupancy(absence)}.`,
        );
      }
    }
  }

  private describeLeaveOccupancy(
    leaveRequest: LeaveRequest,
  ): string {
    const label =
      leaveRequest.status === LeaveRequestStatus.BROUILLON
        ? 'un brouillon de demande'
        : leaveRequest.status === LeaveRequestStatus.VALIDEE
          ? 'une demande validée'
          : leaveRequest.status ===
              LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD
            ? 'une demande en attente d’annulation'
            : 'une demande en attente';

    return `${label} n°${leaveRequest.id}`;
  }

  private describeAbsenceOccupancy(
    absence: AbsenceDeclaration,
  ): string {
    const label =
      absence.status === AbsenceDeclarationStatus.ENREGISTREE
        ? 'une absence validée'
        : 'une absence en attente';

    return `${label} n°${absence.id}`;
  }

  private ensureDraft(declaration: AbsenceDeclaration): void {
    if (declaration.status !== AbsenceDeclarationStatus.BROUILLON) {
      throw new BadRequestException(
        'Seule une déclaration au statut BROUILLON peut être modifiée ou transmise.',
      );
    }
  }

  private async findOneWithRelations(
    id: number,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.absenceDeclarationRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
        verifiedByRh: true,
      },
    });

    if (!declaration) {
      throw new NotFoundException(
        `La déclaration d’absence ${id} est introuvable.`,
      );
    }

    return this.hydrateFamilyEvent(declaration);
  }

  private familyQuotaLockKey(
    absenceKind: string | undefined,
    employeeId: number,
  ): string | null {
    if (
      absenceKind === 'ENFANT_MALADE' ||
      absenceKind === 'DEUIL_ENFANT' ||
      absenceKind === 'PATERNITE_ACCUEIL'
    ) {
      return `family-event-quota-${employeeId}-${absenceKind}`;
    }
    return null;
  }

  /**
   * Verrou MySQL/MariaDB (GET_LOCK) par salarié et événement à quota :
   * sérialise les soumissions/validations concurrentes, y compris entre
   * plusieurs instances du backend. La connexion dédiée garantit que
   * GET_LOCK/RELEASE_LOCK s'exécutent sur la même connexion.
   */
  private async runFamilyQuotaExclusive<T>(
    key: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) return fn();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const rows = await queryRunner.query(
        'SELECT GET_LOCK(?, 10) AS acquired',
        [key],
      );
      const acquired = Number(rows?.[0]?.acquired ?? 0) === 1;
      if (!acquired) {
        throw new ConflictException(
          'Une opération concurrente est en cours pour cet événement. Réessayez dans un instant.',
        );
      }
      try {
        return await fn();
      } finally {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [key]);
      }
    } finally {
      await queryRunner.release();
    }
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

  private listWorkingDays(
    startDate: string,
    endDate: string,
    nonDeductible: ReadonlySet<string>,
  ): string[] {
    const result: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      const date = cursor.toISOString().slice(0, 10);
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6 && !nonDeductible.has(date)) {
        result.push(date);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }

  private nextWorkingDay(
    dateIso: string,
    nonDeductible: ReadonlySet<string>,
  ): string {
    let cursor = addDaysIso(dateIso, 1);
    for (let i = 0; i < 14; i += 1) {
      const dow = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
      if (dow !== 0 && dow !== 6 && !nonDeductible.has(cursor)) {
        return cursor;
      }
      cursor = addDaysIso(cursor, 1);
    }
    return cursor;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
