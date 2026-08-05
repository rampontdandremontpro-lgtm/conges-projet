import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import {
  PresenceStatus,
  User,
  UserRole,
} from '../users/user.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import {
  Service,
  ServiceType,
  ValidationMode,
} from './service.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(
    createServiceDto: CreateServiceDto,
  ): Promise<Service> {
    const name = createServiceDto.name.trim();

    const existingService =
      await this.serviceRepository.findOneBy({ name });

    if (existingService) {
      throw new ConflictException(
        `Un service portant le nom « ${name} » existe déjà.`,
      );
    }

    this.validateExternalService(
      createServiceDto.serviceType,
      createServiceDto.externalCompanyName,
    );

    const hasMinimumPresenceRule =
      createServiceDto.hasMinimumPresenceRule ?? false;

    const minimumPresence = hasMinimumPresenceRule
      ? (createServiceDto.minimumPresence ?? 0)
      : 0;

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
      externalCompanyName:
        createServiceDto.serviceType === ServiceType.EXTERNE
          ? createServiceDto.externalCompanyName?.trim()
          : null,
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

    const existingService =
      await this.serviceRepository.findOne({
        where: {
          name,
          id: Not(id),
        },
      });

    if (existingService) {
      throw new ConflictException(
        `Un service portant le nom « ${name} » existe déjà.`,
      );
    }

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

    const hasMinimumPresenceRule =
      updateServiceDto.hasMinimumPresenceRule ??
      service.hasMinimumPresenceRule;

    const minimumPresence = hasMinimumPresenceRule
      ? (updateServiceDto.minimumPresence ??
        service.minimumPresence)
      : 0;

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
        manager.presenceStatus === PresenceStatus.PRESENT,
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
    minimumPresence: number,
  ): void {
    if (hasMinimumPresenceRule && minimumPresence < 1) {
      throw new BadRequestException(
        'La présence minimale doit être supérieure ou égale à 1 lorsque la règle est activée.',
      );
    }
  }
}
