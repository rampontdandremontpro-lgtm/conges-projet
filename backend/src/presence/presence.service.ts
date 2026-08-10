import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import { SettingsService } from '../settings/settings.service';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import {
  getCurrentDayPeriod,
  getMartiniqueDateString,
  occupiesSlot,
} from '../leave-requests/leave-request-period.util';
import { PresenceStatus, User } from '../users/user.entity';

export interface SlotAvailability {
  status: PresenceStatus;
  available: boolean;
}

export interface DailyAvailability {
  date: string;
  morning: SlotAvailability;
  afternoon: SlotAvailability;
}

@Injectable()
export class PresenceService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    @InjectRepository(AbsenceDeclaration)
    private readonly absenceDeclarationRepository: Repository<AbsenceDeclaration>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly settingsService: SettingsService,

    private readonly dataSource: DataSource,
  ) {}

  async getCurrentSlot(now: Date = new Date()): Promise<DayPeriod> {
    const afternoonStartHour = await this.settingsService.getString(
      'AFTERNOON_START_HOUR',
      '12:00',
    );
    return getCurrentDayPeriod(now, afternoonStartHour);
  }

  async computeStatusForPeriod(
    employeeId: number,
    date: string,
    period: DayPeriod,
    manager?: EntityManager,
  ): Promise<PresenceStatus> {
    const absenceRepository = manager
      ? manager.getRepository(AbsenceDeclaration)
      : this.absenceDeclarationRepository;

    const absences = await absenceRepository.find({
      where: {
        employeeId,
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
        status: AbsenceDeclarationStatus.ENREGISTREE,
      },
    });

    if (
      absences.some((absence) => occupiesSlot(absence, date, period))
    ) {
      return PresenceStatus.ABSENT;
    }

    const leaveRepository = manager
      ? manager.getRepository(LeaveRequest)
      : this.leaveRequestRepository;

    const leaves = await leaveRepository.find({
      where: {
        employeeId,
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
        status: In([
          LeaveRequestStatus.VALIDEE,
          LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
        ]),
      },
    });

    if (leaves.some((leave) => occupiesSlot(leave, date, period))) {
      return PresenceStatus.EN_VACANCES;
    }

    return PresenceStatus.PRESENT;
  }

  async computeDailyAvailability(
    employeeId: number,
    dateValue?: string,
    manager?: EntityManager,
  ): Promise<DailyAvailability> {
    const date = dateValue ?? getMartiniqueDateString(new Date());

    const morningStatus = await this.computeStatusForPeriod(
      employeeId,
      date,
      DayPeriod.MATIN,
      manager,
    );
    const afternoonStatus = await this.computeStatusForPeriod(
      employeeId,
      date,
      DayPeriod.APRES_MIDI,
      manager,
    );

    return {
      date,
      morning: {
        status: morningStatus,
        available: morningStatus === PresenceStatus.PRESENT,
      },
      afternoon: {
        status: afternoonStatus,
        available: afternoonStatus === PresenceStatus.PRESENT,
      },
    };
  }

  async computeStatus(
    employeeId: number,
    dateValue?: string,
    manager?: EntityManager,
    now: Date = new Date(),
  ): Promise<PresenceStatus> {
    const date = dateValue ?? getMartiniqueDateString(now);
    const slot = await this.getCurrentSlot(now);
    return this.computeStatusForPeriod(employeeId, date, slot, manager);
  }

  async refreshUserStatus(
    employeeId: number,
    manager?: EntityManager,
  ): Promise<PresenceStatus> {
    const status = await this.computeStatus(
      employeeId,
      undefined,
      manager,
    );
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;

    await userRepository.update(
      { id: employeeId },
      { presenceStatus: status },
    );

    return status;
  }

  async refreshAllStatuses(
    manager?: EntityManager,
  ): Promise<{ updated: number }> {
    const userRepository = manager
      ? manager.getRepository(User)
      : this.userRepository;

    const users = await userRepository.find({
      where: { isActive: true },
      select: { id: true, presenceStatus: true },
    });

    const slot = await this.getCurrentSlot();
    const today = getMartiniqueDateString(new Date());

    let updated = 0;

    for (const user of users) {
      const status = await this.computeStatusForPeriod(
        user.id,
        today,
        slot,
        manager,
      );

      if (status !== user.presenceStatus) {
        await userRepository.update(
          { id: user.id },
          { presenceStatus: status },
        );
        updated += 1;
      }
    }

    return { updated };
  }
}
