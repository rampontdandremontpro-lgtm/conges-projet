import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import { HolidaysService } from '../holidays/holidays.service';
import { Service } from '../services/service.entity';
import { User, UserRole } from '../users/user.entity';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
} from './leave-request.entity';
import { occupiesSlot } from './leave-request-period.util';

export interface ServiceOverlapItem {
  employeeId: number;
  nom: string;
  prenom: string;
  source: 'DEMANDE_CONGE' | 'DECLARATION_ABSENCE';
  sourceId: number;
  status: string;
  startDate: string;
  endDate: string;
  startPeriod: DayPeriod | null;
  endPeriod: DayPeriod | null;
}

export interface PresenceSlotAnalysis {
  date: string;
  period: DayPeriod;
  absentEmployeeIds: number[];
  remainingEmployees: number;
  minimumPresence: number | null;
  minimumRespected: boolean;
}

export interface ServiceAvailabilityAnalysis {
  serviceId: number;
  serviceName: string;
  totalActiveEmployees: number;
  hasMinimumPresenceRule: boolean;
  minimumPresence: number | null;
  minimumRemainingEmployees: number;
  minimumPresenceBreached: boolean;
  requiresJustification: boolean;
  overlaps: ServiceOverlapItem[];
  slots: PresenceSlotAnalysis[];
}

@Injectable()
export class ServiceAvailabilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly holidaysService: HolidaysService,
  ) {}

  async analyzeLeaveRequest(
    leaveRequest: LeaveRequest,
    manager?: EntityManager,
  ): Promise<ServiceAvailabilityAnalysis> {
    const entityManager = manager ?? this.dataSource.manager;
    const service =
      leaveRequest.service ??
      (await entityManager.getRepository(Service).findOneByOrFail({
        id: leaveRequest.serviceId,
      }));

    const activeEmployees = await entityManager.getRepository(User).find({
      where: {
        serviceId: leaveRequest.serviceId,
        isActive: true,
        role: In([
          UserRole.COLLABORATEUR,
          UserRole.RESPONSABLE_SERVICE,
          UserRole.RH,
          UserRole.DIRECTEUR,
        ]),
      },
      order: { nom: 'ASC', prenom: 'ASC' },
    });

    const employeeIds = activeEmployees.map((employee) => employee.id);

    if (employeeIds.length === 0) {
      return {
        serviceId: service.id,
        serviceName: service.name,
        totalActiveEmployees: 0,
        hasMinimumPresenceRule: service.hasMinimumPresenceRule,
        minimumPresence: service.minimumPresence,
        minimumRemainingEmployees: 0,
        minimumPresenceBreached:
          service.hasMinimumPresenceRule &&
          (service.minimumPresence ?? 0) > 0,
        requiresJustification: service.hasMinimumPresenceRule,
        overlaps: [],
        slots: [],
      };
    }

    const requests = await entityManager
      .getRepository(LeaveRequest)
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employee', 'employee')
      .where('request.serviceId = :serviceId', {
        serviceId: leaveRequest.serviceId,
      })
      .andWhere('request.id <> :requestId', {
        requestId: leaveRequest.id,
      })
      .andWhere('request.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .andWhere('request.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [
          LeaveRequestStatus.EN_ATTENTE_VALIDATION,
          LeaveRequestStatus.VALIDEE,
        ],
      })
      .getMany();

    const absences = await entityManager
      .getRepository(AbsenceDeclaration)
      .createQueryBuilder('absence')
      .leftJoinAndSelect('absence.employee', 'employee')
      .where('absence.serviceId = :serviceId', {
        serviceId: leaveRequest.serviceId,
      })
      .andWhere('absence.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .andWhere('absence.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('absence.status IN (:...statuses)', {
        statuses: [
          AbsenceDeclarationStatus.DECLAREE,
          AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
          AbsenceDeclarationStatus.A_VERIFIER_PAR_RH,
          AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
          AbsenceDeclarationStatus.ENREGISTREE,
        ],
      })
      .getMany();

    const overlaps: ServiceOverlapItem[] = [
      ...requests.map((request) => ({
        employeeId: request.employeeId,
        nom: request.employee.nom,
        prenom: request.employee.prenom,
        source: 'DEMANDE_CONGE' as const,
        sourceId: request.id,
        status: request.status,
        startDate: request.startDate,
        endDate: request.endDate,
        startPeriod: request.startPeriod,
        endPeriod: request.endPeriod,
      })),
      ...absences.map((absence) => ({
        employeeId: absence.employeeId,
        nom: absence.employee.nom,
        prenom: absence.employee.prenom,
        source: 'DECLARATION_ABSENCE' as const,
        sourceId: absence.id,
        status: absence.status,
        startDate: absence.startDate,
        endDate: absence.endDate,
        startPeriod: absence.startPeriod,
        endPeriod: absence.endPeriod,
      })),
    ].sort((a, b) =>
      `${a.startDate}-${a.nom}-${a.prenom}`.localeCompare(
        `${b.startDate}-${b.nom}-${b.prenom}`,
        'fr',
      ),
    );

    const holidays =
      await this.holidaysService.findNonDeductibleBetween(
        leaveRequest.startDate,
        leaveRequest.endDate,
      );
    const nonWorkingDates = new Set(
      holidays.map((holiday) => holiday.date),
    );

    const slots: PresenceSlotAnalysis[] = [];
    const current = this.parseDate(leaveRequest.startDate);
    const end = this.parseDate(leaveRequest.endDate);

    while (current.getTime() <= end.getTime()) {
      const date = current.toISOString().slice(0, 10);

      if (current.getUTCDay() !== 0 && !nonWorkingDates.has(date)) {
        for (const period of [DayPeriod.MATIN, DayPeriod.APRES_MIDI]) {
          if (!occupiesSlot(leaveRequest, date, period)) {
            continue;
          }

          const absentEmployeeIds = new Set<number>([
            leaveRequest.employeeId,
          ]);

          for (const request of requests) {
            if (occupiesSlot(request, date, period)) {
              absentEmployeeIds.add(request.employeeId);
            }
          }

          for (const absence of absences) {
            if (occupiesSlot(absence, date, period)) {
              absentEmployeeIds.add(absence.employeeId);
            }
          }

          const remainingEmployees = Math.max(
            activeEmployees.length - absentEmployeeIds.size,
            0,
          );
          const minimumPresence = service.hasMinimumPresenceRule
            ? service.minimumPresence ?? 0
            : null;

          slots.push({
            date,
            period,
            absentEmployeeIds: [...absentEmployeeIds].sort(
              (a, b) => a - b,
            ),
            remainingEmployees,
            minimumPresence,
            minimumRespected:
              minimumPresence === null ||
              remainingEmployees >= minimumPresence,
          });
        }
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    const minimumRemainingEmployees =
      slots.length > 0
        ? Math.min(...slots.map((slot) => slot.remainingEmployees))
        : activeEmployees.length;
    const minimumPresenceBreached = slots.some(
      (slot) => !slot.minimumRespected,
    );

    return {
      serviceId: service.id,
      serviceName: service.name,
      totalActiveEmployees: activeEmployees.length,
      hasMinimumPresenceRule: service.hasMinimumPresenceRule,
      minimumPresence: service.hasMinimumPresenceRule
        ? service.minimumPresence ?? 0
        : null,
      minimumRemainingEmployees,
      minimumPresenceBreached,
      requiresJustification: minimumPresenceBreached,
      overlaps,
      slots,
    };
  }

  private parseDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
