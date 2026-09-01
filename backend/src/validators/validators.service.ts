import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { Service, ValidationMode } from '../services/service.entity';
import {
  EmploymentType,
  User,
  UserRole,
} from '../users/user.entity';
import { CreateValidatorReplacementDto } from './dto/create-validator-replacement.dto';
import { ValidatorReplacementQueryDto } from './dto/validator-replacement-query.dto';
import { ServiceBackupValidator } from './service-backup-validator.entity';
import { ValidatorReplacement } from './validator-replacement.entity';

const ELIGIBLE_VALIDATOR_ROLES = [
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
];

const VALIDATOR_PAGE_ROLES = [
  UserRole.COLLABORATEUR,
  ...ELIGIBLE_VALIDATOR_ROLES,
];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value: string): string {
  const normalized = value.slice(0, 10);
  if (!DATE_ONLY_PATTERN.test(normalized)) {
    throw new BadRequestException(
      'Les dates doivent être au format YYYY-MM-DD.',
    );
  }
  return normalized;
}

@Injectable()
export class ValidatorsService {
  constructor(
    @InjectRepository(ServiceBackupValidator)
    private readonly backupRepository: Repository<ServiceBackupValidator>,

    @InjectRepository(ValidatorReplacement)
    private readonly replacementRepository: Repository<ValidatorReplacement>,

    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly auditService: AuditService,
  ) {}

  async listValidatorUsers() {
    const users = await this.userRepository.find({
      where: {
        isActive: true,
        role: In(VALIDATOR_PAGE_ROLES),
      },
      relations: { service: true },
      order: { nom: 'ASC', prenom: 'ASC', id: 'ASC' },
    });

    return users.map((user) => ({
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
      employmentType: user.employmentType,
      isActive: user.isActive,
      serviceId: user.serviceId,
      service: user.service
        ? {
            id: user.service.id,
            name: user.service.name,
            serviceType: user.service.serviceType,
            externalCompanyName: user.service.externalCompanyName,
          }
        : null,
    }));
  }

  async getServiceValidators(serviceId: number) {
    const service = await this.serviceRepository.findOneBy({
      id: serviceId,
    });
    if (!service) {
      throw new NotFoundException(
        `Le service ${serviceId} est introuvable.`,
      );
    }

    const primaryManager =
      service.primaryManagerId === null ||
      service.primaryManagerId === undefined
        ? null
        : await this.userRepository.findOneBy({
            id: service.primaryManagerId,
          });

    const backups = await this.backupRepository.find({
      where: { serviceId },
      relations: { validator: true },
      order: { id: 'ASC' },
    });

    return {
      serviceId: service.id,
      serviceName: service.name,
      serviceType: service.serviceType,
      validationMode: service.validationMode,
      takeoverDelayDays: service.takeoverDelayDays,
      primaryManagerId: service.primaryManagerId,
      primaryManager: primaryManager
        ? {
            id: primaryManager.id,
            nom: primaryManager.nom,
            prenom: primaryManager.prenom,
            email: primaryManager.email,
            role: primaryManager.role,
          }
        : null,
      backupValidators: backups.map((backup) => ({
        id: backup.id,
        validatorId: backup.validatorId,
        validator: backup.validator
          ? {
              id: backup.validator.id,
              nom: backup.validator.nom,
              prenom: backup.validator.prenom,
              email: backup.validator.email,
              role: backup.validator.role,
            }
          : null,
        isActive: backup.isActive,
        createdAt: backup.createdAt,
        updatedAt: backup.updatedAt,
      })),
    };
  }

