import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';

import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { UpdateLeaveTypeAbsenceKindDto } from './dto/update-leave-type-absence-kind.dto';
import { LeaveType, LeaveTypeAbsenceKind, LeaveTypeCategory } from './leave-type.entity';
import {
  FAMILY_EVENT_KINDS,
  applicableFamilyEventRule,
  type FamilyEventApplicableRule,
  type FamilyEventKind,
} from '../leave-balances/family-event-rules.util';
import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';
import { User } from '../users/user.entity';

const REQUIRED_ABSENCE_TYPES = [
  'Congé supplémentaire de naissance',
  'Congé parental',
  'Congé parental d’éducation',
  'Congé d’adoption',
  'Congé de paternité et d’accueil de l’enfant',
] as const;

@Injectable()
export class LeaveTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(LeaveType)
    private readonly leaveTypeRepository: Repository<LeaveType>,
    private readonly dataSource: DataSource,
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

  /** JUR-028 — classification métier explicite d'un type d'absence. */
  async updateAbsenceKind(
    id: number,
    dto: UpdateLeaveTypeAbsenceKindDto,
  ): Promise<LeaveType> {
    const leaveType = await this.findOne(id);
    leaveType.absenceKind = dto.absenceKind;
    return this.leaveTypeRepository.save(leaveType);
  }

  /**
   * JUR-029/030 — durée applicable (versionnée) d'un événement familial pour
   * un type classé, une date et une entité donnés.
   */
  async familyEventRuleFor(
    leaveTypeId: number,
    date: string,
    employeeId?: number,
    params: import('../leave-balances/family-event-rules.util').FamilyEventParams = {},
  ): Promise<FamilyEventApplicableRule | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('La date doit être au format AAAA-MM-JJ.');
    }
    const leaveType = await this.findOne(leaveTypeId);
    const kind = leaveType.absenceKind as FamilyEventKind;
    if (!FAMILY_EVENT_KINDS.includes(kind)) {
      return null;
    }

    let conventionType = LegalEntityConventionType.NON_RENSEIGNEE;
    if (employeeId) {
      const user = await this.dataSource
        .getRepository(User)
        .findOne({ where: { id: employeeId }, relations: { legalEntity: true } });
      conventionType =
        user?.legalEntity?.conventionType ?? conventionType;
    }

    return applicableFamilyEventRule(kind, date, conventionType, params);
  }

  private async ensureRequiredAbsenceTypes(): Promise<void> {
    const PATERNITY_NAME = 'Congé de paternité et d’accueil de l’enfant';

    for (const name of REQUIRED_ABSENCE_TYPES) {
      const existing = await this.leaveTypeRepository.findOneBy({ name });
      const isPaternity = name === PATERNITY_NAME;

      if (existing) {
        // JUR-031 : un type « Congé de paternité » déjà présent mais non
        // classifié est classifié PATERNITE_ACCUEIL sans écraser une
        // classification RH explicite déjà différente. Les autres types
        // existants ne sont jamais modifiés silencieusement.
        if (isPaternity) {
          // On ne met à niveau que le défaut historiquement seedé (non classifié,
          // ou classifié PATERNITE_ACCUEIL mais réservé RH sans justificatif) ;
          // une configuration RH explicite différente n'est jamais écrasée.
          const isLegacySeededDefault =
            existing.employeeCanCreate === false &&
            existing.rhOnly === true &&
            existing.documentRequired === false;
          if (
            existing.absenceKind === LeaveTypeAbsenceKind.NON_CLASSIFIE ||
            (existing.absenceKind === LeaveTypeAbsenceKind.PATERNITE_ACCUEIL &&
              isLegacySeededDefault)
          ) {
            existing.absenceKind = LeaveTypeAbsenceKind.PATERNITE_ACCUEIL;
            existing.employeeCanCreate = true;
            existing.rhOnly = false;
            existing.documentRequired = true;
            existing.documentCanBeAddedLater = true;
            existing.requiresValidation = true;
            await this.leaveTypeRepository.save(existing);
          }
        }
        continue;
      }

      await this.leaveTypeRepository.save(
        this.leaveTypeRepository.create({
          name,
          category: LeaveTypeCategory.DECLARATION_ABSENCE,
          deductsPaidLeaveBalance: false,
          documentRequired: isPaternity,
          documentCanBeAddedLater: isPaternity,
          employeeCanCreate: isPaternity,
          rhOnly: !isPaternity,
          allowsDays: true,
          allowsHalfDays: false,
          allowsHours: false,
          requiresValidation: isPaternity,
          isActive: true,
          absenceKind: isPaternity
            ? LeaveTypeAbsenceKind.PATERNITE_ACCUEIL
            : LeaveTypeAbsenceKind.NON_CLASSIFIE,
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
        'L’ajout ultérieur ne peut être activé que pour un justificatif obligatoire.',
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
