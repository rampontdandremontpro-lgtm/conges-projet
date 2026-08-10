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

/**
 * Statut de présence calculé, jamais dérivé du seul champ `users.presence_status`
 * (cache d'affichage).
 *
 * Règles par slot (MATIN / APRES_MIDI) — demi-journées, OPTION D :
 *  - ABSENT      : une absence ENREGISTREE couvre le slot (occupiesSlot) ;
 *  - EN_VACANCES : un congé VALIDEE (ou en cours d'annulation après
 *                  validation) couvre le slot ;
 *  - PRESENT     : aucun des cas ci-dessus.
 *
 * Priorité : ABSENT > EN_VACANCES > PRESENT.
 *
 * Les demandes REFUSEE, ANNULEE, ANNULEE_APRES_VALIDATION, EXPIREE_NON_VALIDEE
 * et les absences ANNULEES ne comptent pas.
 */
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

  /**
   * Slot courant (MATIN / APRES_MIDI) en America/Martinique à partir du
   * paramètre AFTERNOON_START_HOUR (défaut 12:00).
   */
  async getCurrentSlot(now: Date = new Date()): Promise<DayPeriod> {
    const afternoonStartHour = await this.settingsService.getString(
      'AFTERNOON_START_HOUR',
      '12:00',
    );
    return getCurrentDayPeriod(now, afternoonStartHour);
  }

  /**
   * Statut de présence pour un slot donné (date + période), en réutilisant
   * la logique partagée occupiesSlot() — MÊME définition que la présence
   * minimale. `manager` permet de rester cohérent dans une transaction.
   */
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

  /**
   * Disponibilité d'un collaborateur pour une date complète (défaut :
   * aujourd'hui, America/Martinique) : statut et disponibilité de chacun
   * des deux slots MATIN et APRES_MIDI.
   */
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

  /**
   * Statut de présence d'un collaborateur pour la date donnée (défaut :
   * aujourd'hui) et le SLOT COURANT.
   *
   * Depuis l'option demi-journées, le statut reflète le slot courant
   * (12:00 inclus → APRES_MIDI, paramètre AFTERNOON_START_HOUR). Les
   * consommateurs qui évaluent « en ce moment » (relais du Responsable,
   * destinataires des notifications, services) obtiennent ainsi une
   * disponibilité à l'instant de la décision, sans rien changer à leur
   * appel. `now` permet de simuler l'heure dans les tests.
   */
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

  /**
   * Recalcule et enregistre le statut d'un collaborateur (champ
   * `users.presence_status`, conservé pour l'affichage) — statut du SLOT
   * COURANT.
   */
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

  /**
   * Recalcule le statut de tous les collaborateurs actifs pour le slot
   * courant. Le slot est lu UNE SEULE FOIS (et non par collaborateur).
   * N'écrit en base que lorsque le statut a changé.
   */
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
