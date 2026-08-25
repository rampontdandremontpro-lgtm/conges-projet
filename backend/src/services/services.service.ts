import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  PresenceStatus,
  User,
  UserRole,
} from '../users/user.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { PresenceService } from '../presence/presence.service';
import {
  Service,
  ServiceType,
  ValidationMode,
} from './service.entity';

@Injectable()
export class ServicesService implements OnModuleInit {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly presenceService: PresenceService,

    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consolidateRhServices();
  }

  private async consolidateRhServices(): Promise<void> {
    const normalizeName = (value: string): string =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('fr-FR');

    const services = await this.serviceRepository.find();
    const canonicalCandidates = services.filter(
      (service) => normalizeName(service.name) === 'equipe rh',
    );
    const legacyServices = services.filter((service) =>
      ['ressource humaines', 'ressources humaines'].includes(
        normalizeName(service.name),
      ),
    );

    if (canonicalCandidates.length === 0 && legacyServices.length === 0) {
      return;
    }

    let canonical = canonicalCandidates[0] ?? legacyServices.shift()!;
    let canonicalChanged = false;
    if (canonical.name !== 'Equipe RH') {
      canonical.name = 'Equipe RH';
      canonicalChanged = true;
    }
    if (!canonical.isActive) {
      canonical.isActive = true;
      canonicalChanged = true;
    }
    if (canonicalChanged) {
      canonical = await this.serviceRepository.save(canonical);
    }

    const duplicates = [
      ...canonicalCandidates.filter((service) => service.id !== canonical.id),
      ...legacyServices.filter((service) => service.id !== canonical.id),
    ];

    if (duplicates.length === 0) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      for (const duplicate of duplicates) {
        const duplicateId = Number(duplicate.id);
        const canonicalId = Number(canonical.id);

        await manager.query(
          'UPDATE users SET service_id = ? WHERE service_id = ?',
          [canonicalId, duplicateId],
        );
        await manager.query(
          'UPDATE leave_requests SET service_id = ? WHERE service_id = ?',
          [canonicalId, duplicateId],
        );
        await manager.query(
          'UPDATE absence_declarations SET service_id = ? WHERE service_id = ?',
          [canonicalId, duplicateId],
        );

        await manager.query(
          `INSERT IGNORE INTO service_backup_validators
            (service_id, validator_id, is_active, created_at, updated_at)
           SELECT ?, validator_id, is_active, created_at, updated_at
           FROM service_backup_validators
           WHERE service_id = ?`,
          [canonicalId, duplicateId],
        );
        await manager.query(
          'DELETE FROM service_backup_validators WHERE service_id = ?',
          [duplicateId],
        );

        if (!canonical.primaryManagerId && duplicate.primaryManagerId) {
          await manager.query(
            'UPDATE services SET primary_manager_id = ? WHERE id = ?',
            [duplicate.primaryManagerId, canonicalId],
          );
          canonical.primaryManagerId = duplicate.primaryManagerId;
        }

        await manager.query('DELETE FROM services WHERE id = ?', [duplicateId]);
      }
    });
  }

  async create(
    createServiceDto: CreateServiceDto,
  ): Promise<Service> {
    const name = createServiceDto.name.trim();

    this.validateExternalService(
      createServiceDto.serviceType,
      createServiceDto.externalCompanyName,
    );

    const externalCompanyName =
      createServiceDto.serviceType === ServiceType.EXTERNE
        ? createServiceDto.externalCompanyName?.trim() ?? null
        : null;

    const existingService = await this.findDuplicateService(
      name,
      externalCompanyName,
    );

    if (existingService) {
      throw new ConflictException(
        `Un service portant le nom « ${name} » existe déjà pour cette entreprise.`,
      );
    }

    const hasMinimumPresenceRule =
      createServiceDto.hasMinimumPresenceRule ?? false;

    const minimumPresence = hasMinimumPresenceRule
      ? (createServiceDto.minimumPresence ?? 1)
      : null;

    this.validateMinimumPresence(
      hasMinimumPresenceRule,
      minimumPresence,
    );

    const validationMode =
      createServiceDto.validationMode ??
      ValidationMode.DIRECTEUR_ET_RH;

    if (
      validationMode ===
      ValidationMode.RESPONSABLE_PUIS_RELAIS
    ) {
      throw new BadRequestException(
        'Crée d’abord le service et son Responsable, puis configure le mode RESPONSABLE_PUIS_RELAIS lors de la modification du service.',
      );
    }

    this.validateValidationConfiguration(
      validationMode,
      null,
      createServiceDto.serviceType,
    );

    const service = this.serviceRepository.create({
      name,
      serviceType: createServiceDto.serviceType,
      externalCompanyName,
      primaryManagerId: null,
      primaryManager: null,
      validationMode,
      takeoverDelayDays:
        createServiceDto.takeoverDelayDays ?? 7,
      hasMinimumPresenceRule,
      minimumPresence,
      isActive: true,
    });

    const savedService =
      await this.serviceRepository.save(service);

    return this.findOne(savedService.id);
  }

  async findAll(): Promise<Service[]> {
    return this.serviceRepository.find({
      relations: {
        primaryManager: true,
      },
      order: {
        serviceType: 'ASC',
        name: 'ASC',
      },
    });
  }

  async findOne(id: number): Promise<Service> {
    const service = await this.serviceRepository.findOne({
      where: { id },
      relations: {
        primaryManager: true,
      },
    });

    if (!service) {
      throw new NotFoundException(
        `Le service ${id} est introuvable.`,
      );
    }

    return service;
  }

  async update(
    id: number,
    updateServiceDto: UpdateServiceDto,
  ): Promise<Service> {
    const service = await this.findOne(id);

    const name =
      updateServiceDto.name?.trim() ?? service.name;

    const serviceType =
      updateServiceDto.serviceType ?? service.serviceType;

    const externalCompanyName =
      serviceType === ServiceType.EXTERNE
        ? (
            updateServiceDto.externalCompanyName ??
            service.externalCompanyName
          )?.trim() ?? null
        : null;

    this.validateExternalService(
      serviceType,
      externalCompanyName,
    );

    const existingService = await this.findDuplicateService(
      name,
      externalCompanyName,
      id,
    );

    if (existingService) {
      throw new ConflictException(
        `Un service portant le nom « ${name} » existe déjà pour cette entreprise.`,
      );
    }

    const hasMinimumPresenceRule =
      updateServiceDto.hasMinimumPresenceRule ??
      service.hasMinimumPresenceRule;

    const minimumPresence = hasMinimumPresenceRule
      ? (updateServiceDto.minimumPresence ??
        service.minimumPresence ??
        1)
      : null;

    this.validateMinimumPresence(
      hasMinimumPresenceRule,
      minimumPresence,
    );

    const validationMode =
      updateServiceDto.validationMode ??
      service.validationMode;

    let primaryManager = service.primaryManager ?? null;
    let primaryManagerId = service.primaryManagerId;

    if (updateServiceDto.primaryManagerId === null) {
      primaryManager = null;
      primaryManagerId = null;
    } else if (
      updateServiceDto.primaryManagerId !== undefined
    ) {
      primaryManager = await this.findValidPrimaryManager(
        updateServiceDto.primaryManagerId,
        service.id,
      );
      primaryManagerId = primaryManager.id;
    }

    if (serviceType === ServiceType.EXTERNE) {
      primaryManager = null;
      primaryManagerId = null;
    }

    this.validateValidationConfiguration(
      validationMode,
      primaryManagerId,
      serviceType,
    );

    service.name = name;
    service.serviceType = serviceType;
    service.externalCompanyName = externalCompanyName;
    service.primaryManagerId = primaryManagerId;
    service.primaryManager = primaryManager;
    service.validationMode = validationMode;
    service.takeoverDelayDays =
      updateServiceDto.takeoverDelayDays ??
      service.takeoverDelayDays;
    service.hasMinimumPresenceRule =
      hasMinimumPresenceRule;
    service.minimumPresence = minimumPresence;

    if (updateServiceDto.isActive !== undefined) {
      service.isActive = updateServiceDto.isActive;
    }

    await this.serviceRepository.save(service);

    return this.findOne(id);
  }

  async disable(id: number): Promise<Service> {
    const service = await this.findOne(id);

    service.isActive = false;

    await this.serviceRepository.save(service);

    return this.findOne(id);
  }

  async enable(id: number): Promise<Service> {
    const service = await this.findOne(id);

    service.isActive = true;

    await this.serviceRepository.save(service);

    return this.findOne(id);
  }

  async isPrimaryManagerAvailable(
    serviceId: number,
  ): Promise<boolean> {
    const service = await this.findOne(serviceId);

    if (!service.primaryManagerId) {
      return false;
    }

    const manager = await this.userRepository.findOneBy({
      id: service.primaryManagerId,
    });

    return Boolean(
      manager &&
        manager.isActive &&
        manager.role === UserRole.RESPONSABLE_SERVICE &&
        manager.serviceId === service.id &&
        (await this.presenceService.computeStatus(manager.id)) ===
          PresenceStatus.PRESENT,
    );
  }

  private async findValidPrimaryManager(
    userId: number,
    serviceId: number,
  ): Promise<User> {
    const manager = await this.userRepository.findOneBy({
      id: userId,
    });

    if (!manager) {
      throw new NotFoundException(
        `Le Responsable ${userId} est introuvable.`,
      );
    }

    if (!manager.isActive) {
      throw new BadRequestException(
        'Le Responsable principal sélectionné est désactivé.',
      );
    }

    if (manager.role !== UserRole.RESPONSABLE_SERVICE) {
      throw new BadRequestException(
        'Le valideur principal doit posséder le rôle RESPONSABLE_SERVICE.',
      );
    }

    if (manager.serviceId !== serviceId) {
      throw new BadRequestException(
        'Le Responsable principal doit appartenir au service concerné.',
      );
    }

    return manager;
  }

  private async findDuplicateService(
    name: string,
    externalCompanyName: string | null,
    excludedId?: number,
  ): Promise<Service | null> {
    const query = this.serviceRepository
      .createQueryBuilder('service')
      .where('LOWER(service.name) = LOWER(:name)', { name });

    if (externalCompanyName === null) {
      query.andWhere('service.externalCompanyName IS NULL');
    } else {
      query.andWhere(
        'LOWER(service.externalCompanyName) = LOWER(:externalCompanyName)',
        { externalCompanyName },
      );
    }

    if (excludedId !== undefined) {
      query.andWhere('service.id <> :excludedId', { excludedId });
    }

    return query.getOne();
  }

  private validateValidationConfiguration(
    validationMode: ValidationMode,
    primaryManagerId: number | null,
    serviceType: ServiceType,
  ): void {
    if (
      validationMode ===
        ValidationMode.RESPONSABLE_PUIS_RELAIS &&
      !primaryManagerId
    ) {
      throw new BadRequestException(
        'Un Responsable principal est obligatoire pour le mode RESPONSABLE_PUIS_RELAIS.',
      );
    }

    if (
      serviceType === ServiceType.EXTERNE &&
      validationMode !== ValidationMode.DIRECTEUR_ET_RH
    ) {
      throw new BadRequestException(
        'Un service externe doit utiliser le circuit DIRECTEUR_ET_RH.',
      );
    }
  }

  private validateExternalService(
    serviceType: ServiceType,
    externalCompanyName?: string | null,
  ): void {
    if (
      serviceType === ServiceType.EXTERNE &&
      !externalCompanyName?.trim()
    ) {
      throw new BadRequestException(
        'Le nom de l’entreprise externe est obligatoire pour un service externe.',
      );
    }
  }

  private validateMinimumPresence(
    hasMinimumPresenceRule: boolean,
    minimumPresence: number | null,
  ): void {
    if (
      hasMinimumPresenceRule &&
      (minimumPresence === null || minimumPresence < 1)
    ) {
      throw new BadRequestException(
        'La présence minimale doit être supérieure ou égale à 1 lorsque la règle est activée.',
      );
    }
  }
}
