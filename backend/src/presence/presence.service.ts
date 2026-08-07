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
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { PresenceStatus, User } from '../users/user.entity';

/**
 * Statut de présence calculé, jamais dérivé du seul champ `users.presence_status`
 * (qui peut devenir obsolète).
 *
 * Règles :
 *  - ABSENT      : une déclaration d'absence ENREGISTREE couvre la date ;
 *  - EN_VACANCES : une demande de congé VALIDEE (ou en cours d'annulation
 *                  après validation) couvre la date ;
 *  - PRESENT     : aucun des cas ci-dessus.
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

    private readonly dataSource: DataSource,
  ) {}

  /**
   * Calcule le statut de présence d'un collaborateur pour une date donnée
   * (défaut : aujourd'hui, fuseau America/Martinique).
   * `manager` permet de rester cohérent dans une transaction.
   */
  async computeStatus(
    employeeId: number,
    dateValue?: string,
    manager?: EntityManager,
  ): Promise<PresenceStatus> {
    const date =
      dateValue ?? this.getMartiniqueDateString(new Date());

    const absenceRepository = manager
      ? manager.getRepository(AbsenceDeclaration)
      : this.absenceDeclarationRepository;

    const registeredAbsenceCount = await absenceRepository.count({
      where: {
        employeeId,
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
        status: AbsenceDeclarationStatus.ENREGISTREE,
      },
    });

    if (registeredAbsenceCount > 0) {
      return PresenceStatus.ABSENT;
    }

    const leaveRepository = manager
      ? manager.getRepository(LeaveRequest)
      : this.leaveRequestRepository;

    const validatedLeaveCount = await leaveRepository.count({
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

    if (validatedLeaveCount > 0) {
      return PresenceStatus.EN_VACANCES;
    }

    return PresenceStatus.PRESENT;
  }

  /**
   * Recalcule et enregistre le statut d'un collaborateur (champ
   * `users.presence_status`, conservé pour l'affichage).
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
   * Recalcule le statut de tous les collaborateurs actifs. N'écrit en base
   * que lorsque le statut a changé.
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

    let updated = 0;

    for (const user of users) {
      const status = await this.computeStatus(
        user.id,
        undefined,
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

  private getMartiniqueDateString(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Martinique',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }
}
