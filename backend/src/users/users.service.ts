import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import {
  Service,
  ServiceType,
} from '../services/service.entity';
import { ServicesService } from '../services/services.service';
import { PresenceService } from '../presence/presence.service';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { occupiesSlot } from '../leave-requests/leave-request-period.util';
import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import { HolidaysService } from '../holidays/holidays.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ValidatorResolutionService } from '../validators/validator-resolution.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { canRhResetPassword } from './password-reset-policy';
import { END_SELECTION_EMOJIS, START_SELECTION_EMOJIS, UpdateOwnPreferencesDto } from './dto/update-own-preferences.dto';
import {
  EmploymentType,
  PresenceStatus,
  User,
  UserRole,
} from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly servicesService: ServicesService,
    private readonly presenceService: PresenceService,
    private readonly holidaysService: HolidaysService,
    private readonly settingsService: SettingsService,
    private readonly validatorResolutionService: ValidatorResolutionService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    actorRole: UserRole = UserRole.ADMIN,
  ): Promise<User> {
    if (
      actorRole === UserRole.RH &&
      ![UserRole.COLLABORATEUR, UserRole.RESPONSABLE_SERVICE].includes(
        createUserDto.role,
      )
    ) {
      throw new ForbiddenException(
        'La RH peut créer uniquement des collaborateurs ou des responsables de service.',
      );
    }

    if (actorRole === UserRole.RH && createUserDto.password?.trim()) {
      throw new ForbiddenException(
        'Seul un administrateur peut définir le mot de passe d’un utilisateur.',
      );
    }

    const email = createUserDto.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findOneBy({ email });

    if (existingUser) {
      throw new ConflictException(
        `Un utilisateur possédant l’adresse « ${email} » existe déjà.`,
      );
    }

    const service = await this.resolveServiceForCreation(createUserDto);

    const user = this.userRepository.create({
      nom: createUserDto.nom.trim(),
      prenom: createUserDto.prenom.trim(),
      email,
      passwordHash: createUserDto.password?.trim()
        ? await bcrypt.hash(createUserDto.password, 12)
        : null,
      microsoftId: createUserDto.microsoftId?.trim() || null,
      role: createUserDto.role,
      employmentType: createUserDto.employmentType,
      hireDate: createUserDto.hireDate ?? null,
      presenceStatus: PresenceStatus.PRESENT,
      isActive: true,
      serviceId: service?.id ?? null,
      service,
      signatureType: null,
      signatureData: null,
      signatureUpdatedAt: null,
    });

    const savedUser = await this.userRepository.save(user);
    return this.findOne(savedUser.id);
  }

  async findAll(actorRole: UserRole = UserRole.ADMIN): Promise<User[]> {
    const users = await this.userRepository.find({
      relations: { service: true },
      order: { nom: 'ASC', prenom: 'ASC' },
    });

    if (actorRole !== UserRole.RH) {
      return users;
    }

    return users.filter((user) => this.isRhManageableRole(user.role));
  }

  async findOne(
    id: number,
    actorRole: UserRole = UserRole.ADMIN,
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { service: true },
    });

    if (!user || (actorRole === UserRole.RH && !this.isRhManageableRole(user.role))) {
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

  async findByIdWithPassword(id: number): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.service', 'service')
      .where('user.id = :id', { id })
      .getOne();
  }

  async getGlobalPresence(
    actorRole: UserRole = UserRole.DIRECTEUR,
  ) {
    const users = await this.userRepository.find({
      where: { isActive: true },
      relations: { service: true },
      order: { nom: 'ASC', prenom: 'ASC' },
    });

    const members = users.filter((user) =>
      this.isVisibleInGlobalPresence(user.role, actorRole),
    );
    const currentPeriod = await this.presenceService.getCurrentSlot();

    const resolvedMembers = await Promise.all(
      members.map(async (member) => {
        const dailyAvailability =
          await this.presenceService.computeDailyAvailability(member.id);
        const presenceStatus = currentPeriod === DayPeriod.MATIN
          ? dailyAvailability.morning.status
          : dailyAvailability.afternoon.status;

        return {
          id: member.id,
          nom: member.nom,
          prenom: member.prenom,
          role: member.role,
          serviceId: member.serviceId,
          service: member.service
            ? {
                id: member.service.id,
                name: member.service.name,
                hasMinimumPresenceRule:
                  member.service.hasMinimumPresenceRule,
                minimumPresence:
                  member.service.minimumPresence,
              }
            : null,
          presenceStatus,
          dailyAvailability,
        };
      }),
    );

    const summary = resolvedMembers.reduce(
      (accumulator, member) => {
        accumulator.total += 1;
        if (member.presenceStatus === PresenceStatus.PRESENT) {
          accumulator.present += 1;
        } else if (member.presenceStatus === PresenceStatus.EN_VACANCES) {
          accumulator.onLeave += 1;
        } else if (member.presenceStatus === PresenceStatus.ABSENT) {
          accumulator.absent += 1;
        }
        return accumulator;
      },
      { total: 0, present: 0, onLeave: 0, absent: 0 },
    );

    type ServicePresence = {
      id: number | null;
      name: string;
      total: number;
      present: number;
      onLeave: number;
      absent: number;
      hasMinimumPresenceRule: boolean;
      minimumPresence: number | null;
      minimumRespected: boolean;
    };

    const serviceMap = new Map<string, ServicePresence>();

    for (const member of resolvedMembers) {
      const key = member.service
        ? String(member.service.id)
        : 'NO_SERVICE';
      const current = serviceMap.get(key) ?? {
        id: member.service?.id ?? null,
        name: member.service?.name ?? 'Direction',
        total: 0,
        present: 0,
        onLeave: 0,
        absent: 0,
        hasMinimumPresenceRule:
          member.service?.hasMinimumPresenceRule ?? false,
        minimumPresence:
          member.service?.hasMinimumPresenceRule
            ? member.service.minimumPresence ?? 0
            : null,
        minimumRespected: true,
      };

      current.total += 1;
      if (member.presenceStatus === PresenceStatus.PRESENT) {
        current.present += 1;
      } else if (
        member.presenceStatus === PresenceStatus.EN_VACANCES
      ) {
        current.onLeave += 1;
      } else if (member.presenceStatus === PresenceStatus.ABSENT) {
        current.absent += 1;
      }

      serviceMap.set(key, current);
    }

    const services = [...serviceMap.values()]
      .map((service) => ({
        ...service,
        minimumRespected:
          !service.hasMinimumPresenceRule ||
          service.minimumPresence === null ||
          service.present >= service.minimumPresence,
      }))
      .sort((left, right) => {
        if (left.minimumRespected !== right.minimumRespected) {
          return left.minimumRespected ? 1 : -1;
        }
        return left.name.localeCompare(right.name, 'fr');
      });

    return {
      date:
        resolvedMembers[0]?.dailyAvailability.date ??
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Martinique',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
      currentPeriod,
      summary: {
        ...summary,
        percentage:
          summary.total > 0
            ? Math.round((summary.present / summary.total) * 100)
            : 100,
        servicesBelowMinimum: services.filter(
          (service) => !service.minimumRespected,
        ).length,
      },
      services,
      members: resolvedMembers.map((member) => ({
        id: member.id,
        nom: member.nom,
        prenom: member.prenom,
        role: member.role,
        serviceId: member.serviceId,
        serviceName: member.service?.name ?? null,
        presenceStatus: member.presenceStatus,
      })),
    };
  }

  async getGlobalPresenceCalendar(
    monthValue: string | undefined,
    actor: Pick<AuthenticatedUser, 'id' | 'role'>,
  ) {
    const actorRole = actor.role;
    const month = this.normalizeCalendarMonth(monthValue);
    const [year, monthNumber] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEndDate = new Date(Date.UTC(year, monthNumber, 0));
    const monthEnd = monthEndDate.toISOString().slice(0, 10);

    const members = (await this.userRepository.find({
      where: { isActive: true },
      relations: { service: true },
      order: { nom: 'ASC', prenom: 'ASC' },
    })).filter((user) =>
      this.isVisibleInGlobalPresence(user.role, actorRole),
    );

    members.sort((left, right) => {
      const leftService = left.service?.name ?? 'Direction';
      const rightService = right.service?.name ?? 'Direction';
      const serviceOrder = leftService.localeCompare(rightService, 'fr');
      if (serviceOrder !== 0) return serviceOrder;

      const nameOrder = left.nom.localeCompare(right.nom, 'fr');
      if (nameOrder !== 0) return nameOrder;
      return left.prenom.localeCompare(right.prenom, 'fr');
    });

    const memberIds = members.map((member) => member.id);
    const manager = this.dataSource.manager;

    const leaves = memberIds.length === 0
      ? []
      : await manager
          .getRepository(LeaveRequest)
          .createQueryBuilder('request')
          .where('request.employeeId IN (:...memberIds)', { memberIds })
          .andWhere('request.startDate <= :monthEnd', { monthEnd })
          .andWhere('request.endDate >= :monthStart', { monthStart })
          .leftJoinAndSelect('request.employee', 'requestEmployee')
          .leftJoinAndSelect('request.leaveType', 'requestLeaveType')
          .leftJoinAndSelect('request.service', 'requestService')
          .andWhere('request.status IN (:...statuses)', {
            statuses: [
              LeaveRequestStatus.VALIDEE,
              LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
              LeaveRequestStatus.EN_ATTENTE_VALIDATION,
            ],
          })
          .getMany();

    const absences = memberIds.length === 0
      ? []
      : await manager
          .getRepository(AbsenceDeclaration)
          .createQueryBuilder('absence')
          .where('absence.employeeId IN (:...memberIds)', { memberIds })
          .andWhere('absence.startDate <= :monthEnd', { monthEnd })
          .andWhere('absence.endDate >= :monthStart', { monthStart })
          .andWhere('absence.status = :status', {
            status: AbsenceDeclarationStatus.ENREGISTREE,
          })
          .getMany();

    const holidays = await this.holidaysService.findCalendarBetween(
      monthStart,
      monthEnd,
    );

    const activeLeaves = leaves.filter(
      (leave) =>
        leave.status !== LeaveRequestStatus.EN_ATTENTE_VALIDATION,
    );
    const pendingCandidates = leaves.filter(
      (leave) => leave.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION,
    );
    const pendingRecipientChecks = await Promise.all(
      pendingCandidates.map(async (leave) => {
        try {
          const recipientIds = await this.validatorResolutionService.getDecisionRecipientIds(
            leave,
            { manager },
          );
          return recipientIds.includes(actor.id) ? leave : null;
        } catch {
          return null;
        }
      }),
    );
    const pendingLeaves = pendingRecipientChecks.filter(
      (leave): leave is LeaveRequest => leave !== null,
    );

    const days: Array<{
      date: string;
      morningPresent: number;
      afternoonPresent: number;
      morningMinimumRespected: boolean;
      afternoonMinimumRespected: boolean;
      members: Array<{
        id: number;
        morningStatus: PresenceStatus;
        afternoonStatus: PresenceStatus;
        morningPendingRequestIds: number[];
        afternoonPendingRequestIds: number[];
      }>;
    }> = [];

    for (let day = 1; day <= monthEndDate.getUTCDate(); day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      let morningPresent = 0;
      let afternoonPresent = 0;

      const dayMembers = members.map((member) => {
        const memberAbsences = absences.filter(
          (absence) => absence.employeeId === member.id,
        );
        const memberLeaves = activeLeaves.filter(
          (leave) => leave.employeeId === member.id,
        );
        const memberPendingLeaves = pendingLeaves.filter(
          (leave) => leave.employeeId === member.id,
        );

        const resolveStatus = (period: DayPeriod): PresenceStatus => {
          if (
            memberAbsences.some((absence) =>
              occupiesSlot(absence, date, period),
            )
          ) {
            return PresenceStatus.ABSENT;
          }

          if (
            memberLeaves.some((leave) =>
              occupiesSlot(leave, date, period),
            )
          ) {
            return PresenceStatus.EN_VACANCES;
          }

          return PresenceStatus.PRESENT;
        };

        const morningStatus = resolveStatus(DayPeriod.MATIN);
        const afternoonStatus = resolveStatus(DayPeriod.APRES_MIDI);
        const morningPendingRequestIds = memberPendingLeaves
          .filter((leave) => occupiesSlot(leave, date, DayPeriod.MATIN))
          .map((leave) => leave.id);
        const afternoonPendingRequestIds = memberPendingLeaves
          .filter((leave) => occupiesSlot(leave, date, DayPeriod.APRES_MIDI))
          .map((leave) => leave.id);

        if (morningStatus === PresenceStatus.PRESENT) morningPresent += 1;
        if (afternoonStatus === PresenceStatus.PRESENT) afternoonPresent += 1;

        return {
          id: member.id,
          morningStatus,
          afternoonStatus,
          morningPendingRequestIds,
          afternoonPendingRequestIds,
        };
      });

      days.push({
        date,
        morningPresent,
        afternoonPresent,
        morningMinimumRespected: true,
        afternoonMinimumRespected: true,
        members: dayMembers,
      });
    }

    return {
      month,
      totalMembers: members.length,
      members: members.map((member) => ({
        id: member.id,
        nom: member.nom,
        prenom: member.prenom,
        role: member.role,
        employmentType: member.employmentType,
        serviceId: member.serviceId,
        serviceName: member.service?.name ?? 'Direction',
        serviceType: member.service?.serviceType ?? null,
        externalCompanyName: member.service?.externalCompanyName ?? null,
      })),
      holidays: holidays.map((holiday) => ({
        id: holiday.id,
        date: holiday.date,
        name: holiday.name,
        holidayType: holiday.holidayType,
      })),
      pendingRequests: pendingLeaves.map((leave) => ({
        id: leave.id,
        employeeId: leave.employeeId,
        employeeName: `${leave.employee?.nom ?? ''} ${leave.employee?.prenom ?? ''}`.trim(),
        leaveTypeName: leave.leaveType?.name ?? 'Congé',
        startDate: leave.startDate,
        endDate: leave.endDate,
        startPeriod: leave.startPeriod,
        endPeriod: leave.endPeriod,
        deductedDays: leave.deductedDays,
      })),
      days,
    };
  }

  async getOwnServicePresence(id: number) {
    const currentUser = await this.findOne(id);

    if (!currentUser.serviceId || !currentUser.service) {
      throw new BadRequestException(
        'Aucun service actif n’est rattaché à votre compte.',
      );
    }

    const members = await this.userRepository.find({
      where: {
        serviceId: currentUser.serviceId,
        isActive: true,
      },
      order: {
        nom: 'ASC',
        prenom: 'ASC',
      },
    });

    const currentPeriod = await this.presenceService.getCurrentSlot();

    const resolvedMembers = await Promise.all(
      members.map(async (member) => {
        const dailyAvailability =
          await this.presenceService.computeDailyAvailability(member.id);
        const presenceStatus = currentPeriod === DayPeriod.MATIN
          ? dailyAvailability.morning.status
          : dailyAvailability.afternoon.status;

        return {
          id: member.id,
          nom: member.nom,
          prenom: member.prenom,
          role: member.role,
          presenceStatus,
          dailyAvailability,
        };
      }),
    );

    const summary = resolvedMembers.reduce(
      (accumulator, member) => {
        accumulator.total += 1;
        if (member.presenceStatus === PresenceStatus.PRESENT) {
          accumulator.present += 1;
        } else if (member.presenceStatus === PresenceStatus.EN_VACANCES) {
          accumulator.onLeave += 1;
        } else if (member.presenceStatus === PresenceStatus.ABSENT) {
          accumulator.absent += 1;
        }
        return accumulator;
      },
      { total: 0, present: 0, onLeave: 0, absent: 0 },
    );

    return {
      date: resolvedMembers[0]?.dailyAvailability.date ?? null,
      currentPeriod,
      service: {
        id: currentUser.service.id,
        name: currentUser.service.name,
        hasMinimumPresenceRule:
          currentUser.service.hasMinimumPresenceRule,
        minimumPresence: currentUser.service.minimumPresence,
      },
      summary,
      members: resolvedMembers,
    };
  }

  async getOwnServicePresenceCalendar(id: number, monthValue?: string) {
    const currentUser = await this.findOne(id);

    if (!currentUser.serviceId || !currentUser.service) {
      throw new BadRequestException(
        'Aucun service actif n’est rattaché à votre compte.',
      );
    }

    const month = this.normalizeCalendarMonth(monthValue);
    const [year, monthNumber] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEndDate = new Date(Date.UTC(year, monthNumber, 0));
    const monthEnd = monthEndDate.toISOString().slice(0, 10);

    const members = await this.userRepository.find({
      where: {
        serviceId: currentUser.serviceId,
        isActive: true,
      },
      order: {
        nom: 'ASC',
        prenom: 'ASC',
      },
    });

    const memberIds = members.map((member) => member.id);
    const manager = this.dataSource.manager;

    const leaves = memberIds.length === 0
      ? []
      : await manager
          .getRepository(LeaveRequest)
          .createQueryBuilder('request')
          .where('request.employeeId IN (:...memberIds)', { memberIds })
          .andWhere('request.startDate <= :monthEnd', { monthEnd })
          .andWhere('request.endDate >= :monthStart', { monthStart })
          .andWhere('request.status IN (:...statuses)', {
            statuses: [
              LeaveRequestStatus.VALIDEE,
              LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
              LeaveRequestStatus.EN_ATTENTE_VALIDATION,
            ],
          })
          .getMany();

    const absences = memberIds.length === 0
      ? []
      : await manager
          .getRepository(AbsenceDeclaration)
          .createQueryBuilder('absence')
          .where('absence.employeeId IN (:...memberIds)', { memberIds })
          .andWhere('absence.startDate <= :monthEnd', { monthEnd })
          .andWhere('absence.endDate >= :monthStart', { monthStart })
          .andWhere('absence.status = :status', {
            status: AbsenceDeclarationStatus.ENREGISTREE,
          })
          .getMany();

    const holidays = await this.holidaysService.findCalendarBetween(
      monthStart,
      monthEnd,
    );

    const activeLeaves = leaves.filter(
      (leave) => leave.status !== LeaveRequestStatus.EN_ATTENTE_VALIDATION,
    );
    const pendingLeaves = leaves.filter(
      (leave) =>
        leave.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
        leave.finalDeciderId === null,
    );

    const days: Array<{
      date: string;
      morningPresent: number;
      afternoonPresent: number;
      morningMinimumRespected: boolean;
      afternoonMinimumRespected: boolean;
      members: Array<{
        id: number;
        morningStatus: PresenceStatus;
        afternoonStatus: PresenceStatus;
        morningPendingRequestIds: number[];
        afternoonPendingRequestIds: number[];
      }>;
    }> = [];

    const minimumPresence = currentUser.service.hasMinimumPresenceRule
      ? currentUser.service.minimumPresence ?? 0
      : null;

    for (let day = 1; day <= monthEndDate.getUTCDate(); day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      let morningPresent = 0;
      let afternoonPresent = 0;

      const dayMembers = members.map((member) => {
        const memberAbsences = absences.filter(
          (absence) => absence.employeeId === member.id,
        );
        const memberLeaves = activeLeaves.filter(
          (leave) => leave.employeeId === member.id,
        );
        const memberPendingLeaves = pendingLeaves.filter(
          (leave) => leave.employeeId === member.id,
        );

        const resolveStatus = (period: DayPeriod): PresenceStatus => {
          if (
            memberAbsences.some((absence) =>
              occupiesSlot(absence, date, period),
            )
          ) {
            return PresenceStatus.ABSENT;
          }

          if (
            memberLeaves.some((leave) =>
              occupiesSlot(leave, date, period),
            )
          ) {
            return PresenceStatus.EN_VACANCES;
          }

          return PresenceStatus.PRESENT;
        };

        const morningStatus = resolveStatus(DayPeriod.MATIN);
        const afternoonStatus = resolveStatus(DayPeriod.APRES_MIDI);
        const morningPendingRequestIds = memberPendingLeaves
          .filter((leave) => occupiesSlot(leave, date, DayPeriod.MATIN))
          .map((leave) => leave.id);
        const afternoonPendingRequestIds = memberPendingLeaves
          .filter((leave) => occupiesSlot(leave, date, DayPeriod.APRES_MIDI))
          .map((leave) => leave.id);

        if (morningStatus === PresenceStatus.PRESENT) morningPresent += 1;
        if (afternoonStatus === PresenceStatus.PRESENT) afternoonPresent += 1;

        return {
          id: member.id,
          morningStatus,
          afternoonStatus,
          morningPendingRequestIds,
          afternoonPendingRequestIds,
        };
      });

      days.push({
        date,
        morningPresent,
        afternoonPresent,
        morningMinimumRespected:
          minimumPresence === null || morningPresent >= minimumPresence,
        afternoonMinimumRespected:
          minimumPresence === null || afternoonPresent >= minimumPresence,
        members: dayMembers,
      });
    }

    return {
      month,
      service: {
        id: currentUser.service.id,
        name: currentUser.service.name,
        hasMinimumPresenceRule:
          currentUser.service.hasMinimumPresenceRule,
        minimumPresence,
      },
      members: members.map((member) => ({
        id: member.id,
        nom: member.nom,
        prenom: member.prenom,
        role: member.role,
      })),
      holidays: holidays.map((holiday) => ({
        id: holiday.id,
        date: holiday.date,
        name: holiday.name,
        holidayType: holiday.holidayType,
      })),
      days,
    };
  }

  private normalizeCalendarMonth(monthValue?: string): string {
    if (!monthValue) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Martinique',
        year: 'numeric',
        month: '2-digit',
      }).format(new Date());
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)) {
      throw new BadRequestException(
        'Le mois doit être fourni au format AAAA-MM.',
      );
    }

    return monthValue;
  }

  async getOwnProfile(id: number) {
    const user = await this.findOne(id);
    const preferences = await this.readOwnPreferences(id);

    return {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
      employmentType: user.employmentType,
      hireDate: user.hireDate,
      presenceStatus: user.presenceStatus,
      serviceId: user.serviceId,
      profileImageData: preferences.profileImageData,
      service: user.service
        ? {
            id: user.service.id,
            name: user.service.name,
            serviceType: user.service.serviceType,
            externalCompanyName: user.service.externalCompanyName,
          }
        : null,
      signature: {
        configured: Boolean(user.signatureType),
        type: user.signatureType,
        updatedAt: user.signatureUpdatedAt,
      },
    };
  }

  async getOwnPreferences(id: number) {
    await this.findOne(id);
    return this.readOwnPreferences(id);
  }

  async getProfileImages(): Promise<Record<string, string>> {
    const settings = await this.settingsService.getValuesByPrefix('USER_PROFILE_PREFERENCES_');
    const profileImages: Record<string, string> = {};

    for (const setting of settings) {
      const match = setting.settingKey.match(/^USER_PROFILE_PREFERENCES_(\d+)$/);
      if (!match) continue;

      try {
        const parsed = JSON.parse(setting.settingValue) as { profileImageData?: unknown };
        if (typeof parsed.profileImageData === 'string' && parsed.profileImageData.startsWith('data:image/')) {
          profileImages[match[1]] = parsed.profileImageData;
        }
      } catch {
        // Une préférence invalide ne doit pas empêcher l'affichage des autres profils.
      }
    }

    return profileImages;
  }

  async updateOwnPreferences(id: number, dto: UpdateOwnPreferencesDto) {
    await this.findOne(id);
    const current = await this.readOwnPreferences(id);
    const profileImageData = dto.profileImageData === null
      ? null
      : dto.profileImageData ?? current.profileImageData;

    if (profileImageData) {
      if (
        profileImageData.length > 58000 ||
        !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(profileImageData)
      ) {
        throw new BadRequestException(
          'La photo de profil doit être une image PNG, JPEG ou WebP valide et suffisamment légère.',
        );
      }
    }

    const startEmoji = dto.startEmoji ?? current.startEmoji;
    const endEmoji = dto.endEmoji ?? current.endEmoji;
    if (!START_SELECTION_EMOJIS.includes(startEmoji) ||
        !END_SELECTION_EMOJIS.includes(endEmoji)) {
      throw new BadRequestException('Emoji de sélection du calendrier non autorisé.');
    }

    const preferences = { profileImageData, startEmoji, endEmoji };
    await this.settingsService.upsertInternal(
      this.profilePreferencesKey(id),
      JSON.stringify(preferences),
      'Préférences personnelles de profil et de calendrier.',
      id,
    );

    return preferences;
  }

  private profilePreferencesKey(id: number): string {
    return `USER_PROFILE_PREFERENCES_${id}`;
  }

  private async readOwnPreferences(id: number): Promise<{
    profileImageData: string | null;
    startEmoji: string;
    endEmoji: string;
  }> {
    const raw = await this.settingsService.getValue(this.profilePreferencesKey(id));
    const fallback = {
      profileImageData: null as string | null,
      startEmoji: '😊',
      endEmoji: '😔',
    };

    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw) as {
        profileImageData?: unknown;
        startEmoji?: unknown;
        endEmoji?: unknown;
      };
      return {
        profileImageData: typeof parsed.profileImageData === 'string' ? parsed.profileImageData : null,
        startEmoji: typeof parsed.startEmoji === 'string' && START_SELECTION_EMOJIS.includes(parsed.startEmoji)
          ? parsed.startEmoji
          : fallback.startEmoji,
        endEmoji: typeof parsed.endEmoji === 'string' && END_SELECTION_EMOJIS.includes(parsed.endEmoji)
          ? parsed.endEmoji
          : fallback.endEmoji,
      };
    } catch {
      return fallback;
    }
  }

  async getOwnSignature(id: number) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.signatureData')
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException(
        `L’utilisateur ${id} est introuvable.`,
      );
    }

    return {
      configured: Boolean(user.signatureType && user.signatureData),
      signatureType: user.signatureType,
      signatureData: user.signatureData,
      updatedAt: user.signatureUpdatedAt,
    };
  }

  async updateOwnSignature(
    id: number,
    signatureType: 'DRAWN' | 'INITIALS',
    signatureDataValue: string,
  ) {
    const user = await this.findOne(id);
    const signatureData = this.validateAndNormalizeSignature(
      signatureType,
      signatureDataValue,
    );

    user.signatureType = signatureType;
    user.signatureData = signatureData;
    user.signatureUpdatedAt = new Date();
    await this.userRepository.save(user);

    return this.getOwnSignature(id);
  }

  async deleteOwnSignature(id: number) {
    const user = await this.findOne(id);
    user.signatureType = null;
    user.signatureData = null;
    user.signatureUpdatedAt = null;
    await this.userRepository.save(user);

    return { message: 'Votre signature enregistrée a été supprimée.' };
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    const result = await this.userRepository.update(
      { id },
      { passwordHash, mustChangePassword: false },
    );

    if (!result.affected) {
      throw new NotFoundException(
        `L’utilisateur ${id} est introuvable.`,
      );
    }
  }


  async resetPassword(
    id: number,
    temporaryPassword: string,
    actorRole: UserRole,
  ): Promise<{ message: string }> {
    const user = await this.findOne(id);

    if (actorRole === UserRole.RH && !canRhResetPassword(user.role)) {
      throw new ForbiddenException(
        'La RH peut réinitialiser uniquement le mot de passe d’un collaborateur ou d’un responsable de service.',
      );
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const result = await this.userRepository.update(
      { id },
      { passwordHash, mustChangePassword: true },
    );

    if (!result.affected) {
      throw new NotFoundException(`L’utilisateur ${id} est introuvable.`);
    }

    return {
      message: `Le mot de passe temporaire de ${user.nom} ${user.prenom} a été enregistré.`,
    };
  }

  async update(
    id: number,
    updateUserDto: UpdateUserDto,
    actorRole: UserRole = UserRole.ADMIN,
  ): Promise<User> {
    const user = await this.findOne(id);
    this.assertRhCanManageUser(actorRole, user);

    if (
      actorRole === UserRole.RH &&
      updateUserDto.role !== undefined &&
      !this.isRhManageableRole(updateUserDto.role)
    ) {
      throw new ForbiddenException(
        'La RH peut attribuer uniquement les rôles Collaborateur ou Responsable de service.',
      );
    }

    if (actorRole === UserRole.RH && updateUserDto.password?.trim()) {
      throw new ForbiddenException(
        'Seul un administrateur peut modifier le mot de passe d’un utilisateur.',
      );
    }

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

    let service: Service | null = user.service;
    const requestedServiceId = updateUserDto.serviceId as
      | number
      | null
      | undefined;

    if (
      requestedServiceId !== undefined &&
      requestedServiceId !== user.serviceId
    ) {
      if (requestedServiceId === null) {
        service = null;
      } else {
        service = await this.servicesService.findOne(
          requestedServiceId,
        );

        if (!service.isActive) {
          throw new BadRequestException(
            'Le service sélectionné est désactivé.',
          );
        }
      }
    }

    const role = updateUserDto.role ?? user.role;
    const employmentType =
      updateUserDto.employmentType ?? user.employmentType;

    this.validateServiceRequirement(role, service);

    if (service) {
      this.validateEmploymentType(
        employmentType,
        service.serviceType,
      );
    }

    user.nom = updateUserDto.nom?.trim() ?? user.nom;
    user.prenom = updateUserDto.prenom?.trim() ?? user.prenom;
    user.email = email;
    user.role = role;
    user.employmentType = employmentType;
    user.hireDate = updateUserDto.hireDate ?? user.hireDate;
    user.serviceId = service?.id ?? null;
    user.service = service;

    if (updateUserDto.microsoftId !== undefined) {
      user.microsoftId = updateUserDto.microsoftId.trim() || null;
    }

    if (updateUserDto.isActive !== undefined) {
      user.isActive = updateUserDto.isActive;
    }

    await this.userRepository.save(user);

    if (updateUserDto.password?.trim()) {
      await this.setPassword(id, await bcrypt.hash(updateUserDto.password, 12));
    }

    return this.findOne(id);
  }

  async disable(
    id: number,
    actorRole: UserRole = UserRole.ADMIN,
  ): Promise<User> {
    const user = await this.findOne(id);
    this.assertRhCanManageUser(actorRole, user);
    user.isActive = false;
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  async enable(
    id: number,
    actorRole: UserRole = UserRole.ADMIN,
  ): Promise<User> {
    const user = await this.findOne(id);
    this.assertRhCanManageUser(actorRole, user);
    user.isActive = true;
    await this.userRepository.save(user);
    return this.findOne(id);
  }


  private isRhManageableRole(role: UserRole): boolean {
    return [
      UserRole.COLLABORATEUR,
      UserRole.RESPONSABLE_SERVICE,
    ].includes(role);
  }

  private assertRhCanManageUser(actorRole: UserRole, user: User): void {
    if (actorRole === UserRole.RH && !this.isRhManageableRole(user.role)) {
      throw new ForbiddenException(
        'La RH peut gérer uniquement les collaborateurs et les responsables de service.',
      );
    }
  }

  private isVisibleInGlobalPresence(
    role: UserRole,
    actorRole: UserRole,
  ): boolean {
    if (actorRole === UserRole.RH) {
      return this.isRhManageableRole(role);
    }

    return role !== UserRole.ADMIN;
  }

  private validateAndNormalizeSignature(
    signatureType: 'DRAWN' | 'INITIALS',
    signatureDataValue: string,
  ): string {
    const signatureData = signatureDataValue.trim();

    if (signatureType === 'INITIALS') {
      const letterCount = (signatureData.match(/\p{L}/gu) ?? []).length;

      if (
        letterCount < 2 ||
        letterCount > 6 ||
        !/^[\p{L}.\-\s]+$/u.test(signatureData)
      ) {
        throw new BadRequestException(
          'Les initiales doivent contenir entre 2 et 6 lettres.',
        );
      }

      return signatureData.toUpperCase();
    }

    const prefix = 'data:image/png;base64,';

    if (!signatureData.startsWith(prefix)) {
      throw new BadRequestException(
        'La signature dessinée doit être transmise au format PNG encodé en base64.',
      );
    }

    const base64Value = signatureData.slice(prefix.length);

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Value)) {
      throw new BadRequestException(
        'Les données de la signature dessinée ne sont pas valides.',
      );
    }

    const decodedSignature = Buffer.from(base64Value, 'base64');
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    if (
      decodedSignature.length < pngHeader.length ||
      !decodedSignature.subarray(0, pngHeader.length).equals(pngHeader)
    ) {
      throw new BadRequestException(
        'La signature dessinée doit contenir une véritable image PNG.',
      );
    }

    if (decodedSignature.length > 500 * 1024) {
      throw new BadRequestException(
        'La signature dessinée ne doit pas dépasser 500 Ko.',
      );
    }

    return signatureData;
  }

  private async resolveServiceForCreation(
    createUserDto: CreateUserDto,
  ): Promise<Service | null> {
    if (createUserDto.serviceId === undefined) {
      this.validateServiceRequirement(createUserDto.role, null);
      return null;
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

    return service;
  }

  private validateServiceRequirement(
    role: UserRole,
    service: Service | null,
  ): void {
    if (role !== UserRole.ADMIN && !service) {
      throw new BadRequestException(
        'Un service est obligatoire pour tous les rôles sauf ADMIN.',
      );
    }
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
