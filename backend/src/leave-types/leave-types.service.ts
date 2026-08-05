import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import {
  LeaveAccrualMode,
  LeaveType,
  LeaveTypeCategory,
} from './leave-type.entity';

@Injectable()
export class LeaveTypesService {
  constructor(
    @InjectRepository(LeaveType)
    private readonly leaveTypeRepository: Repository<LeaveType>,
  ) {}

  async create(
    createLeaveTypeDto: CreateLeaveTypeDto,
  ): Promise<LeaveType> {
    const name = createLeaveTypeDto.name.trim();

    const existingLeaveType =
      await this.leaveTypeRepository.findOneBy({ name });

    if (existingLeaveType) {
      throw new ConflictException(
        `Un type portant le nom « ${name} » existe déjà.`,
      );
    }

    const values = this.resolveValues(createLeaveTypeDto);

    this.validateBusinessRules(values);

    const leaveType = this.leaveTypeRepository.create({
      name,
      ...values,
      isActive: true,
    });

    return this.leaveTypeRepository.save(leaveType);
  }

  async findAllActive(): Promise<LeaveType[]> {
    return this.leaveTypeRepository.find({
      where: { isActive: true },
      order: {
        category: 'ASC',
        name: 'ASC',
      },
    });
  }

  async findAllForManagement(): Promise<LeaveType[]> {
    return this.leaveTypeRepository.find({
      order: {
        category: 'ASC',
        name: 'ASC',
      },
    });
  }

  async findOne(id: number): Promise<LeaveType> {
    const leaveType = await this.leaveTypeRepository.findOneBy({ id });

    if (!leaveType) {
      throw new NotFoundException(
        `Le type de congé ou d’absence ${id} est introuvable.`,
      );
    }

    return leaveType;
  }

  async update(
    id: number,
    updateLeaveTypeDto: UpdateLeaveTypeDto,
  ): Promise<LeaveType> {
    const leaveType = await this.findOne(id);
    const name = updateLeaveTypeDto.name?.trim() ?? leaveType.name;

    const existingLeaveType = await this.leaveTypeRepository.findOne({
      where: {
        name,
        id: Not(id),
      },
    });

    if (existingLeaveType) {
      throw new ConflictException(
        `Un type portant le nom « ${name} » existe déjà.`,
      );
    }

    const values = this.resolveValues(
      updateLeaveTypeDto,
      leaveType,
    );

    this.validateBusinessRules(values);

    leaveType.name = name;
    leaveType.category = values.category;
    leaveType.deductsPaidLeaveBalance =
      values.deductsPaidLeaveBalance;
    leaveType.documentRequired = values.documentRequired;
    leaveType.documentCanBeAddedLater =
      values.documentCanBeAddedLater;
    leaveType.employeeCanCreate = values.employeeCanCreate;
    leaveType.rhOnly = values.rhOnly;
    leaveType.allowsDays = values.allowsDays;
    leaveType.allowsHalfDays = values.allowsHalfDays;
    leaveType.allowsHours = values.allowsHours;
    leaveType.requiresValidation = values.requiresValidation;
    leaveType.accrualMode = values.accrualMode;
    leaveType.monthlyAccrualDays = values.monthlyAccrualDays;

    if (updateLeaveTypeDto.isActive !== undefined) {
      leaveType.isActive = updateLeaveTypeDto.isActive;
    }

    return this.leaveTypeRepository.save(leaveType);
  }

  async disable(id: number): Promise<LeaveType> {
    const leaveType = await this.findOne(id);
    leaveType.isActive = false;

    return this.leaveTypeRepository.save(leaveType);
  }

  async enable(id: number): Promise<LeaveType> {
    const leaveType = await this.findOne(id);
    leaveType.isActive = true;

    return this.leaveTypeRepository.save(leaveType);
  }

