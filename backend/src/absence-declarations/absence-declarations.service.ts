import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  Document,
  DocumentStatus,
} from '../documents/document.entity';
import {
  LeaveRequest,
  LeaveRequestStatus,
  DayPeriod,
} from '../leave-requests/leave-request.entity';
import { getMartiniqueDateString } from '../leave-requests/leave-request-period.util';
import {
  LeaveType,
  LeaveTypeCategory,
} from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
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
import { SubmitAbsenceDeclarationDto } from './dto/submit-absence-declaration.dto';
import { UpdateAbsenceDeclarationDto } from './dto/update-absence-declaration.dto';

@Injectable()
export class AbsenceDeclarationsService {
  constructor(
    @InjectRepository(AbsenceDeclaration)
    private readonly absenceDeclarationRepository: Repository<AbsenceDeclaration>,

    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,

    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    private readonly usersService: UsersService,
    private readonly leaveTypesService: LeaveTypesService,
    private readonly notificationsService: NotificationsService,
    private readonly presenceService: PresenceService,
  ) {}

  async createDraft(
    authenticatedUser: AuthenticatedUser,
    dto: CreateAbsenceDeclarationDto,
  ): Promise<AbsenceDeclaration> {
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

    const duration = this.validateAndCalculateDuration({
      leaveType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startPeriod: dto.startPeriod ?? DayPeriod.MATIN,
      endPeriod: dto.endPeriod ?? DayPeriod.APRES_MIDI,
      durationHours: dto.durationHours,
    });

    await this.ensureNoPersonalOverlap({
      employeeId: employee.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
      ignoredAbsenceId: null,
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

  async findMy(
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration[]> {
    return this.absenceDeclarationRepository.find({
      where: { employeeId: authenticatedUser.id },
      relations: {
        leaveType: true,
        service: true,
        createdBy: true,
        verifiedByRh: true,
      },
      order: { createdAt: 'DESC' },
    });
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

    return qb.getMany();
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
        'Seule la personne ayant créé le brouillon peut le modifier.',
      );
    }

    const leaveType =
      dto.leaveTypeId !== undefined &&
      dto.leaveTypeId !== declaration.leaveTypeId
        ? await this.leaveTypesService.findOne(dto.leaveTypeId)
        : declaration.leaveType;

    this.validateLeaveType(leaveType, authenticatedUser.role);

    this.ensureSingleMode(dto);

    const startDate = dto.startDate ?? declaration.startDate;
    const endDate = dto.endDate ?? declaration.endDate;
    const startPeriod =
      dto.startPeriod ?? declaration.startPeriod;
    const endPeriod = dto.endPeriod ?? declaration.endPeriod;
    const durationHours =
      dto.durationHours !== undefined
        ? dto.durationHours
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
      ignoredAbsenceId: declaration.id,
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

    return this.findAccessibleOne(id, authenticatedUser);
  }

  async submit(
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
      ignoredAbsenceId: declaration.id,
    });

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

    await this.absenceDeclarationRepository.save(declaration);

    await this.presenceService.refreshUserStatus(
      declaration.employeeId,
    );

    if (isDirectorSelfDeclaration) {
      await this.notificationsService.createForActiveRoles(
        [UserRole.RH],
        {
          type: 'ABSENCE_DIRECTEUR_INFORMATION',
          title: 'Indisponibilité du Directeur',
          message: `${declaration.employee.prenom} ${declaration.employee.nom} a enregistré une indisponibilité du ${declaration.startDate} au ${declaration.endDate}.`,
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
          message: `${declaration.employee.prenom} ${declaration.employee.nom} a déclaré une absence du ${declaration.startDate} au ${declaration.endDate}.`,
          absenceDeclarationId: declaration.id,
        },
      );

      if (declaration.serviceId) {
        await this.notificationsService.createForServiceManagers(
          declaration.serviceId,
          {
            type: 'ABSENCE_DECLARATION_SUBMITTED_MANAGER',
            title: 'Nouvelle absence dans votre service',
            message: `${declaration.employee.prenom} ${declaration.employee.nom} a déclaré une absence du ${declaration.startDate} au ${declaration.endDate}.`,
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
            message: `La déclaration d’absence de ${declaration.employee.prenom} ${declaration.employee.nom} est prête à être vérifiée.`,
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
      ignoredAbsenceId: declaration.id,
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
        message: `${declaration.employee.prenom} ${declaration.employee.nom} a modifié son indisponibilité : du ${declaration.startDate} au ${declaration.endDate}.`,
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
        message: `${declaration.employee.prenom} ${declaration.employee.nom} a annulé son indisponibilité du ${declaration.startDate} au ${declaration.endDate}.`,
        absenceDeclarationId: declaration.id,
      },
    );

    return this.findAccessibleOne(id, authenticatedUser);
  }

  async registerByRh(
    id: number,
    authenticatedUser: AuthenticatedUser,
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

    declaration.status = AbsenceDeclarationStatus.ENREGISTREE;
    declaration.verifiedByRhId = authenticatedUser.id;
    declaration.verifiedAt = new Date();

    await this.absenceDeclarationRepository.save(declaration);

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
          message: `L’absence de ${declaration.employee.prenom} ${declaration.employee.nom} du ${declaration.startDate} au ${declaration.endDate} a été autorisée.`,
          absenceDeclarationId: declaration.id,
        },
      );
    }

