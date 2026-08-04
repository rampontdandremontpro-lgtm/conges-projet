import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Service, ServiceType } from './service.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
  ) {}

  async create(createServiceDto: CreateServiceDto): Promise<Service> {
    const name = createServiceDto.name.trim();

    const existingService = await this.serviceRepository.findOneBy({
      name,
    });

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

    const service = this.serviceRepository.create({
      name,
      serviceType: createServiceDto.serviceType,
      externalCompanyName:
        createServiceDto.serviceType === ServiceType.EXTERNE
          ? createServiceDto.externalCompanyName?.trim()
          : null,
      hasMinimumPresenceRule,
      minimumPresence,
      isActive: true,
    });

    return this.serviceRepository.save(service);
  }

  async findAll(): Promise<Service[]> {
    return this.serviceRepository.find({
      order: {
        serviceType: 'ASC',
        name: 'ASC',
      },
    });
  }

  async findOne(id: number): Promise<Service> {
    const service = await this.serviceRepository.findOneBy({ id });

    if (!service) {
      throw new NotFoundException(`Le service ${id} est introuvable.`);
    }

    return service;
  }

  async update(
    id: number,
    updateServiceDto: UpdateServiceDto,
  ): Promise<Service> {
    const service = await this.findOne(id);

    const name = updateServiceDto.name?.trim() ?? service.name;

    const existingService = await this.serviceRepository.findOne({
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

    this.validateExternalService(serviceType, externalCompanyName);

    const hasMinimumPresenceRule =
      updateServiceDto.hasMinimumPresenceRule ??
      service.hasMinimumPresenceRule;

    const minimumPresence = hasMinimumPresenceRule
      ? (updateServiceDto.minimumPresence ?? service.minimumPresence)
      : 0;

    this.validateMinimumPresence(
      hasMinimumPresenceRule,
      minimumPresence,
    );

    service.name = name;
    service.serviceType = serviceType;
    service.externalCompanyName = externalCompanyName;
    service.hasMinimumPresenceRule = hasMinimumPresenceRule;
    service.minimumPresence = minimumPresence;

    if (updateServiceDto.isActive !== undefined) {
      service.isActive = updateServiceDto.isActive;
    }

    return this.serviceRepository.save(service);
  }

  async disable(id: number): Promise<Service> {
    const service = await this.findOne(id);

    service.isActive = false;

    return this.serviceRepository.save(service);
  }

  async enable(id: number): Promise<Service> {
    const service = await this.findOne(id);

    service.isActive = true;

    return this.serviceRepository.save(service);
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