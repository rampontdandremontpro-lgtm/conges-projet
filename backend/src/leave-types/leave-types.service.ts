import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveType, LeaveTypeCategory } from './leave-type.entity';

const REQUIRED_ABSENCE_TYPES = [
  'Congé supplémentaire de naissance',
  'Congé parental',
  'Congé parental d’éducation',
  'Congé d’adoption',
] as const;

@Injectable()
export class LeaveTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(LeaveType)
    private readonly leaveTypeRepository: Repository<LeaveType>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureRequiredAbsenceTypes();
  }

  async create(dto: CreateLeaveTypeDto): Promise<LeaveType> {
    const name = dto.name.trim();
    const existing = await this.leaveTypeRepository.findOneBy({ name });

    if (existing) {
      throw new ConflictException(
        `Un type portant le nom « ${name} » existe déjà.`,
      );
    }

    const values = this.resolveValues(dto);
    this.validateBusinessRules(values);

    return this.leaveTypeRepository.save(
      this.leaveTypeRepository.create({
        name,
        ...values,
        isActive: true,
      }),
    );
  }

  async findAllActive(): Promise<LeaveType[]> {
    return this.leaveTypeRepository.find({
      where: { isActive: true },
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  async findAllForManagement(): Promise<LeaveType[]> {
    return this.leaveTypeRepository.find({
      order: { category: 'ASC', name: 'ASC' },
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

  async update(id: number, dto: UpdateLeaveTypeDto): Promise<LeaveType> {
    const leaveType = await this.findOne(id);
    const name = dto.name?.trim() ?? leaveType.name;
    const existing = await this.leaveTypeRepository.findOne({
      where: { name, id: Not(id) },
    });

    if (existing) {
      throw new ConflictException(
        `Un type portant le nom « ${name} » existe déjà.`,
      );
    }

    const values = this.resolveValues(dto, leaveType);
    this.validateBusinessRules(values);

    Object.assign(leaveType, { name, ...values });

    if (dto.isActive !== undefined) {
      leaveType.isActive = dto.isActive;
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

  private async ensureRequiredAbsenceTypes(): Promise<void> {
    for (const name of REQUIRED_ABSENCE_TYPES) {
      const existing = await this.leaveTypeRepository.findOneBy({ name });
      if (existing) {
        continue;
      }

      await this.leaveTypeRepository.save(
        this.leaveTypeRepository.create({
          name,
          category: LeaveTypeCategory.DECLARATION_ABSENCE,
          deductsPaidLeaveBalance: false,
          documentRequired: false,
          documentCanBeAddedLater: false,
          employeeCanCreate: false,
          rhOnly: true,
          allowsDays: true,
          allowsHalfDays: false,
          allowsHours: false,
          requiresValidation: false,
          isActive: true,
        }),
      );
    }
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
        true,
      employeeCanCreate:
        dto.employeeCanCreate ?? current?.employeeCanCreate ?? true,
      rhOnly: dto.rhOnly ?? current?.rhOnly ?? false,
      allowsDays: dto.allowsDays ?? current?.allowsDays ?? true,
      allowsHalfDays:
        dto.allowsHalfDays ?? current?.allowsHalfDays ?? true,
      allowsHours: dto.allowsHours ?? current?.allowsHours ?? false,
      requiresValidation:
        dto.requiresValidation ?? current?.requiresValidation ?? true,
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
  }): void {
    if (!values.allowsDays && !values.allowsHalfDays && !values.allowsHours) {
      throw new BadRequestException(
        'Le type doit autoriser les jours, les demi-journées ou les heures.',
      );
    }

    if (values.rhOnly && values.employeeCanCreate) {
      throw new BadRequestException(
        'Un type réservé à la RH ne peut pas être créé par un collaborateur.',
      );
    }

    if (values.documentCanBeAddedLater && !values.documentRequired) {
      throw new BadRequestException(
        'Le dépôt différé ne peut être activé que pour un justificatif obligatoire.',
      );
    }

    if (
      values.deductsPaidLeaveBalance &&
      values.category !== LeaveTypeCategory.DEMANDE_CONGE
    ) {
      throw new BadRequestException(
        'Seul un type de demande de congé peut diminuer le solde.',
      );
    }

    if (values.deductsPaidLeaveBalance && !values.requiresValidation) {
      throw new BadRequestException(
        'Un type diminuant le solde doit nécessiter une validation.',
      );
    }
  }
}
