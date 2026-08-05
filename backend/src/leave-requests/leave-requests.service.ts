import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LeaveTypeCategory } from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import { UsersService } from '../users/users.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
} from './leave-request.entity';

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    private readonly usersService: UsersService,

    private readonly leaveTypesService: LeaveTypesService,
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

    const dates = this.validateAndCalculateDates(
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
      version: 1,
    });

    const savedRequest = await this.leaveRequestRepository.save(
      leaveRequest,
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
      updateLeaveRequestDto.startPeriod ??
      leaveRequest.startPeriod;
    const endPeriod =
      updateLeaveRequestDto.endPeriod ?? leaveRequest.endPeriod;

    const dates = this.validateAndCalculateDates(
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

  private validateLeaveType(
    leaveType: Awaited<
      ReturnType<LeaveTypesService['findOne']>
    >,
  ): void {
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
  }

  private ensureDraft(leaveRequest: LeaveRequest): void {
    if (leaveRequest.status !== LeaveRequestStatus.BROUILLON) {
      throw new BadRequestException(
        'Seule une demande au statut BROUILLON peut être modifiée ou supprimée.',
      );
    }
  }

  private validateAndCalculateDates(
    startDateValue: string,
    endDateValue: string,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
    allowsHalfDays: boolean,
  ): {
    calendarDuration: number;
    deductedDays: number;
  } {
    const startDate = this.parseDate(startDateValue);
    const endDate = this.parseDate(endDateValue);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début.',
      );
    }

    if (
      startDate.getUTCDay() === 0 ||
      endDate.getUTCDay() === 0
    ) {
      throw new BadRequestException(
        'Une demande ne peut pas commencer ou se terminer un dimanche.',
      );
    }

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
      ),
    };
  }

  private calculateDeductedDays(
    startDate: Date,
    endDate: Date,
    startPeriod: DayPeriod,
    endPeriod: DayPeriod,
  ): number {
    let total = 0;
    const currentDate = new Date(startDate);

    while (currentDate.getTime() <= endDate.getTime()) {
      const isSunday = currentDate.getUTCDay() === 0;

      if (!isSunday) {
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
