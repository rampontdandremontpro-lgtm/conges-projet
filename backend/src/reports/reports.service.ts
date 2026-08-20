import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  StatisticsDataType,
  StatisticsQueryDto,
} from './dto/statistics-query.dto';

interface CountRow {
  label: string;
  total: string | number;
}

interface LeaveTotalsRow {
  leaveRequests: string | number;
  validatedRequests: string | number;
  refusedRequests: string | number;
  pendingRequests: string | number;
  leaveDays: string | number | null;
}

interface AbsenceTotalsRow {
  absenceDeclarations: string | number;
  recordedAbsences: string | number;
  absenceDays: string | number | null;
}

interface ServiceRow {
  id: string | number;
  name: string;
}

interface ServiceAggregateRow {
  serviceId: string | number;
  total: string | number;
  validated?: string | number;
  refused?: string | number;
  pending?: string | number;
  days?: string | number | null;
}

interface UserCapacityRow {
  id: string | number;
  serviceId: string | number | null;
  hireDate: string | null;
}

interface LeaveTypeRow {
  label: string;
  category: string;
  total: string | number;
}

interface MonthRow {
  monthKey: string;
  total: string | number;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async getDirectorStatistics(
    query: StatisticsQueryDto,
    actor: AuthenticatedUser,
  ) {
    const { startDate, endDate } = this.resolvePeriod(query);
    const dataType = query.dataType ?? StatisticsDataType.ALL;
    const includeLeave = dataType !== StatisticsDataType.ABSENCE;
    const includeAbsence = dataType !== StatisticsDataType.LEAVE;
    const userFilter = this.buildUserFilter(query);

    const leaveWhere = `
      lr.start_date <= ?
      AND lr.end_date >= ?
      AND lr.status <> 'BROUILLON'
      AND ${userFilter.sql}
    `;
    const absenceWhere = `
      ad.start_date <= ?
      AND ad.end_date >= ?
      AND ad.status <> 'BROUILLON'
      AND ${userFilter.sql}
    `;

    const leaveParams = [endDate, startDate, ...userFilter.params];
    const absenceParams = [endDate, startDate, ...userFilter.params];

    const [
      leaveTotalsRows,
      absenceTotalsRows,
      leaveStatusRows,
      absenceStatusRows,
      services,
      users,
      holidays,
      leaveByServiceRows,
      absenceByServiceRows,
      leaveTypeRows,
      absenceTypeRows,
      leaveMonthRows,
      absenceMonthRows,
    ] = await Promise.all([
      includeLeave
        ? this.dataSource.query<LeaveTotalsRow[]>(
            `
              SELECT
                COUNT(*) AS leaveRequests,
                SUM(lr.status = 'VALIDEE') AS validatedRequests,
                SUM(lr.status = 'REFUSEE') AS refusedRequests,
                SUM(lr.status = 'EN_ATTENTE_VALIDATION') AS pendingRequests,
                COALESCE(SUM(CASE WHEN lr.status = 'VALIDEE' THEN lr.deducted_days ELSE 0 END), 0) AS leaveDays
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              WHERE ${leaveWhere}
            `,
            leaveParams,
          )
        : Promise.resolve([] as LeaveTotalsRow[]),
      includeAbsence
        ? this.dataSource.query<AbsenceTotalsRow[]>(
            `
              SELECT
                COUNT(*) AS absenceDeclarations,
                SUM(ad.status = 'ENREGISTREE') AS recordedAbsences,
                COALESCE(SUM(CASE WHEN ad.status = 'ENREGISTREE' THEN COALESCE(ad.duration_days, 0) ELSE 0 END), 0) AS absenceDays
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              WHERE ${absenceWhere}
            `,
            absenceParams,
          )
        : Promise.resolve([] as AbsenceTotalsRow[]),
      includeLeave
        ? this.dataSource.query<CountRow[]>(
            `
              SELECT lr.status AS label, COUNT(*) AS total
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              WHERE ${leaveWhere}
              GROUP BY lr.status
              ORDER BY lr.status
            `,
            leaveParams,
          )
        : Promise.resolve([] as CountRow[]),
      includeAbsence
        ? this.dataSource.query<CountRow[]>(
            `
              SELECT ad.status AS label, COUNT(*) AS total
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              WHERE ${absenceWhere}
              GROUP BY ad.status
              ORDER BY ad.status
            `,
            absenceParams,
          )
        : Promise.resolve([] as CountRow[]),
      this.dataSource.query<ServiceRow[]>(
        `
          SELECT
            s.id,
            CASE
              WHEN s.external_company_name IS NULL THEN s.name
              ELSE CONCAT(s.external_company_name, ' — ', s.name)
            END AS name
          FROM services s
          WHERE s.is_active = 1
          ${query.serviceId ? 'AND s.id = ?' : ''}
          ORDER BY name
        `,
        query.serviceId ? [query.serviceId] : [],
      ),
      this.dataSource.query<UserCapacityRow[]>(
        `
          SELECT u.id, u.service_id AS serviceId, u.hire_date AS hireDate
          FROM users u
          WHERE ${userFilter.sql}
        `,
        userFilter.params,
      ),
      this.dataSource.query<Array<{ date: string }>>(
        `
          SELECT DISTINCT date
          FROM holidays
          WHERE is_active = 1
            AND deductible = 0
            AND date BETWEEN ? AND ?
        `,
        [startDate, endDate],
      ),
      includeLeave
        ? this.dataSource.query<ServiceAggregateRow[]>(
            `
              SELECT
                lr.service_id AS serviceId,
                COUNT(*) AS total,
                SUM(lr.status = 'VALIDEE') AS validated,
                SUM(lr.status = 'REFUSEE') AS refused,
                SUM(lr.status = 'EN_ATTENTE_VALIDATION') AS pending,
                COALESCE(SUM(CASE WHEN lr.status = 'VALIDEE' THEN lr.deducted_days ELSE 0 END), 0) AS days
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              WHERE ${leaveWhere}
              GROUP BY lr.service_id
            `,
            leaveParams,
          )
        : Promise.resolve([] as ServiceAggregateRow[]),
      includeAbsence
        ? this.dataSource.query<ServiceAggregateRow[]>(
            `
              SELECT
                ad.service_id AS serviceId,
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN ad.status = 'ENREGISTREE' THEN COALESCE(ad.duration_days, 0) ELSE 0 END), 0) AS days
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              WHERE ${absenceWhere}
              GROUP BY ad.service_id
            `,
            absenceParams,
          )
        : Promise.resolve([] as ServiceAggregateRow[]),
      includeLeave
        ? this.dataSource.query<LeaveTypeRow[]>(
            `
              SELECT lt.name AS label, 'DEMANDE_CONGE' AS category, COUNT(*) AS total
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
              WHERE ${leaveWhere}
              GROUP BY lt.id, lt.name
              ORDER BY total DESC, lt.name
            `,
            leaveParams,
          )
        : Promise.resolve([] as LeaveTypeRow[]),
      includeAbsence
        ? this.dataSource.query<LeaveTypeRow[]>(
            `
              SELECT lt.name AS label, 'DECLARATION_ABSENCE' AS category, COUNT(*) AS total
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              INNER JOIN leave_types lt ON lt.id = ad.leave_type_id
              WHERE ${absenceWhere}
              GROUP BY lt.id, lt.name
              ORDER BY total DESC, lt.name
            `,
            absenceParams,
          )
        : Promise.resolve([] as LeaveTypeRow[]),
      includeLeave
        ? this.dataSource.query<MonthRow[]>(
            `
              SELECT DATE_FORMAT(lr.start_date, '%Y-%m') AS monthKey, COUNT(*) AS total
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              WHERE ${leaveWhere}
              GROUP BY DATE_FORMAT(lr.start_date, '%Y-%m')
              ORDER BY monthKey
            `,
            leaveParams,
          )
        : Promise.resolve([] as MonthRow[]),
      includeAbsence
        ? this.dataSource.query<MonthRow[]>(
            `
              SELECT DATE_FORMAT(ad.start_date, '%Y-%m') AS monthKey, COUNT(*) AS total
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              WHERE ${absenceWhere}
              GROUP BY DATE_FORMAT(ad.start_date, '%Y-%m')
              ORDER BY monthKey
            `,
            absenceParams,
          )
        : Promise.resolve([] as MonthRow[]),
    ]);

    const leaveTotals = leaveTotalsRows[0];
    const absenceTotals = absenceTotalsRows[0];
    const leaveDays = this.number(leaveTotals?.leaveDays);
    const absenceDays = this.number(absenceTotals?.absenceDays);
    const holidayDates = new Set(holidays.map((holiday) => holiday.date));
    const capacityByService = new Map<number, number>();
    const employeesByService = new Map<number, number>();

    let totalCapacity = 0;
    for (const user of users) {
      const capacity = this.businessDaysForUser(
        startDate,
        endDate,
        user.hireDate,
        holidayDates,
      );
      totalCapacity += capacity;

      if (user.serviceId !== null) {
        const serviceId = this.number(user.serviceId);
        capacityByService.set(
          serviceId,
          (capacityByService.get(serviceId) ?? 0) + capacity,
        );
        employeesByService.set(
          serviceId,
          (employeesByService.get(serviceId) ?? 0) + 1,
        );
      }
    }

    const leaveByService = new Map(
      leaveByServiceRows.map((row) => [this.number(row.serviceId), row]),
    );
    const absenceByService = new Map(
      absenceByServiceRows.map((row) => [this.number(row.serviceId), row]),
    );

    const byService = services.map((service) => {
      const serviceId = this.number(service.id);
      const leave = leaveByService.get(serviceId);
      const absence = absenceByService.get(serviceId);
      const serviceLeaveDays = this.number(leave?.days);
      const serviceAbsenceDays = this.number(absence?.days);
      const capacity = capacityByService.get(serviceId) ?? 0;

      return {
        serviceId,
        serviceName: service.name,
        activeEmployees: employeesByService.get(serviceId) ?? 0,
        presenceRate: this.presenceRate(
          capacity,
          serviceLeaveDays + serviceAbsenceDays,
        ),
        leaveRequests: this.number(leave?.total),
        validatedRequests: this.number(leave?.validated),
        refusedRequests: this.number(leave?.refused),
        pendingRequests: this.number(leave?.pending),
        absenceDeclarations: this.number(absence?.total),
        leaveDays: serviceLeaveDays,
        absenceDays: serviceAbsenceDays,
      };
    });

    const byLeaveType = [...leaveTypeRows, ...absenceTypeRows]
      .map((row) => ({
        label: row.label,
        category: row.category,
        total: this.number(row.total),
      }))
      .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));

    const leaveMonths = new Map(
      leaveMonthRows.map((row) => [row.monthKey, this.number(row.total)]),
    );
    const absenceMonths = new Map(
      absenceMonthRows.map((row) => [row.monthKey, this.number(row.total)]),
    );
    const byMonth = this.monthKeysBetween(startDate, endDate).map((monthKey) => ({
      monthKey,
      leaveRequests: leaveMonths.get(monthKey) ?? 0,
      absenceDeclarations: absenceMonths.get(monthKey) ?? 0,
    }));

    const processedRequests =
      this.number(leaveTotals?.validatedRequests) +
      this.number(leaveTotals?.refusedRequests);

    const result = {
      period: { startDate, endDate },
      generatedAt: new Date(),
      filters: {
        serviceId: query.serviceId ?? null,
        role: query.role ?? null,
        dataType,
      },
      confidentiality:
        'Données agrégées et non nominatives. Aucun justificatif, commentaire médical, nom ou adresse e-mail n’est exposé.',
      totals: {
        activeEmployees: users.length,
        presenceRate: this.presenceRate(
          totalCapacity,
          leaveDays + absenceDays,
        ),
        leaveRequests: this.number(leaveTotals?.leaveRequests),
        validatedRequests: this.number(leaveTotals?.validatedRequests),
        refusedRequests: this.number(leaveTotals?.refusedRequests),
        pendingRequests: this.number(leaveTotals?.pendingRequests),
        processedRequests,
        absenceDeclarations: this.number(absenceTotals?.absenceDeclarations),
        recordedAbsences: this.number(absenceTotals?.recordedAbsences),
        leaveDays,
        absenceDays,
        deductedDays: leaveDays,
      },
      leaveRequestsByStatus: leaveStatusRows.map((row) => ({
        status: row.label,
        total: this.number(row.total),
      })),
      absenceDeclarationsByStatus: absenceStatusRows.map((row) => ({
        status: row.label,
        total: this.number(row.total),
      })),
      byService,
      byLeaveType,
      byMonth,
    };

    await this.auditService.record({
      actorId: actor.id,
      action: actor.role === 'RH' ? 'RH_STATISTICS_VIEWED' : 'DIRECTOR_STATISTICS_VIEWED',
      resourceType: 'REPORT',
      resourceId: null,
      newValue: {
        startDate,
        endDate,
        serviceId: query.serviceId ?? null,
        role: query.role ?? null,
        dataType,
      },
    });

    return result;
  }

  private resolvePeriod(query: StatisticsQueryDto): {
    startDate: string;
    endDate: string;
  } {
    if (query.startDate || query.endDate) {
      if (!query.startDate || !query.endDate) {
        throw new BadRequestException(
          'Les dates de début et de fin doivent être renseignées ensemble.',
        );
      }
      if (query.startDate > query.endDate) {
        throw new BadRequestException(
          'La date de début doit être antérieure ou égale à la date de fin.',
        );
      }
      return { startDate: query.startDate, endDate: query.endDate };
    }

    const year = query.year ?? new Date().getFullYear();
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }

  private buildUserFilter(query: StatisticsQueryDto): {
    sql: string;
    params: Array<string | number>;
  } {
    const conditions = ["u.is_active = 1", "u.role <> 'ADMIN'"];
    const params: Array<string | number> = [];

    if (query.serviceId) {
      conditions.push('u.service_id = ?');
      params.push(query.serviceId);
    }

    if (query.role) {
      conditions.push('u.role = ?');
      params.push(query.role);
    }

    return {
      sql: conditions.join(' AND '),
      params,
    };
  }

  private businessDaysForUser(
    startDate: string,
    endDate: string,
    hireDate: string | null,
    holidayDates: Set<string>,
  ): number {
    const effectiveStart = hireDate && hireDate > startDate ? hireDate : startDate;
    if (effectiveStart > endDate) return 0;

    const current = this.utcDate(effectiveStart);
    const end = this.utcDate(endDate);
    let total = 0;

    while (current.getTime() <= end.getTime()) {
      const weekday = current.getUTCDay();
      const key = this.dateKey(current);
      if (weekday !== 0 && weekday !== 6 && !holidayDates.has(key)) {
        total += 1;
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return total;
  }

  private monthKeysBetween(startDate: string, endDate: string): string[] {
    const start = this.utcDate(`${startDate.slice(0, 7)}-01`);
    const end = this.utcDate(`${endDate.slice(0, 7)}-01`);
    const months: string[] = [];

    while (start.getTime() <= end.getTime()) {
      months.push(
        `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      );
      start.setUTCMonth(start.getUTCMonth() + 1);
    }

    return months;
  }

  private presenceRate(capacity: number, unavailableDays: number): number {
    if (capacity <= 0) return 0;
    const rate = ((capacity - unavailableDays) / capacity) * 100;
    return Math.round(Math.max(0, Math.min(100, rate)) * 10) / 10;
  }

  private utcDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private dateKey(value: Date): string {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }

  private number(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
