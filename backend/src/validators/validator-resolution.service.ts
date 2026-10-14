import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  Derogation,
  DerogationStatus,
} from '../derogations/derogation.entity';
import {
  LeaveRequestStatus,
  type LeaveRequest,
} from '../leave-requests/leave-request.entity';
import { PresenceService } from '../presence/presence.service';
import {
  ServiceType,
  ValidationMode,
} from '../services/service.entity';
import {
  EmploymentType,
  PresenceStatus,
  User,
  UserRole,
} from '../users/user.entity';
import { ServiceBackupValidator } from './service-backup-validator.entity';
import { ValidatorReplacement } from './validator-replacement.entity';
import {
  getValidatorTakeoverAt,
  isValidatorTakeoverDelayExpired,
} from './validator-delay.util';

export type DecisionAccessKind =
  | 'RESPONSABLE_PRINCIPAL'
  | 'DIRECTEUR_RH'
  | 'DIRECTEUR_SEUL'
  | 'RELAIS'
  | 'URGENCE'
  | 'REMPLACEMENT'
  | 'SECOURS'
  | 'RH_FINALISATION'
  | 'RH_PREMIERE_VALIDATION'
  | 'DIRECTEUR_FINALISATION'
  | 'RESPONSABLE_FINALISATION';

export interface DecisionAccess {
  kind: DecisionAccessKind;
  reason: string | null;
}

export type ValidationTreatmentKind =
  | 'RESPONSABLE_SERVICE'
  | 'VALIDATEUR_TEMPORAIRE'
  | 'VALIDATEUR_SECOURS_DIRECTEUR'
  | 'RELAIS_DIRECTEUR'
  | 'DIRECTEUR_RH'
  | 'DIRECTEUR_SEUL'
  | 'SANS_VALIDATION'
  | 'RH_FINALISATION'
  | 'RH_DIRECTEUR'
  | 'RH_RESPONSABLE';

export interface ValidationTreatment {
  kind: ValidationTreatmentKind;
  reason: string | null;
}

export type LeaveRequestCircuitKind =
  | 'RH_DIRECTEUR'
  | 'RESPONSABLE_RH'
  | 'RH_RESPONSABLE';

export interface LeaveRequestCircuit {
  kind: LeaveRequestCircuitKind;
  firstLevelRole: UserRole;
  secondLevelRole: UserRole;
}

export interface ValidatorResolution {
  primaryManagerId: number | null;
  replacement: ValidatorReplacement | null;
  firstLevelId: number | null;
  firstLevelEligible: boolean;
  firstLevelPresent: boolean;
  firstLevelBelongsToService: boolean;
  delayExpired: boolean;
  backupValidatorIds: number[];
}

export interface ResolutionOptions {
  manager?: EntityManager;
  now?: Date;
  emergencyTakeover?: boolean;
  takeoverReason?: string;
}

const ELIGIBLE_VALIDATOR_ROLES = [
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
];

function martiniqueDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

@Injectable()
export class ValidatorResolutionService {
  constructor(
    @InjectRepository(ServiceBackupValidator)
    private readonly backupRepository: Repository<ServiceBackupValidator>,

    @InjectRepository(ValidatorReplacement)
    private readonly replacementRepository: Repository<ValidatorReplacement>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Derogation)
    private readonly derogationRepository: Repository<Derogation>,