  async assignBackupValidator(
    serviceId: number,
    validatorId: number,
    actor: AuthenticatedUser,
  ): Promise<ServiceBackupValidator> {
    const service = await this.serviceRepository.findOneBy({
      id: serviceId,
    });
    if (!service) {
      throw new NotFoundException(
        `Le service ${serviceId} est introuvable.`,
      );
    }

    if (
      service.validationMode !==
      ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
      throw new BadRequestException(
        'Les valideurs de secours ne sont disponibles que pour les services avec validation par Responsable puis relais.',
      );
    }

    if (service.primaryManagerId === validatorId) {
      throw new BadRequestException(
        'Le Responsable principal du service ne peut pas être désigné comme son propre valideur de secours.',
      );
    }

    const validator = await this.userRepository.findOneBy({
      id: validatorId,
    });
    if (!validator || !validator.isActive) {
      throw new BadRequestException(
        'Le valideur de secours doit être un utilisateur actif.',
      );
    }

    if (!ELIGIBLE_VALIDATOR_ROLES.includes(validator.role)) {
      throw new BadRequestException(
        'Le valideur de secours doit être un Responsable de service, un RH ou un Directeur.',
      );
    }

    const existing = await this.backupRepository.findOne({
      where: { serviceId, validatorId },
    });

    if (existing) {
      if (existing.isActive) {
        throw new ConflictException(
          'Ce valideur est déjà désigné comme valideur de secours de ce service.',
        );
      }
      existing.isActive = true;
      const saved = await this.backupRepository.save(existing);
      await this.auditService.record({
        actorId: actor.id,
        action: AuditAction.SERVICE_BACKUP_VALIDATOR_ENABLED,
        resourceType: 'SERVICES',
        resourceId: serviceId,
        oldValue: { isActive: false },
        newValue: {
          validatorId,
          isActive: true,
          actorRole: actor.role,
        },
      });
      return saved;
    }

    const backup = this.backupRepository.create({
      serviceId,
      validatorId,
      isActive: true,
    });
    const saved = await this.backupRepository.save(backup);
    await this.auditService.record({
      actorId: actor.id,
      action: AuditAction.SERVICE_BACKUP_VALIDATOR_ASSIGNED,
      resourceType: 'SERVICES',
      resourceId: serviceId,
      oldValue: null,
      newValue: {
        validatorId,
        isActive: true,
        actorRole: actor.role,
      },
    });
    return saved;
  }

  async disableBackupValidator(
    serviceId: number,
    validatorId: number,
    actor: AuthenticatedUser,
  ): Promise<ServiceBackupValidator> {
    const backup = await this.backupRepository.findOne({
      where: { serviceId, validatorId },
    });
    if (!backup) {
      throw new NotFoundException(
        'Cette association de valideur de secours est introuvable.',
      );
    }

    if (!backup.isActive) {
      return backup;
    }

    backup.isActive = false;
    const saved = await this.backupRepository.save(backup);
    await this.auditService.record({
      actorId: actor.id,
      action: AuditAction.SERVICE_BACKUP_VALIDATOR_DISABLED,
      resourceType: 'SERVICES',
      resourceId: serviceId,
      oldValue: { validatorId, isActive: true },
      newValue: {
        validatorId,
        isActive: false,
        actorRole: actor.role,
      },
    });
    return saved;
  }

  async enableBackupValidator(
    serviceId: number,
    validatorId: number,
    actor: AuthenticatedUser,
  ): Promise<ServiceBackupValidator> {
    const backup = await this.backupRepository.findOne({
      where: { serviceId, validatorId },
    });
    if (!backup) {
      throw new NotFoundException(
        'Cette association de valideur de secours est introuvable.',
      );
    }

    if (backup.isActive) {
      return backup;
    }

    const service = await this.serviceRepository.findOneBy({
      id: serviceId,
    });
    if (!service) {
      throw new BadRequestException(
        'Le service est introuvable, la réactivation est impossible.',
      );
    }
    if (
      service.validationMode !==
      ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
      throw new BadRequestException(
        'Les valideurs de secours ne sont disponibles que pour les services avec validation par Responsable puis relais.',
      );
    }
    if (service.primaryManagerId === validatorId) {
      throw new BadRequestException(
        'Le Responsable principal du service ne peut pas être désigné comme son propre valideur de secours.',
      );
    }
    const validator = await this.userRepository.findOneBy({
      id: validatorId,
    });
    if (!validator || !validator.isActive) {
      throw new BadRequestException(
        'Le valideur de secours doit être un utilisateur actif.',
      );
    }
    if (!ELIGIBLE_VALIDATOR_ROLES.includes(validator.role)) {
      throw new BadRequestException(
        'Le valideur de secours doit être un Responsable de service, un RH ou un Directeur.',
      );
    }

    backup.isActive = true;
    const saved = await this.backupRepository.save(backup);
    await this.auditService.record({
      actorId: actor.id,
      action: AuditAction.SERVICE_BACKUP_VALIDATOR_ENABLED,
      resourceType: 'SERVICES',
      resourceId: serviceId,
      oldValue: { validatorId, isActive: false },
      newValue: {
        validatorId,
        isActive: true,
        actorRole: actor.role,
      },
    });
    return saved;
  }

