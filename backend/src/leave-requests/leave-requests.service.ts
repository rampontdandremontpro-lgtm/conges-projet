import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Repository,
} from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import type { Holiday } from '../holidays/holiday.entity';
import { HolidaysService } from '../holidays/holidays.service';
import {
  LeaveBalancesService,
  type PaidLeaveReservationSummary,
} from '../leave-balances/leave-balances.service';
import {
  LeaveType,
  LeaveTypeCategory,
} from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import { UsersService } from '../users/users.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { SubmitLeaveRequestDto } from './dto/submit-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import {
  LeaveRequestHistory,
  LeaveRequestHistoryAction,
} from './leave-request-history.entity';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
  SignatureType,
} from './leave-request.entity';

interface SubmissionNoticeResult {
  daysBeforeStart: number;
  requiredNoticeDays: 30 | 60;
  isLongLeave: boolean;
  overlapsSummerPeriod: boolean;
}

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    @InjectRepository(LeaveRequestHistory)
    private readonly historyRepository: Repository<LeaveRequestHistory>,

    private readonly usersService: UsersService,
    private readonly leaveTypesService: LeaveTypesService,
    private readonly holidaysService: HolidaysService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly dataSource: DataSource,
  ) {}

  async createDraft(
    authenticatedUser: AuthenticatedUser,
    createLeaveRequestDto: CreateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    const employee = await this.usersService.findOne(
      authenticatedUser.id,
    );

    if (!employee.isActive) {
      throw new ForbiddenException(
        'Le compte utilisateur est désactivé.',
      );
    }

    const leaveType = await this.leaveTypesService.findOne(
      createLeaveRequestDto.leaveTypeId,
    );

    this.validateLeaveType(leaveType);

    const startPeriod =
      createLeaveRequestDto.startPeriod ?? DayPeriod.MATIN;
    const endPeriod =
      createLeaveRequestDto.endPeriod ?? DayPeriod.APRES_MIDI;

    const dates = await this.validateAndCalculateDates(
      createLeaveRequestDto.startDate,
      createLeaveRequestDto.endDate,
      startPeriod,
      endPeriod,
      leaveType.allowsHalfDays,
    );

    const leaveRequest = this.leaveRequestRepository.create({
      employeeId: employee.id,
      employee,
      createdById: employee.id,
      createdBy: employee,
      leaveTypeId: leaveType.id,
      leaveType,
      serviceId: employee.serviceId,
      service: employee.service,
      startDate: createLeaveRequestDto.startDate,
      endDate: createLeaveRequestDto.endDate,
      startPeriod,
      endPeriod,
      calendarDuration: dates.calendarDuration,
      deductedDays: dates.deductedDays,
      status: LeaveRequestStatus.BROUILLON,
      comment: createLeaveRequestDto.comment?.trim() || null,
      submittedAt: null,
      modificationDeadline: this.calculateModificationDeadline(
        createLeaveRequestDto.startDate,
      ),
      realBalanceBefore: null,
      potentialBalanceBefore: null,
      realBalanceAfter: null,
      employeeSignatureType: null,
      employeeSignatureData: null,
      employeeSignedAt: null,
      version: 1,
      lockedAt: null,
    });

    const savedRequest = await this.leaveRequestRepository.save(
      leaveRequest,
    );

    await this.historyRepository.save(
      this.historyRepository.create({
        leaveRequestId: savedRequest.id,
        leaveRequest: savedRequest,
        action: LeaveRequestHistoryAction.BROUILLON_CREE,
        actorId: employee.id,
        actor: employee,
        oldStatus: null,
        newStatus: LeaveRequestStatus.BROUILLON,
        comment: null,
        metadata: {
          startDate: savedRequest.startDate,
          endDate: savedRequest.endDate,
          deductedDays: savedRequest.deductedDays,
        },
      }),
    );

    return this.findOwnedRequest(savedRequest.id, employee.id);
  }

  async findMyRequests(
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest[]> {
    return this.leaveRequestRepository.find({
      where: {
        employeeId: authenticatedUser.id,
      },
      relations: {
        leaveType: true,
        service: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findMyRequest(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    return this.findOwnedRequest(id, authenticatedUser.id);
  }

  async updateDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
    updateLeaveRequestDto: UpdateLeaveRequestDto,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.findOwnedRequest(
      id,
      authenticatedUser.id,
    );

    this.ensureDraft(leaveRequest);

    const leaveType =
      updateLeaveRequestDto.leaveTypeId !== undefined &&
      updateLeaveRequestDto.leaveTypeId !== leaveRequest.leaveTypeId
        ? await this.leaveTypesService.findOne(
            updateLeaveRequestDto.leaveTypeId,
          )
        : leaveRequest.leaveType;

    this.validateLeaveType(leaveType);

    const startDate =
      updateLeaveRequestDto.startDate ?? leaveRequest.startDate;
    const endDate =
      updateLeaveRequestDto.endDate ?? leaveRequest.endDate;
    const startPeriod =
      updateLeaveRequestDto.startPeriod ?? leaveRequest.startPeriod;
    const endPeriod =
      updateLeaveRequestDto.endPeriod ?? leaveRequest.endPeriod;

    const dates = await this.validateAndCalculateDates(
      startDate,
      endDate,
      startPeriod,
      endPeriod,
      leaveType.allowsHalfDays,
    );

    leaveRequest.leaveTypeId = leaveType.id;
    leaveRequest.leaveType = leaveType;
    leaveRequest.startDate = startDate;
    leaveRequest.endDate = endDate;
    leaveRequest.startPeriod = startPeriod;
    leaveRequest.endPeriod = endPeriod;
    leaveRequest.calendarDuration = dates.calendarDuration;
    leaveRequest.deductedDays = dates.deductedDays;
    leaveRequest.modificationDeadline =
      this.calculateModificationDeadline(startDate);
    leaveRequest.version += 1;

    if (updateLeaveRequestDto.comment !== undefined) {
      leaveRequest.comment =
        updateLeaveRequestDto.comment.trim() || null;
    }

    await this.leaveRequestRepository.save(leaveRequest);

    await this.historyRepository.save(
      this.historyRepository.create({
        leaveRequestId: leaveRequest.id,
        leaveRequest,
        action: LeaveRequestHistoryAction.BROUILLON_MODIFIE,
        actorId: authenticatedUser.id,
        oldStatus: LeaveRequestStatus.BROUILLON,
        newStatus: LeaveRequestStatus.BROUILLON,
        comment: null,
        metadata: {
          version: leaveRequest.version,
          startDate: leaveRequest.startDate,
          endDate: leaveRequest.endDate,
          deductedDays: leaveRequest.deductedDays,
        },
      }),
    );

    return this.findOwnedRequest(id, authenticatedUser.id);
  }

  async submit(
    id: number,
    authenticatedUser: AuthenticatedUser,
    submitLeaveRequestDto: SubmitLeaveRequestDto,
  ): Promise<LeaveRequest> {
    await this.dataSource.transaction(async (manager) => {
      const leaveRequest = await this.findOwnedRequestForUpdate(
        manager,
        id,
        authenticatedUser.id,
      );

      this.ensureDraft(leaveRequest);

      const leaveType = await manager
        .getRepository(LeaveType)
        .findOneBy({ id: leaveRequest.leaveTypeId });

      if (!leaveType) {
        throw new NotFoundException(
          `Le type de congé ${leaveRequest.leaveTypeId} est introuvable.`,
        );
      }

      this.validateLeaveType(leaveType);

      const dates = await this.validateAndCalculateDates(
        leaveRequest.startDate,
        leaveRequest.endDate,
        leaveRequest.startPeriod,
        leaveRequest.endPeriod,
        leaveType.allowsHalfDays,
      );

      leaveRequest.calendarDuration = dates.calendarDuration;
      leaveRequest.deductedDays = dates.deductedDays;

      const notice = this.validateSubmissionNotice(
        leaveRequest.startDate,
        leaveRequest.endDate,
        dates.calendarDuration,
      );

      await this.ensureNoPersonalOverlap(manager, leaveRequest);

      const signatureData = this.validateAndNormalizeSignature(
        submitLeaveRequestDto.signatureType,
        submitLeaveRequestDto.signatureData,
      );

      let reservation: PaidLeaveReservationSummary | null = null;

      if (leaveType.deductsPaidLeaveBalance) {
        reservation =
          await this.leaveBalancesService.reservePaidLeaveForRequest(
            manager,
            {
              employeeId: leaveRequest.employeeId,
              leaveRequestId: leaveRequest.id,
              days: leaveRequest.deductedDays,
              actorId: authenticatedUser.id,
              reason:
                'Réservation lors de la soumission de la demande de congés.',
            },
          );
      }

      const submittedAt = new Date();
      const oldStatus = leaveRequest.status;

      leaveRequest.status = LeaveRequestStatus.EN_ATTENTE_VALIDATION;
      leaveRequest.submittedAt = submittedAt;
      leaveRequest.employeeSignatureType =
        submitLeaveRequestDto.signatureType;
      leaveRequest.employeeSignatureData = signatureData;
      leaveRequest.employeeSignedAt = submittedAt;
      leaveRequest.realBalanceBefore =
        reservation?.realBalanceBefore ?? null;
      leaveRequest.potentialBalanceBefore =
        reservation?.potentialBalanceBefore ?? null;
      leaveRequest.realBalanceAfter = null;
      leaveRequest.version += 1;

      await manager.getRepository(LeaveRequest).save(leaveRequest);

      await manager.getRepository(LeaveRequestHistory).save(
        manager.getRepository(LeaveRequestHistory).create({
          leaveRequestId: leaveRequest.id,
          leaveRequest,
          action: LeaveRequestHistoryAction.DEMANDE_SOUMISE,
          actorId: authenticatedUser.id,
          oldStatus,
          newStatus: LeaveRequestStatus.EN_ATTENTE_VALIDATION,
          comment: null,
          metadata: {
            daysBeforeStart: notice.daysBeforeStart,
            requiredNoticeDays: notice.requiredNoticeDays,
            isLongLeave: notice.isLongLeave,
            overlapsSummerPeriod: notice.overlapsSummerPeriod,
            deductedDays: leaveRequest.deductedDays,
            potentialBalanceAfter:
              reservation?.potentialBalanceAfter ?? null,
            reservations: reservation?.reservations ?? [],
          },
        }),
      );
    });

    return this.findOwnedRequest(id, authenticatedUser.id);
  }

  async deleteDraft(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
    const leaveRequest = await this.findOwnedRequest(
      id,
      authenticatedUser.id,
    );

    this.ensureDraft(leaveRequest);

    await this.leaveRequestRepository.remove(leaveRequest);
  }

  private async findOwnedRequest(
    id: number,
    employeeId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: {
        id,
        employeeId,
      },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private async findOwnedRequestForUpdate(
    manager: EntityManager,
    id: number,
    employeeId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('leaveRequest')
      .setLock('pessimistic_write')
      .where('leaveRequest.id = :id', { id })
      .andWhere('leaveRequest.employeeId = :employeeId', {
        employeeId,
      })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    return leaveRequest;
  }

  private validateLeaveType(leaveType: LeaveType): void {
    if (!leaveType.isActive) {
      throw new BadRequestException(
        'Le type de congé sélectionné est désactivé.',
      );
    }

    if (leaveType.category !== LeaveTypeCategory.CONGE) {
      throw new BadRequestException(
        'Le type sélectionné ne correspond pas à une demande de congé.',
      );
    }

    if (!leaveType.employeeCanCreate || leaveType.rhOnly) {
      throw new ForbiddenException(
        'Ce type ne peut pas être demandé directement par un collaborateur.',
      );
    }

    if (!leaveType.allowsDays && !leaveType.allowsHalfDays) {
      throw new BadRequestException(
        'Ce type ne peut pas être saisi en jours ou en demi-journées.',
      );
    }

    if (!leaveType.requiresValidation) {
      throw new BadRequestException(
        'Ce type de congé doit être configuré avec une validation.',
      );
    }
  }

  private ensureDraft(leaveRequest: LeaveRequest): void {
    if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
      throw new BadRequestException(
        'Seule une demande au statut BROUILLON peut être modifiée, supprimée ou soumise.',
      );
    }
  }

  private async ensureNoPersonalOverlap(
    manager: EntityManager,
    leaveRequest: LeaveRequest,
  ): Promise<void> {
    const ignoredStatuses = [
      LeaveRequestStatus.REFUSEE,
      LeaveRequestStatus.ANNULEE,
      LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
      LeaveRequestStatus.EXPIREE_NON_VALIDEE,
    ];

    const overlappingRequest = await manager
      .getRepository(LeaveRequest)
      .createQueryBuilder('otherRequest')
      .where('otherRequest.employeeId = :employeeId', {
        employeeId: leaveRequest.employeeId,
      })
      .andWhere('otherRequest.id <> :requestId', {
        requestId: leaveRequest.id,
      })
      .andWhere('otherRequest.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .andWhere('otherRequest.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('otherRequest.status NOT IN (:...ignoredStatuses)', {
        ignoredStatuses,
      })
      .orderBy('otherRequest.startDate', 'ASC')
      .getOne();

    if (overlappingRequest) {
      throw new BadRequestException(
        `Cette demande chevauche votre demande n°${overlappingRequest.id} du ${overlappingRequest.startDate} au ${overlappingRequest.endDate}.`,
      );
    }
  }

  private validateSubmissionNotice(
    startDateValue: string,
    endDateValue: string,
    calendarDuration: number,
  ): SubmissionNoticeResult {
    const startDate = this.parseDate(startDateValue);
    const endDate = this.parseDate(endDateValue);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const daysBeforeStart = Math.floor(
      (startDate.getTime() - today.getTime()) /
        millisecondsPerDay,
    );

    if (daysBeforeStart < 0) {
      throw new BadRequestException(
        'Une demande ne peut pas être soumise après sa date de début.',
      );
    }

    if (daysBeforeStart < 3) {
      throw new BadRequestException(
        'La demande ne peut plus être soumise à partir de J-2. Le départ doit être prévu au moins trois jours calendaires à l’avance.',
      );
    }

    const isLongLeave = calendarDuration >= 21;
    const overlapsSummerPeriod = this.overlapsSummerPeriod(
      startDate,
      endDate,
    );
    const requiredNoticeDays: 30 | 60 =
      isLongLeave || overlapsSummerPeriod ? 60 : 30;

    if (daysBeforeStart < requiredNoticeDays) {
      if (daysBeforeStart <= 29) {
        throw new BadRequestException(
          `La demande est déposée à J-${daysBeforeStart}. Une dérogation RH accordée est obligatoire entre J-29 et J-3.`,
        );
      }

      throw new BadRequestException(
        `Cette demande exige un délai de ${requiredNoticeDays} jours calendaires. Le délai actuel est de ${daysBeforeStart} jours.`,
      );
    }

    return {
      daysBeforeStart,
      requiredNoticeDays,
      isLongLeave,
      overlapsSummerPeriod,
    };
  }

  private overlapsSummerPeriod(
    startDate: Date,
    endDate: Date,
  ): boolean {
    for (
      let year = startDate.getUTCFullYear();
      year <= endDate.getUTCFullYear();
      year += 1
    ) {
      const summerStart = new Date(
        Date.UTC(year, 4, 1),
      );
      const summerEnd = new Date(
        Date.UTC(year, 9, 31),
      );

      if (
        startDate.getTime() <= summerEnd.getTime() &&
        endDate.getTime() >= summerStart.getTime()
      ) {
        return true;
      }
    }

    return false;
  }

  private validateAndNormalizeSignature(
    signatureType: SignatureType,
    signatureDataValue: string,
  ): string {
    const signatureData = signatureDataValue.trim();

    if (signatureType === SignatureType.INITIALS) {
      const letterCount = (signatureData.match(/\p{L}/gu) ?? [])
        .length;

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

    if (decodedSignature.length === 0) {
      throw new BadRequestException(
        'La signature dessinée est vide.',
      );
    }

    if (decodedSignature.length > 500 * 1024) {
      throw new BadRequestException(
        'La signature dessinée ne doit pas dépasser 500 Ko.',
      );
    }

    return signatureData;
  }

  private async validateAndCalculateDates(
    startDateValue: string,
    endDateValue: string,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
    allowsHalfDays: boolean,
  ): Promise<{
    calendarDuration: number;
    deductedDays: number;
  }> {
    const startDate = this.parseDate(startDateValue);
    const endDate = this.parseDate(endDateValue);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début.',
      );
    }

    const nonDeductibleDays =
      await this.holidaysService.findNonDeductibleBetween(
        startDateValue,
        endDateValue,
      );

    const nonDeductibleDaysByDate = new Map(
      nonDeductibleDays.map((day) => [day.date, day]),
    );

    this.validateBoundaryDate(
      startDateValue,
      startDate,
      nonDeductibleDaysByDate.get(startDateValue),
      'début',
    );

    this.validateBoundaryDate(
      endDateValue,
      endDate,
      nonDeductibleDaysByDate.get(endDateValue),
      'fin',
    );

    if (
      !allowsHalfDays &&
      (startPeriod !== DayPeriod.MATIN ||
        endPeriod !== DayPeriod.APRES_MIDI)
    ) {
      throw new BadRequestException(
        'Le type sélectionné n’autorise pas les demi-journées.',
      );
    }

    if (
      startDate.getTime() === endDate.getTime() &&
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.MATIN
    ) {
      throw new BadRequestException(
        'La période de fin ne peut pas précéder la période de début.',
      );
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const calendarDuration =
      Math.floor(
        (endDate.getTime() - startDate.getTime()) /
          millisecondsPerDay,
      ) + 1;

    return {
      calendarDuration,
      deductedDays: this.calculateDeductedDays(
        startDate,
        endDate,
        startPeriod,
        endPeriod,
        new Set(nonDeductibleDaysByDate.keys()),
      ),
    };
  }

  private calculateDeductedDays(
    startDate: Date,
    endDate: Date,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
    nonDeductibleDates: Set<string>,
  ): number {
    let total = 0;
    const currentDate = new Date(startDate);

    while (currentDate.getTime() <= endDate.getTime()) {
      const currentDateValue = currentDate.toISOString().slice(0, 10);
      const isSunday = currentDate.getUTCDay() === 0;
      const isNonDeductible =
        nonDeductibleDates.has(currentDateValue);

      if (!isSunday && !isNonDeductible) {
        let value = 1;

        if (
          currentDate.getTime() === startDate.getTime() &&
          startPeriod === DayPeriod.APRES_MIDI
        ) {
          value -= 0.5;
        }

        if (
          currentDate.getTime() === endDate.getTime() &&
          endPeriod === DayPeriod.MATIN
        ) {
          value -= 0.5;
        }

        total += value;
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return Math.max(total, 0);
  }

  private validateBoundaryDate(
    dateValue: string,
    date: Date,
    nonDeductibleDay: Holiday | undefined,
    boundary: 'début' | 'fin',
  ): void {
    if (date.getUTCDay() === 0) {
      throw new BadRequestException(
        `La date de ${boundary} ne peut pas être un dimanche.`,
      );
    }

    if (nonDeductibleDay) {
      throw new BadRequestException(
        `La date de ${boundary} ${dateValue} correspond à « ${nonDeductibleDay.name} » et n’est pas décomptable.`,
      );
    }
  }

  private calculateModificationDeadline(
    startDateValue: string,
  ): string {
    const startDate = this.parseDate(startDateValue);
    startDate.setUTCDate(startDate.getUTCDate() - 7);

    return startDate.toISOString().slice(0, 10);
  }

  private parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        'Une des dates fournies n’est pas valide.',
      );
    }

    return date;
  }
}