    private readonly presenceService: PresenceService,
  ) {}

  async resolveCircuit(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<LeaveRequestCircuit | null> {
    if (
      !leaveRequest.service ||
      leaveRequest.employee.role !== UserRole.COLLABORATEUR ||
      leaveRequest.service.serviceType === ServiceType.EXTERNE
    ) {
      return null;
    }

    // Pour un collaborateur GMES interne, les quatre règles validées
    // priment sur tout ancien mode : aucun mode DIRECTEUR_SEUL ou
    // SANS_VALIDATION ne doit permettre de contourner l'ordre RH → Directeur
    // ou Responsable → RH / RH → Responsable.
    const hasResponsible = await this.hasResponsibleManager(
      leaveRequest,
      options,
    );
    const hasDerogation = await this.hasActiveDerogation(
      leaveRequest,
      options,
    );

    if (hasResponsible) {
      return hasDerogation
        ? {
            kind: 'RH_RESPONSABLE',
            firstLevelRole: UserRole.RH,
            secondLevelRole: UserRole.RESPONSABLE_SERVICE,
          }
        : {
            kind: 'RESPONSABLE_RH',
            firstLevelRole: UserRole.RESPONSABLE_SERVICE,
            secondLevelRole: UserRole.RH,
          };
    }

    return {
      kind: 'RH_DIRECTEUR',
      firstLevelRole: UserRole.RH,
      secondLevelRole: UserRole.DIRECTEUR,
    };
  }

  private async hasResponsibleManager(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<boolean> {
    if (!leaveRequest.service) {
      return false;
    }

    const resolution = await this.buildResolution(
      leaveRequest,
      options,
    );

    return Boolean(
      resolution.firstLevelId !== null &&
        resolution.firstLevelEligible &&
        resolution.firstLevelBelongsToService,
    );
  }

  private async hasActiveDerogation(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<boolean> {
    const manager = options.manager;
    const repository = manager
      ? manager.getRepository(Derogation)
      : this.derogationRepository;

    const derogation = await repository.findOne({
      where: { leaveRequestId: leaveRequest.id },
    });

    if (!derogation) {
      return false;
    }

    return [
      DerogationStatus.EN_ATTENTE_RH,
      DerogationStatus.ACCORDEE,
      DerogationStatus.UTILISEE,
    ].includes(derogation.status);
  }

  private async getActiveUsersByRole(
    role: UserRole,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    const manager = options.manager;
    const repository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const users = await repository.find({
      where: { role, isActive: true },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  async buildResolution(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<ValidatorResolution> {
    if (!leaveRequest.service) {
      throw new BadRequestException(
        'Le service de cette demande a été supprimé. Cette demande ne peut plus être traitée.',
      );
    }
    const manager = options.manager;
    const now = options.now ?? new Date();
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const backupRepository = manager
      ? manager.getRepository(ServiceBackupValidator)
      : this.backupRepository;
    const replacementRepository = manager
      ? manager.getRepository(ValidatorReplacement)
      : this.replacementRepository;

    const service = leaveRequest.service;
    const employee = leaveRequest.employee;
    const primaryManagerId = service.primaryManagerId;

    let replacement: ValidatorReplacement | null = null;
    if (
      service.validationMode === ValidationMode.RESPONSABLE_PUIS_RELAIS &&
      employee.role === UserRole.COLLABORATEUR &&
      employee.employmentType === EmploymentType.INTERNE
    ) {
      const activeDate = martiniqueDate(now);
      replacement = await replacementRepository.findOne({
        where: {
          employeeId: employee.id,
          isActive: true,
          startDate: LessThanOrEqual(activeDate),
          endDate: MoreThanOrEqual(activeDate),
        },
      });
    }

    let firstLevelId: number | null =
      replacement !== null
        ? replacement.replacementValidatorId
        : primaryManagerId;

    let firstLevelUser: User | null = null;
    if (firstLevelId != null) {
      firstLevelUser = await userRepository.findOneBy({
        id: firstLevelId,
      });
    }

    const replacementOperative =
      replacement !== null &&
      firstLevelUser != null &&
      firstLevelUser.isActive &&
      ELIGIBLE_VALIDATOR_ROLES.includes(firstLevelUser.role);

    if (replacement !== null && !replacementOperative) {
      replacement = null;
      firstLevelId = primaryManagerId;
      firstLevelUser = null;
      if (firstLevelId != null) {
        firstLevelUser = await userRepository.findOneBy({
          id: firstLevelId,
        });
      }
    }

    const eligibleRoles =
      replacement !== null
        ? ELIGIBLE_VALIDATOR_ROLES
        : [UserRole.RESPONSABLE_SERVICE];

    const firstLevelEligible = Boolean(
      firstLevelUser &&
        firstLevelUser.isActive &&
        eligibleRoles.includes(firstLevelUser.role),
    );

    const firstLevelPresent =
      firstLevelEligible &&
      (await this.presenceService.computeStatus(
        firstLevelId as number,
        undefined,
        manager,
        now,
      )) === PresenceStatus.PRESENT;
    const firstLevelBelongsToService =
      firstLevelUser != null &&
      (replacement !== null ||
        firstLevelUser.serviceId === leaveRequest.serviceId);

    const submittedAt =
      leaveRequest.submittedAt ?? leaveRequest.createdAt;
    const delayExpired = isValidatorTakeoverDelayExpired(
      submittedAt,
      service.takeoverDelayDays,
      now,
    );

    let backupValidatorIds: number[] = [];
    if (
      service.validationMode ===
      ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
      const backups = await backupRepository.find({
        where: { serviceId: service.id, isActive: true },
        relations: { validator: true },
      });
      backupValidatorIds = backups
        .filter(
          (backup) =>
            backup.isActive &&
            backup.validator != null &&
            backup.validator.isActive &&
            ELIGIBLE_VALIDATOR_ROLES.includes(backup.validator.role),
        )
        .map((backup) => backup.validatorId);
    }

    return {
      primaryManagerId,
      replacement,
      firstLevelId,
      firstLevelEligible,
      firstLevelPresent,
      firstLevelBelongsToService,
      delayExpired,
      backupValidatorIds,
    };
  }

  async getDecisionRecipientIds(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    const manager = options.manager;
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;

    if (!leaveRequest.service) {
      // Service supprimé : la RH reste destinataire de la traçabilité.
      const rhUsers = await userRepository.find({
        where: { role: UserRole.RH, isActive: true },
        select: { id: true },
      });
      return rhUsers.map((user) => user.id);
    }
    const service = leaveRequest.service;

    if (
      leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
      leaveRequest.finalDeciderId !== null
    ) {
      const circuit = await this.resolveCircuit(
        leaveRequest,
        options,
      );
      if (circuit) {
        return this.getSecondLevelRecipientIds(
          leaveRequest,
          circuit,
          options,
        );
      }

      const rhUsers = await userRepository.find({
        where: { role: UserRole.RH, isActive: true },
        select: { id: true },
      });
      return rhUsers.map((user) => user.id);
    }

    if (leaveRequest.employee.role === UserRole.RH) {
      const directors = await userRepository.find({
        where: { role: UserRole.DIRECTEUR, isActive: true },
        select: { id: true },
      });
      return directors.map((user) => user.id);
    }

    if (leaveRequest.employee.role === UserRole.RESPONSABLE_SERVICE) {
      const validators = await userRepository.find({
        where: {
          role: In([UserRole.RH, UserRole.DIRECTEUR]),
          isActive: true,
        },
        select: { id: true },
      });
      return validators
        .map((user) => user.id)
        .filter((userId) => userId !== leaveRequest.employeeId);
    }

    const circuit = await this.resolveCircuit(
      leaveRequest,
      options,
    );
    if (circuit) {
      return this.getFirstLevelRecipientIds(
        leaveRequest,
        circuit,
        options,
      );
    }

    if (
      service.validationMode === ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
      return this.getManagerRecipientIds(leaveRequest, options);
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

  private async getManagerRecipientIds(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    const manager = options.manager;
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;
    const resolution = await this.buildResolution(
      leaveRequest,
      options,
    );
    if (
      resolution.firstLevelId !== null &&
      resolution.firstLevelEligible &&
      resolution.firstLevelPresent &&
      !resolution.delayExpired
    ) {
      return [resolution.firstLevelId];
    }
    const recipientIds = new Set<number>(
      resolution.backupValidatorIds,
    );
    const directors = await userRepository.find({
      where: {
        role: UserRole.DIRECTEUR,
        isActive: true,
      },
      select: { id: true },
    });
    for (const director of directors) {
      recipientIds.add(director.id);
    }
    return [...recipientIds];
  }

  private async getResponsableRecipientIds(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    const resolution = await this.buildResolution(
      leaveRequest,
      options,
    );
    if (
      resolution.firstLevelId !== null &&
      resolution.firstLevelEligible &&
      resolution.firstLevelPresent &&
      !resolution.delayExpired
    ) {
      return [resolution.firstLevelId];
    }
    return [...resolution.backupValidatorIds];
  }

  private async getFirstLevelRecipientIds(
    leaveRequest: LeaveRequest,
    circuit: LeaveRequestCircuit,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    switch (circuit.kind) {
      case 'RH_DIRECTEUR':
      case 'RH_RESPONSABLE':
        return this.getActiveUsersByRole(UserRole.RH, options);
      case 'RESPONSABLE_RH':
        return this.getManagerRecipientIds(
          leaveRequest,
          options,
        );
    }
  }

  private async getSecondLevelRecipientIds(
    leaveRequest: LeaveRequest,
    circuit: LeaveRequestCircuit,
    options: ResolutionOptions = {},
  ): Promise<number[]> {
    switch (circuit.kind) {
      case 'RH_DIRECTEUR':
        return this.getActiveUsersByRole(UserRole.DIRECTEUR, options);
      case 'RESPONSABLE_RH':
        return this.getActiveUsersByRole(UserRole.RH, options);
      case 'RH_RESPONSABLE':
        return this.getResponsableRecipientIds(
          leaveRequest,
          options,
        );
    }
  }

  async describeTreatment(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<ValidationTreatment> {
    if (!leaveRequest.service) {
      if (
        leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION
      ) {
        return { kind: 'RH_FINALISATION', reason: null };
      }
      return { kind: 'SANS_VALIDATION', reason: null };
    }
    if (
      leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
      leaveRequest.finalDeciderId !== null
    ) {
      const circuit = await this.resolveCircuit(
        leaveRequest,
        options,
      );
      if (circuit?.kind === 'RH_DIRECTEUR') {
        return { kind: 'RH_DIRECTEUR', reason: null };
      }
      if (circuit?.kind === 'RH_RESPONSABLE') {
        return { kind: 'RH_RESPONSABLE', reason: null };
      }
      return { kind: 'RH_FINALISATION', reason: null };
    }

    if (leaveRequest.employee.role === UserRole.RH) {
      return { kind: 'DIRECTEUR_SEUL', reason: null };
    }

    if (leaveRequest.employee.role === UserRole.RESPONSABLE_SERVICE) {
      return { kind: 'DIRECTEUR_RH', reason: null };
    }

    if (leaveRequest.service.serviceType === ServiceType.EXTERNE) {
      return { kind: 'DIRECTEUR_RH', reason: null };
    }

    const circuit = await this.resolveCircuit(
      leaveRequest,
      options,
    );
    if (circuit?.kind === 'RH_DIRECTEUR') {
      return { kind: 'RH_DIRECTEUR', reason: null };
    }
    if (circuit?.kind === 'RH_RESPONSABLE') {
      return { kind: 'RH_RESPONSABLE', reason: null };
    }

    switch (leaveRequest.service.validationMode) {
      case ValidationMode.DIRECTEUR_ET_RH:
        return { kind: 'DIRECTEUR_RH', reason: null };

      case ValidationMode.DIRECTEUR_SEUL:
        return { kind: 'DIRECTEUR_SEUL', reason: null };

      case ValidationMode.SANS_VALIDATION:
        return { kind: 'SANS_VALIDATION', reason: null };

      case ValidationMode.RESPONSABLE_PUIS_RELAIS: {
        const resolution = await this.buildResolution(
          leaveRequest,
          options,
        );

        if (
          resolution.firstLevelId !== null &&
          resolution.firstLevelEligible &&
          resolution.firstLevelPresent &&
          !resolution.delayExpired
        ) {
          return resolution.replacement !== null
            ? { kind: 'VALIDATEUR_TEMPORAIRE', reason: null }
            : { kind: 'RESPONSABLE_SERVICE', reason: null };
        }

        if (resolution.backupValidatorIds.length > 0) {
          return {
            kind: 'VALIDATEUR_SECOURS_DIRECTEUR',
            reason: resolution.delayExpired
              ? `Le délai de ${leaveRequest.service.takeoverDelayDays} jour(s) est expiré.`
              : 'Le valideur de premier niveau est indisponible.',
          };
        }

        return {
          kind: 'RELAIS_DIRECTEUR',
          reason: resolution.delayExpired
            ? `Le délai de ${leaveRequest.service.takeoverDelayDays} jour(s) est expiré.`
            : 'Le valideur de premier niveau est indisponible.',
        };
      }

      default:
        return { kind: 'SANS_VALIDATION', reason: null };
    }
  }

  async resolveAccess(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    options: ResolutionOptions = {},
  ): Promise<DecisionAccess> {
    if (leaveRequest.employeeId === authenticatedUser.id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas traiter votre propre demande.',
      );
    }

    // Cas métier : le service a été supprimé. Seule la RH peut prendre la
    // décision finale sur une demande encore en attente de validation.
    if (!leaveRequest.service) {
      if (
        leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
        authenticatedUser.role === UserRole.RH
      ) {
        return { kind: 'RH_FINALISATION', reason: null };
      }

      throw new ForbiddenException(
        'Le service de cette demande a été supprimé. Seule la RH peut traiter cette demande.',
      );
    }

    if (
      leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
      leaveRequest.finalDeciderId !== null
    ) {
      const circuit = await this.resolveCircuit(
        leaveRequest,
        options,
      );
      if (circuit) {
        return this.resolveSecondLevelAccess(
          leaveRequest,
          authenticatedUser,
          circuit,
          options,
        );
      }

      if (authenticatedUser.role !== UserRole.RH) {
        throw new ForbiddenException(
          'Cette demande a déjà été validée au premier niveau et doit maintenant être finalisée par la RH.',
        );
      }

      return {
        kind: 'RH_FINALISATION',
        reason: null,
      };
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
      leaveRequest.employee.role === UserRole.RESPONSABLE_SERVICE
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

    const circuit = await this.resolveCircuit(
      leaveRequest,
      options,
    );
    if (circuit) {
      return this.resolveFirstLevelAccess(
        leaveRequest,
        authenticatedUser,
        circuit,
        options,
      );
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
        return this.resolveManagerFirstAccess(
          leaveRequest,
          authenticatedUser,
          options,
        );

      default:
        throw new BadRequestException(
          'Le circuit de validation du service est invalide.',
        );
    }
  }

  async isResponsableAuthorizedForRequest(
    leaveRequest: LeaveRequest,
    userId: number,
    options: ResolutionOptions = {},
  ): Promise<boolean> {
    if (!leaveRequest.service) {
      throw new BadRequestException(
        'Le service de cette demande a été supprimé. Cette demande ne peut plus être traitée.',
      );
    }

    const circuit = await this.resolveCircuit(
      leaveRequest,
      options,
    );

    if (
      leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
      leaveRequest.finalDeciderId !== null
    ) {
      if (circuit?.kind === 'RH_RESPONSABLE') {
        const resolution = await this.buildResolution(
          leaveRequest,
          options,
        );
        if (
          resolution.firstLevelId === userId &&
          resolution.firstLevelEligible
        ) {
          return true;
        }
        return resolution.backupValidatorIds.includes(userId);
      }
      return false;
    }

    // Premier niveau avec dérogation : la RH traite la dérogation en premier,
    // le Responsable n'intervient qu'au second niveau.
    if (circuit?.kind === 'RH_RESPONSABLE') {
      return false;
    }

    const resolution = await this.buildResolution(leaveRequest, options);

    if (resolution.replacement !== null) {
      if (resolution.firstLevelId === userId) {
        return (
          resolution.firstLevelEligible &&
          resolution.firstLevelPresent
        );
      }
      const relayOpen =
        !resolution.firstLevelEligible ||
        !resolution.firstLevelPresent ||
        resolution.delayExpired;
      return (
        relayOpen &&
        resolution.backupValidatorIds.includes(userId)
      );
    }

    if (leaveRequest.service.primaryManagerId === userId) {
      return true;
    }

    const relayOpen =
      !resolution.firstLevelEligible ||
      !resolution.firstLevelBelongsToService ||
      !resolution.firstLevelPresent ||
      resolution.delayExpired;

    return (
      relayOpen && resolution.backupValidatorIds.includes(userId)
    );
  }

  private async resolveFirstLevelAccess(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    circuit: LeaveRequestCircuit,
    options: ResolutionOptions,
  ): Promise<DecisionAccess> {
    switch (circuit.kind) {
      case 'RH_DIRECTEUR':
      case 'RH_RESPONSABLE':
        if (authenticatedUser.role !== UserRole.RH) {
          throw new ForbiddenException(
            'Cette demande doit d’abord être traitée par la RH.',
          );
        }
        return {
          kind: 'RH_PREMIERE_VALIDATION',
          reason: null,
        };

      case 'RESPONSABLE_RH':
        return this.resolveManagerFirstAccess(
          leaveRequest,
          authenticatedUser,
          options,
        );
    }
  }

  private async resolveSecondLevelAccess(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    circuit: LeaveRequestCircuit,
    options: ResolutionOptions,
  ): Promise<DecisionAccess> {
    switch (circuit.kind) {
      case 'RH_DIRECTEUR':
        if (authenticatedUser.role !== UserRole.DIRECTEUR) {
          throw new ForbiddenException(
            'Cette demande doit maintenant être finalisée par le Directeur.',
          );
        }
        return {
          kind: 'DIRECTEUR_FINALISATION',
          reason: null,
        };

      case 'RESPONSABLE_RH':
        if (authenticatedUser.role !== UserRole.RH) {
          throw new ForbiddenException(
            'Cette demande doit maintenant être finalisée par la RH.',
          );
        }
        return {
          kind: 'RH_FINALISATION',
          reason: null,
        };

      case 'RH_RESPONSABLE': {
        const resolution = await this.buildResolution(
          leaveRequest,
          options,
        );
        if (
          resolution.firstLevelId === authenticatedUser.id &&
          resolution.firstLevelEligible
        ) {
          return {
            kind: 'RESPONSABLE_FINALISATION',
            reason: null,
          };
        }
        if (
          resolution.backupValidatorIds.includes(
            authenticatedUser.id,
          )
        ) {
          return {
            kind: 'SECOURS',
            reason: 'Le Responsable principal est indisponible.',
          };
        }
        throw new ForbiddenException(
          'Cette demande doit être finalisée par le Responsable du service.',
        );
      }
    }
  }

  private async resolveManagerFirstAccess(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    options: ResolutionOptions,
  ): Promise<DecisionAccess> {
    if (!leaveRequest.service) {
      throw new BadRequestException(
        'Le service de cette demande a été supprimé. Cette demande ne peut plus être traitée.',
      );
    }
    const resolution = await this.buildResolution(
      leaveRequest,
      options,
    );

    if (
      resolution.replacement !== null &&
      resolution.firstLevelId === authenticatedUser.id
    ) {
      if (
        resolution.firstLevelEligible &&
        resolution.firstLevelPresent
      ) {
        return {
          kind: 'REMPLACEMENT',
          reason: null,
        };
      }
    }

    if (authenticatedUser.role === UserRole.RESPONSABLE_SERVICE) {
      if (resolution.replacement !== null) {
        if (
          leaveRequest.service.primaryManagerId ===
          authenticatedUser.id
        ) {
          throw new ForbiddenException(
            'Cette demande est traitée par le remplaçant désigné pendant la période de remplacement.',
          );
        }

        const relayOpen =
          !resolution.firstLevelEligible ||
          !resolution.firstLevelPresent ||
          resolution.delayExpired;

        if (
          relayOpen &&
          resolution.backupValidatorIds.includes(
            authenticatedUser.id,
          )
        ) {
          return {
            kind: 'SECOURS',
            reason:
              'Le remplaçant désigné est absent ou indisponible.',
          };
        }

        throw new ForbiddenException(
          'Cette demande relève du remplaçant désigné pour ce collaborateur.',
        );
      }

      if (
        leaveRequest.service.primaryManagerId ===
        authenticatedUser.id
      ) {
        return {
          kind: 'RESPONSABLE_PRINCIPAL',
          reason: null,
        };
      }

      const relayOpen =
        !resolution.firstLevelEligible ||
        !resolution.firstLevelBelongsToService ||
        !resolution.firstLevelPresent ||
        resolution.delayExpired;

      if (
        relayOpen &&
        resolution.backupValidatorIds.includes(
          authenticatedUser.id,
        )
      ) {
        return {
          kind: 'SECOURS',
          reason:
            'Le Responsable principal est absent ou indisponible.',
        };
      }

      throw new ForbiddenException(
        'Cette demande relève du Responsable principal du service.',
      );
    }

    const firstLevelUnavailable =
      !resolution.firstLevelEligible ||
      !resolution.firstLevelBelongsToService ||
      !resolution.firstLevelPresent;

    const relayOpen =
      firstLevelUnavailable || resolution.delayExpired;

    if (authenticatedUser.role === UserRole.RH) {
      if (
        relayOpen &&
        resolution.backupValidatorIds.includes(authenticatedUser.id)
      ) {
        return {
          kind: 'SECOURS',
          reason: resolution.delayExpired
            ? `Le délai de ${leaveRequest.service.takeoverDelayDays} jour(s) calendaires accordé au valideur de premier niveau est expiré.`
            : 'Le valideur de premier niveau est absent ou indisponible.',
        };
      }

      throw new ForbiddenException(
        'Pour ce service, la RH ne peut traiter la demande que si elle est désignée comme valideur temporaire ou valideur de secours.',
      );
    }

    if (authenticatedUser.role !== UserRole.DIRECTEUR) {
      throw new ForbiddenException(
        'Cette demande relève du Responsable principal du service.',
      );
    }

    if (firstLevelUnavailable) {
      return {
        kind: 'RELAIS',
        reason:
          'Le valideur de premier niveau est absent ou indisponible.',
      };
    }

    const submittedAt =
      leaveRequest.submittedAt ?? leaveRequest.createdAt;
    const takeoverAt = getValidatorTakeoverAt(
      submittedAt,
      leaveRequest.service.takeoverDelayDays,
    );

    if (resolution.delayExpired) {
      return {
        kind: 'RELAIS',
        reason: `Le délai de ${leaveRequest.service.takeoverDelayDays} jour(s) calendaires accordé au valideur de premier niveau est expiré.`,
      };
    }

    if (options.emergencyTakeover) {
      const takeoverReason = options.takeoverReason?.trim();

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
      `Le valideur de premier niveau reste prioritaire jusqu’au ${takeoverAt.toISOString()}. Une intervention anticipée du Directeur doit être déclarée comme urgente et motivée.`,
    );
  }
}