  async createReplacement(
    dto: CreateValidatorReplacementDto,
    actor: AuthenticatedUser,
  ): Promise<ValidatorReplacement> {
    const employee = await this.userRepository.findOneBy({
      id: dto.employeeId,
    });
    if (!employee || !employee.isActive) {
      throw new BadRequestException(
        'Le collaborateur concerné doit être un utilisateur actif.',
      );
    }
    if (employee.role !== UserRole.COLLABORATEUR) {
      throw new BadRequestException(
        'Le remplacement temporaire ne concerne que les collaborateurs.',
      );
    }
    if (employee.employmentType !== EmploymentType.INTERNE) {
      throw new BadRequestException(
        'Le remplacement temporaire ne concerne que les collaborateurs internes.',
      );
    }

    const replacement = await this.userRepository.findOneBy({
      id: dto.replacementValidatorId,
    });
    if (!replacement || !replacement.isActive) {
      throw new BadRequestException(
        'Le remplaçant doit être un utilisateur actif.',
      );
    }
    if (!ELIGIBLE_VALIDATOR_ROLES.includes(replacement.role)) {
      throw new BadRequestException(
        'Le remplaçant doit être un Responsable de service, un RH ou un Directeur.',
      );
    }
    if (employee.id === replacement.id) {
      throw new BadRequestException(
        'Le collaborateur et le remplaçant doivent être différents.',
      );
    }

    const startDate = dateOnly(dto.startDate);
    const endDate = dateOnly(dto.endDate);
    if (startDate > endDate) {
      throw new BadRequestException(
        'La date de début doit être antérieure ou égale à la date de fin.',
      );
    }

    const overlapping = await this.replacementRepository.findOne({
      where: {
        employeeId: employee.id,
        isActive: true,
        startDate: LessThanOrEqual(endDate),
        endDate: MoreThanOrEqual(startDate),
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        'Un remplacement actif chevauche déjà cette période pour ce collaborateur.',
      );
    }

    const entity = this.replacementRepository.create({
      employeeId: employee.id,
      replacementValidatorId: replacement.id,
      startDate,
      endDate,
      reason: dto.reason?.trim() || null,
      createdByRhId: actor.id,
      isActive: true,
    });
    const saved = await this.replacementRepository.save(entity);
    await this.auditService.record({
      actorId: actor.id,
      action: AuditAction.VALIDATOR_REPLACEMENT_CREATED,
      resourceType: 'VALIDATOR_REPLACEMENTS',
      resourceId: saved.id,
      oldValue: null,
      newValue: {
        employeeId: employee.id,
        replacementValidatorId: replacement.id,
        startDate,
        endDate,
        reason: entity.reason,
        actorRole: actor.role,
      },
    });
    return saved;
  }

  async listReplacements(
    query: ValidatorReplacementQueryDto,
  ): Promise<ValidatorReplacement[]> {
    const where: FindOptionsWhere<ValidatorReplacement> = {};

    if (query.employeeId !== undefined) {
      where.employeeId = query.employeeId;
    }
    if (query.replacementValidatorId !== undefined) {
      where.replacementValidatorId = query.replacementValidatorId;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.activeAt !== undefined) {
      const activeDate = dateOnly(query.activeAt);
      where.startDate = LessThanOrEqual(activeDate);
      where.endDate = MoreThanOrEqual(activeDate);
    }

    return this.replacementRepository.find({
      where,
      relations: {
        employee: true,
        replacementValidator: true,
        createdByRh: true,
      },
      order: { startDate: 'DESC', id: 'DESC' },
    });
  }

  async findReplacement(
    id: number,
  ): Promise<ValidatorReplacement> {
    const replacement =
      await this.replacementRepository.findOne({
        where: { id },
        relations: {
          employee: true,
          replacementValidator: true,
          createdByRh: true,
        },
      });
    if (!replacement) {
      throw new NotFoundException(
        `Le remplacement temporaire ${id} est introuvable.`,
      );
    }
    return replacement;
  }

  async disableReplacement(
    id: number,
    actor: AuthenticatedUser,
  ): Promise<ValidatorReplacement> {
    const replacement =
      await this.replacementRepository.findOneBy({ id });
    if (!replacement) {
      throw new NotFoundException(
        `Le remplacement temporaire ${id} est introuvable.`,
      );
    }

    if (!replacement.isActive) {
      return replacement;
    }

    replacement.isActive = false;
    const saved = await this.replacementRepository.save(replacement);
    await this.auditService.record({
      actorId: actor.id,
      action: AuditAction.VALIDATOR_REPLACEMENT_DISABLED,
      resourceType: 'VALIDATOR_REPLACEMENTS',
      resourceId: id,
      oldValue: {
        employeeId: replacement.employeeId,
        replacementValidatorId: replacement.replacementValidatorId,
        isActive: true,
      },
      newValue: {
        employeeId: replacement.employeeId,
        replacementValidatorId: replacement.replacementValidatorId,
        isActive: false,
        actorRole: actor.role,
      },
    });
    return saved;
  }
}