  private resolveValues(
    dto: CreateLeaveTypeDto | UpdateLeaveTypeDto,
    current?: LeaveType,
  ) {
    const category = dto.category ?? current?.category;

    if (!category) {
      throw new BadRequestException(
        'La catégorie du type est obligatoire.',
      );
    }

    const accrualMode =
      dto.accrualMode ??
      current?.accrualMode ??
      LeaveAccrualMode.NORMALE;

    let monthlyAccrualDays =
      dto.monthlyAccrualDays ??
      current?.monthlyAccrualDays ??
      2.5;

    if (accrualMode === LeaveAccrualMode.AUCUNE) {
      monthlyAccrualDays = 0;
    }

    return {
      category,
      deductsPaidLeaveBalance:
        dto.deductsPaidLeaveBalance ??
        current?.deductsPaidLeaveBalance ??
        false,
      documentRequired:
        dto.documentRequired ?? current?.documentRequired ?? false,
      documentCanBeAddedLater:
        dto.documentCanBeAddedLater ??
        current?.documentCanBeAddedLater ??
        false,
      employeeCanCreate:
        dto.employeeCanCreate ?? current?.employeeCanCreate ?? true,
      rhOnly: dto.rhOnly ?? current?.rhOnly ?? false,
      allowsDays: dto.allowsDays ?? current?.allowsDays ?? true,
      allowsHalfDays:
        dto.allowsHalfDays ?? current?.allowsHalfDays ?? false,
      allowsHours: dto.allowsHours ?? current?.allowsHours ?? false,
      requiresValidation:
        dto.requiresValidation ?? current?.requiresValidation ?? true,
      accrualMode,
      monthlyAccrualDays,
    };
  }

  private validateBusinessRules(values: {
    category: LeaveTypeCategory;
    deductsPaidLeaveBalance: boolean;
    documentRequired: boolean;
    documentCanBeAddedLater: boolean;
    employeeCanCreate: boolean;
    rhOnly: boolean;
    allowsDays: boolean;
    allowsHalfDays: boolean;
    allowsHours: boolean;
    requiresValidation: boolean;
    accrualMode: LeaveAccrualMode;
    monthlyAccrualDays: number;
  }): void {
    if (
      !values.allowsDays &&
      !values.allowsHalfDays &&
      !values.allowsHours
    ) {
      throw new BadRequestException(
        'Le type doit autoriser les jours, les demi-journées ou les heures.',
      );
    }

    if (values.rhOnly && values.employeeCanCreate) {
      throw new BadRequestException(
        'Un type réservé à la RH ne peut pas être créé par un collaborateur.',
      );
    }

    if (
      values.documentCanBeAddedLater &&
      !values.documentRequired
    ) {
      throw new BadRequestException(
        'Le dépôt différé ne peut être activé que pour un justificatif obligatoire.',
      );
    }

    if (
      values.deductsPaidLeaveBalance &&
      values.category !== LeaveTypeCategory.CONGE
    ) {
      throw new BadRequestException(
        'Seul un type de congé peut diminuer le solde de congés payés.',
      );
    }

    if (
      values.deductsPaidLeaveBalance &&
      !values.requiresValidation
    ) {
      throw new BadRequestException(
        'Un type diminuant le solde doit nécessiter une validation.',
      );
    }

    if (
      values.accrualMode === LeaveAccrualMode.NORMALE &&
      values.monthlyAccrualDays !== 2.5
    ) {
      throw new BadRequestException(
        'Une acquisition normale doit correspondre à 2,5 jours par mois.',
      );
    }

    if (
      values.accrualMode === LeaveAccrualMode.REDUITE &&
      (values.monthlyAccrualDays <= 0 ||
        values.monthlyAccrualDays >= 2.5)
    ) {
      throw new BadRequestException(
        'Une acquisition réduite doit être supérieure à 0 et inférieure à 2,5 jours.',
      );
    }

    if (
      values.accrualMode === LeaveAccrualMode.AUCUNE &&
      values.monthlyAccrualDays !== 0
    ) {
      throw new BadRequestException(
        'Une acquisition suspendue doit correspondre à 0 jour.',
      );
    }
  }
}
