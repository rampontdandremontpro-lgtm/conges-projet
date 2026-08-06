import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { ServiceType } from '../services/service.entity';
import { ServicesService } from '../services/services.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  EmploymentType,
  PresenceStatus,
  User,
} from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly servicesService: ServicesService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const email = createUserDto.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findOneBy({ email });

    if (existingUser) {
      throw new ConflictException(
        `Un utilisateur possédant l’adresse « ${email} » existe déjà.`,
      );
    }

    const service = await this.servicesService.findOne(
      createUserDto.serviceId,
    );

    if (!service.isActive) {
      throw new BadRequestException(
        'Le service sélectionné est désactivé.',
      );
    }

    this.validateEmploymentType(
      createUserDto.employmentType,
      service.serviceType,
    );

    const user = this.userRepository.create({
      nom: createUserDto.nom.trim(),
      prenom: createUserDto.prenom.trim(),
      email,
      passwordHash: null,
      microsoftId: createUserDto.microsoftId?.trim() || null,
      role: createUserDto.role,
      employmentType: createUserDto.employmentType,
      hireDate: createUserDto.hireDate,
      presenceStatus: PresenceStatus.PRESENT,
      isActive: true,
      serviceId: service.id,
      service,
      signatureType: null,
      signatureData: null,
      signatureUpdatedAt: null,
    });

    const savedUser = await this.userRepository.save(user);
    return this.findOne(savedUser.id);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: { service: true },
      order: { nom: 'ASC', prenom: 'ASC' },
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { service: true },
    });

    if (!user) {
      throw new NotFoundException(
        `L’utilisateur ${id} est introuvable.`,
      );
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: { service: true },
    });
  }

  async findByEmailWithPassword(
    email: string,
  ): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.service', 'service')
      .where('LOWER(user.email) = LOWER(:email)', {
        email: email.trim(),
      })
      .getOne();
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    const result = await this.userRepository.update(
      { id },
      { passwordHash },
    );

    if (!result.affected) {
      throw new NotFoundException(
        `L’utilisateur ${id} est introuvable.`,
      );
    }
  }

  async update(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<User> {
    const user = await this.findOne(id);
    const email =
      updateUserDto.email?.trim().toLowerCase() ?? user.email;

    const existingUser = await this.userRepository.findOne({
      where: { email, id: Not(id) },
    });

    if (existingUser) {
      throw new ConflictException(
        `Un utilisateur possédant l’adresse « ${email} » existe déjà.`,
      );
    }

    let service = user.service;

    if (
      updateUserDto.serviceId !== undefined &&
      updateUserDto.serviceId !== user.serviceId
    ) {
      service = await this.servicesService.findOne(
        updateUserDto.serviceId,
      );

      if (!service.isActive) {
        throw new BadRequestException(
          'Le service sélectionné est désactivé.',
        );
      }
    }

    const employmentType =
      updateUserDto.employmentType ?? user.employmentType;

    this.validateEmploymentType(employmentType, service.serviceType);

    user.nom = updateUserDto.nom?.trim() ?? user.nom;
    user.prenom = updateUserDto.prenom?.trim() ?? user.prenom;
    user.email = email;
    user.role = updateUserDto.role ?? user.role;
    user.employmentType = employmentType;
    user.hireDate = updateUserDto.hireDate ?? user.hireDate;
    user.serviceId = service.id;
    user.service = service;

    if (updateUserDto.microsoftId !== undefined) {
      user.microsoftId = updateUserDto.microsoftId.trim() || null;
    }

    if (updateUserDto.isActive !== undefined) {
      user.isActive = updateUserDto.isActive;
    }

    await this.userRepository.save(user);
    return this.findOne(id);
  }

  async disable(id: number): Promise<User> {
    const user = await this.findOne(id);
    user.isActive = false;
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  async enable(id: number): Promise<User> {
    const user = await this.findOne(id);
    user.isActive = true;
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  private validateEmploymentType(
    employmentType: EmploymentType,
    serviceType: ServiceType,
  ): void {
    if (
      employmentType === EmploymentType.INTERNE &&
      serviceType !== ServiceType.INTERNE
    ) {
      throw new BadRequestException(
        'Un collaborateur interne doit appartenir à un service interne.',
      );
    }

    if (
      employmentType === EmploymentType.EXTERNE &&
      serviceType !== ServiceType.EXTERNE
    ) {
      throw new BadRequestException(
        'Un collaborateur externe doit appartenir à un service externe.',
      );
    }
  }
}