    return this.findOneWithRelations(id);
  }

  async deleteDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
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
    const declaration = await this.findAccessibleOne(
      id,
      authenticatedUser,
    );

    if (declaration.status === AbsenceDeclarationStatus.ANNULEE) {
      throw new BadRequestException(
        'Cette déclaration est déjà annulée.',
      );
    }

    if (
      authenticatedUser.role !== UserRole.RH &&
      declaration.status === AbsenceDeclarationStatus.ENREGISTREE
    ) {
      throw new ForbiddenException(
        'Une absence déjà enregistrée doit être annulée par la RH.',
      );
    }

    const cancelledByRh =
      authenticatedUser.role === UserRole.RH &&
      declaration.employeeId !== authenticatedUser.id;

    declaration.status = AbsenceDeclarationStatus.ANNULEE;

    await this.absenceDeclarationRepository.save(declaration);

    await this.presenceService.refreshUserStatus(
      declaration.employeeId,
    );

    if (cancelledByRh) {
      await this.notificationsService.create({
        userId: declaration.employeeId,
        type: 'ABSENCE_DECLARATION_REFUSED',
        title: 'Absence refusée',
        message: `Votre absence du ${declaration.startDate} au ${declaration.endDate} a été annulée par la RH.`,
        absenceDeclarationId: declaration.id,
      });

      if (declaration.serviceId) {
        await this.notificationsService.createForServiceManagers(
          declaration.serviceId,
          {
            type: 'ABSENCE_DECLARATION_DECISION_INFO',
            title: 'Absence refusée dans votre service',
            message: `L’absence de ${declaration.employee.prenom} ${declaration.employee.nom} du ${declaration.startDate} au ${declaration.endDate} a été refusée.`,
            absenceDeclarationId: declaration.id,
          },
        );
      }
    }

    return this.findAccessibleOne(id, authenticatedUser);
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

    declaration.status =
      AbsenceDeclarationStatus.JUSTIFICATIF_REJETE;
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

    if (leaveType.rhOnly && actorRole !== UserRole.RH) {
      throw new ForbiddenException(
        'Ce type d’absence peut être saisi uniquement par la RH.',
      );
    }

    if (!leaveType.employeeCanCreate && actorRole !== UserRole.RH) {
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

  private async ensureNoPersonalOverlap(input: {
    employeeId: number;
    startDate: string;
    endDate: string;
    ignoredAbsenceId: number | null;
  }): Promise<void> {
    const ignoredLeaveStatuses = [
      LeaveRequestStatus.REFUSEE,
      LeaveRequestStatus.ANNULEE,
      LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
      LeaveRequestStatus.EXPIREE_NON_VALIDEE,
    ];

    const overlappingLeave = await this.leaveRequestRepository
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
      .andWhere('leaveRequest.status NOT IN (:...ignoredStatuses)', {
        ignoredStatuses: ignoredLeaveStatuses,
      })
      .orderBy('leaveRequest.startDate', 'ASC')
      .getOne();

    if (overlappingLeave) {
      throw new BadRequestException(
        `Cette absence chevauche la demande de congé n°${overlappingLeave.id} du ${overlappingLeave.startDate} au ${overlappingLeave.endDate}.`,
      );
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

    const overlappingAbsence = await qb
      .orderBy('absence.startDate', 'ASC')
      .getOne();

    if (overlappingAbsence) {
      throw new BadRequestException(
        `Cette absence chevauche la déclaration n°${overlappingAbsence.id} du ${overlappingAbsence.startDate} au ${overlappingAbsence.endDate}.`,
      );
    }
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

    return declaration;
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

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
