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
import type { LeaveRequest } from '../leave-requests/leave-request.entity';
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

export type DecisionAccessKind =
  | 'RESPONSABLE_PRINCIPAL'
  | 'DIRECTEUR_RH'
  | 'DIRECTEUR_SEUL'
  | 'RELAIS'
  | 'URGENCE'
  | 'REMPLACEMENT'
  | 'SECOURS';

export interface DecisionAccess {
  kind: DecisionAccessKind;
  reason: string | null;
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

function martiniqueDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
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

    private readonly presenceService: PresenceService,
  ) {}

  async buildResolution(
    leaveRequest: LeaveRequest,
    options: ResolutionOptions = {},
  ): Promise<ValidatorResolution> {
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

    const firstLevelId =
      replacement !== null
        ? replacement.replacementValidatorId
        : primaryManagerId;

    let firstLevelUser: User | null = null;
    if (firstLevelId !== null && firstLevelId !== undefined) {
      firstLevelUser = await userRepository.findOneBy({
        id: firstLevelId,
      });
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
    const takeoverAt = new Date(
      submittedAt.getTime() +
        service.takeoverDelayDays * 24 * 60 * 60 * 1000,
    );
    const delayExpired = now.getTime() >= takeoverAt.getTime();

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
    const service = leaveRequest.service;

    if (leaveRequest.employee.role === UserRole.RH) {
      const directors = await userRepository.find({
        where: { role: UserRole.DIRECTEUR, isActive: true },
        select: { id: true },
      });
      return directors.map((user) => user.id);
    }

    if (
      service.validationMode === ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
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
      const relays = await userRepository.find({
        where: {
          role: In([UserRole.RH, UserRole.DIRECTEUR]),
          isActive: true,
        },
        select: { id: true },
      });
      for (const relay of relays) {
        recipientIds.add(relay.id);
      }
      return [...recipientIds];
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
    const resolution = await this.buildResolution(leaveRequest, options);

    if (resolution.replacement !== null) {
      if (resolution.firstLevelId === userId) {
        return (
          resolution.firstLevelEligible &&
          resolution.firstLevelPresent &&
          !resolution.delayExpired
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

  private async resolveManagerFirstAccess(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
    options: ResolutionOptions,
  ): Promise<DecisionAccess> {
    const resolution = await this.buildResolution(
      leaveRequest,
      options,
    );

    if (authenticatedUser.role === UserRole.RESPONSABLE_SERVICE) {
      if (resolution.replacement !== null) {
        if (resolution.firstLevelId === authenticatedUser.id) {
          if (
            resolution.firstLevelEligible &&
            resolution.firstLevelPresent &&
            !resolution.delayExpired
          ) {
            return {
              kind: 'REMPLACEMENT',
              reason: null,
            };
          }
        }

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

    if (
      authenticatedUser.role !== UserRole.DIRECTEUR &&
      authenticatedUser.role !== UserRole.RH
    ) {
      throw new ForbiddenException(
        'Cette demande relève du Responsable principal du service.',
      );
    }

    const firstLevelUnavailable =
      !resolution.firstLevelEligible ||
      !resolution.firstLevelBelongsToService ||
      !resolution.firstLevelPresent;

    if (firstLevelUnavailable) {
      return {
        kind: 'RELAIS',
        reason:
          'Le valideur de premier niveau est absent ou indisponible.',
      };
    }

    const submittedAt =
      leaveRequest.submittedAt ?? leaveRequest.createdAt;
    const takeoverAt = new Date(
      submittedAt.getTime() +
        leaveRequest.service.takeoverDelayDays *
          24 *
          60 *
          60 *
          1000,
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
      `Le valideur de premier niveau reste prioritaire jusqu’au ${takeoverAt.toISOString()}. Une intervention anticipée du Directeur ou de la RH doit être déclarée comme urgente et motivée.`,
    );
  }
}
