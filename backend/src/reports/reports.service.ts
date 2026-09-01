import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { HolidaysService } from '../holidays/holidays.service';
import { UserRole } from '../users/user.entity';
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
  hireDate: string | Date | null;
}

interface LeaveDayRow {
  id: string | number;
  employeeId: string | number;
  serviceId: string | number;
  leaveTypeId: string | number;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  startPeriod: 'MATIN' | 'APRES_MIDI' | null;
  endPeriod: 'MATIN' | 'APRES_MIDI' | null;
  status: string;
}

interface AbsenceDayRow {
  id: string | number;
  employeeId: string | number;
  serviceId: string | number;
  leaveTypeId: string | number;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  startPeriod: 'MATIN' | 'APRES_MIDI' | null;
  endPeriod: 'MATIN' | 'APRES_MIDI' | null;
  durationDays: string | number | null;
  durationHours: string | number | null;
  status: string;
}

interface DayMetrics {
  total: number;
  workingTotal: number;
  byService: Map<number, number>;
  workingByService: Map<number, number>;
  workingByEmployeeDate: Map<string, { serviceId: number; days: number }>;
  byType: Map<string, number>;
  byMonth: Map<string, number>;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly holidaysService: HolidaysService,
  ) {}

  async getDirectorStatistics(
    query: StatisticsQueryDto,
    actor: AuthenticatedUser,
  ) {
    const { startDate, endDate } = this.resolvePeriod(query);
    const dataType = query.dataType ?? StatisticsDataType.ALL;
    const includeLeave = dataType !== StatisticsDataType.ABSENCE;
    const includeAbsence = dataType !== StatisticsDataType.LEAVE;
    const userFilter = this.buildUserFilter(query, actor.role);

    const leaveWhere = `
      lr.start_date <= ?
      AND lr.end_date >= ?
      AND lr.status NOT IN ('BROUILLON','REFUSEE','ANNULEE','ANNULEE_APRES_VALIDATION','EXPIREE_NON_VALIDEE')
      ${query.leaveTypeId ? 'AND lr.leave_type_id = ?' : ''}
      AND lr.leave_type_id NOT IN (
        SELECT id FROM leave_types WHERE name = 'Congé' AND category = 'DEMANDE_CONGE'
      )
      AND ${userFilter.sql}
    `;
    const absenceWhere = `
      ad.start_date <= ?
      AND ad.end_date >= ?
      AND ad.status <> 'BROUILLON'
      ${query.leaveTypeId ? 'AND ad.leave_type_id = ?' : ''}
      AND ${userFilter.sql}
    `;

    const leaveParams = [endDate, startDate, ...(query.leaveTypeId ? [query.leaveTypeId] : []), ...userFilter.params];
    const absenceParams = [endDate, startDate, ...(query.leaveTypeId ? [query.leaveTypeId] : []), ...userFilter.params];

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
      leaveDayRows,
      absenceDayRows,
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
          ${query.serviceScope === 'EXTERNE' ? "AND s.service_type = 'EXTERNE'" : ''}
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
      this.holidaysService.findNonDeductibleBetween(startDate, endDate),
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
        ? this.dataSource.query<LeaveDayRow[]>(
            `
              SELECT
                lr.id,
                lr.employee_id AS employeeId,
                lr.service_id AS serviceId,
                lr.leave_type_id AS leaveTypeId,
                lt.name AS leaveTypeName,
                lr.start_date AS startDate,
                lr.end_date AS endDate,
                lr.start_period AS startPeriod,
                lr.end_period AS endPeriod,
                lr.status
              FROM leave_requests lr
              INNER JOIN users u ON u.id = lr.employee_id
              INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
              WHERE ${leaveWhere}
            `,
            leaveParams,
          )
        : Promise.resolve([] as LeaveDayRow[]),
      includeAbsence
        ? this.dataSource.query<AbsenceDayRow[]>(
            `
              SELECT
                ad.id,
                ad.employee_id AS employeeId,
                ad.service_id AS serviceId,
                ad.leave_type_id AS leaveTypeId,
                lt.name AS leaveTypeName,
                ad.start_date AS startDate,
                ad.end_date AS endDate,
                ad.start_period AS startPeriod,
                ad.end_period AS endPeriod,
                ad.duration_days AS durationDays,
                ad.duration_hours AS durationHours,
                ad.status
              FROM absence_declarations ad
              INNER JOIN users u ON u.id = ad.employee_id
              INNER JOIN leave_types lt ON lt.id = ad.leave_type_id
              WHERE ${absenceWhere}
            `,
            absenceParams,
          )
        : Promise.resolve([] as AbsenceDayRow[]),
    ]);

    const leaveTotals = leaveTotalsRows[0];
    const absenceTotals = absenceTotalsRows[0];
    const holidayDates = new Set(holidays.map((holiday) => holiday.date));
    const leaveMetrics = this.buildLeaveDayMetrics(leaveDayRows, startDate, endDate, holidayDates);
    const absenceMetrics = this.buildAbsenceDayMetrics(absenceDayRows, startDate, endDate, holidayDates);
    const unavailableWorking = this.combineUnavailableWorkingDays(
      includeLeave ? leaveMetrics : this.emptyDayMetrics(),
      includeAbsence ? absenceMetrics : this.emptyDayMetrics(),
    );
    const leaveDays = includeLeave ? leaveMetrics.total : 0;
    const absenceDays = includeAbsence ? absenceMetrics.total : 0;
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
      const serviceLeaveDays = leaveMetrics.byService.get(serviceId) ?? 0;
      const serviceAbsenceDays = absenceMetrics.byService.get(serviceId) ?? 0;
      const serviceUnavailableWorkingDays = unavailableWorking.byService.get(serviceId) ?? 0;
      const capacity = capacityByService.get(serviceId) ?? 0;

      return {
        serviceId,
        serviceName: service.name,
        activeEmployees: employeesByService.get(serviceId) ?? 0,
        presenceRate: this.presenceRate(
          capacity,
          serviceUnavailableWorkingDays,
        ),
        leaveRequests: this.number(leave?.total),
        validatedRequests: this.number(leave?.validated),
        refusedRequests: this.number(leave?.refused),
        pendingRequests: this.number(leave?.pending),
        absenceDeclarations: this.number(absence?.total),
        leaveDays: serviceLeaveDays,
        absenceDays: serviceAbsenceDays,
      };
    }).filter((row) => row.activeEmployees > 0);

    // Les graphiques utilisent des jours réellement compris dans la période
    // sélectionnée. Une demande qui chevauche deux mois est donc ventilée
    // entre ces deux mois au lieu d'être entièrement affectée au mois de départ.
    const byLeaveType = [
      ...[...leaveMetrics.byType.entries()].map(([label, total]) => ({
        label,
        category: 'DEMANDE_CONGE',
        total: this.round(total),
      })),
      ...[...absenceMetrics.byType.entries()].map(([label, total]) => ({
        label,
        category: 'DECLARATION_ABSENCE',
        total: this.round(total),
      })),
    ].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, 'fr'));

    const byMonth = this.monthKeysBetween(startDate, endDate).map((monthKey) => ({
      monthKey,
      leaveDays: this.round(leaveMetrics.byMonth.get(monthKey) ?? 0),
      absenceDays: this.round(absenceMetrics.byMonth.get(monthKey) ?? 0),
    }));

    const processedRequests =
      this.number(leaveTotals?.validatedRequests) +
      this.number(leaveTotals?.refusedRequests);

    const result = {
      period: { startDate, endDate },
      generatedAt: new Date(),
      filters: {
        serviceId: query.serviceId ?? null,
        serviceScope: query.serviceScope ?? null,
        leaveTypeId: query.leaveTypeId ?? null,
        role: query.role ?? null,
        dataType,
      },
      confidentiality:
        'Données agrégées et non nominatives. Aucun justificatif, commentaire médical, nom ou adresse e-mail n’est exposé.',
      totals: {
        activeEmployees: users.length,
        presenceRate: this.presenceRate(
          totalCapacity,
          unavailableWorking.total,
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
        serviceScope: query.serviceScope ?? null,
        leaveTypeId: query.leaveTypeId ?? null,
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

  private buildUserFilter(query: StatisticsQueryDto, actorRole: UserRole): {
    sql: string;
    params: Array<string | number>;
  } {
    const excludedRoles = actorRole === UserRole.DIRECTEUR
      ? "u.role NOT IN ('ADMIN','DIRECTEUR')"
      : "u.role NOT IN ('ADMIN','RH','DIRECTEUR')";
    const conditions = ["u.is_active = 1", excludedRoles];
    const params: Array<string | number> = [];

    if (query.serviceId) {
      conditions.push('u.service_id = ?');
      params.push(query.serviceId);
    } else if (query.serviceScope === 'EXTERNE') {
      conditions.push("u.service_id IN (SELECT id FROM services WHERE service_type = 'EXTERNE')");
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

  private buildLeaveDayMetrics(
    rows: LeaveDayRow[],
    startDate: string,
    endDate: string,
    holidayDates: Set<string>,
  ): DayMetrics {
    const metrics = this.emptyDayMetrics();

    for (const row of rows) {
      if (row.status !== 'VALIDEE') continue;
      const serviceId = this.number(row.serviceId);
      const daily = this.leaveDailyValues(row, holidayDates);
      const workingDaily = this.workingDailyValues(row, holidayDates);

      for (const [date, days] of daily) {
        if (date < startDate || date > endDate || days <= 0) continue;
        metrics.total += days;
        metrics.byService.set(serviceId, (metrics.byService.get(serviceId) ?? 0) + days);
        metrics.byType.set(row.leaveTypeName, (metrics.byType.get(row.leaveTypeName) ?? 0) + days);
        const monthKey = date.slice(0, 7);
        metrics.byMonth.set(monthKey, (metrics.byMonth.get(monthKey) ?? 0) + days);
      }

      for (const [date, days] of workingDaily) {
        if (date < startDate || date > endDate || days <= 0) continue;
        metrics.workingTotal += days;
        metrics.workingByService.set(
          serviceId,
          (metrics.workingByService.get(serviceId) ?? 0) + days,
        );
        this.addWorkingEmployeeDay(
          metrics,
          this.number(row.employeeId),
          serviceId,
          date,
          days,
        );
      }
    }

    return this.roundDayMetrics(metrics);
  }

  private buildAbsenceDayMetrics(
    rows: AbsenceDayRow[],
    startDate: string,
    endDate: string,
    holidayDates: Set<string>,
  ): DayMetrics {
    const metrics = this.emptyDayMetrics();

    for (const row of rows) {
      if (row.status !== 'ENREGISTREE') continue;
      const serviceId = this.number(row.serviceId);

      const declaredDaily = this.absenceDailyValues(row);
      for (const [date, days] of declaredDaily) {
        if (date < startDate || date > endDate || days <= 0) continue;
        metrics.total += days;
        metrics.byService.set(serviceId, (metrics.byService.get(serviceId) ?? 0) + days);
        metrics.byType.set(row.leaveTypeName, (metrics.byType.get(row.leaveTypeName) ?? 0) + days);
        const monthKey = date.slice(0, 7);
        metrics.byMonth.set(monthKey, (metrics.byMonth.get(monthKey) ?? 0) + days);
      }

      const workingDaily = this.absenceWorkingDailyValues(row, holidayDates);
      for (const [date, days] of workingDaily) {
        if (date < startDate || date > endDate || days <= 0) continue;
        metrics.workingTotal += days;
        metrics.workingByService.set(
          serviceId,
          (metrics.workingByService.get(serviceId) ?? 0) + days,
        );
        this.addWorkingEmployeeDay(
          metrics,
          this.number(row.employeeId),
          serviceId,
          date,
          days,
        );
      }
    }

    return this.roundDayMetrics(metrics);
  }

  private leaveDailyValues(
    row: LeaveDayRow,
    holidayDates: Set<string>,
  ): Map<string, number> {
    const values = new Map<string, number>();
    const startDate = this.sqlDate(row.startDate);
    const endDate = this.sqlDate(row.endDate);
    const start = this.utcDate(startDate);
    const end = this.utcDate(endDate);
    const startPeriod = row.startPeriod ?? 'MATIN';
    const endPeriod = row.endPeriod ?? 'APRES_MIDI';
    const current = new Date(start);

    while (current.getTime() <= end.getTime()) {
      const date = this.dateKey(current);
      const isSunday = current.getUTCDay() === 0;
      if (!isSunday && !holidayDates.has(date)) {
        let value = 1;
        if (date === startDate && startPeriod === 'APRES_MIDI') value -= 0.5;
        if (date === endDate && endPeriod === 'MATIN') value -= 0.5;
        if (value > 0) values.set(date, value);
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    if (end.getUTCDay() === 5 && endPeriod === 'APRES_MIDI') {
      const saturday = new Date(end);
      saturday.setUTCDate(saturday.getUTCDate() + 1);
      const saturdayKey = this.dateKey(saturday);
      if (!holidayDates.has(saturdayKey)) values.set(saturdayKey, 1);
    }

    return values;
  }

  private workingDailyValues(
    row: Pick<LeaveDayRow, 'startDate' | 'endDate' | 'startPeriod' | 'endPeriod'>,
    holidayDates: Set<string>,
  ): Map<string, number> {
    const values = new Map<string, number>();
    const startDate = this.sqlDate(row.startDate);
    const endDate = this.sqlDate(row.endDate);
    const start = this.utcDate(startDate);
    const end = this.utcDate(endDate);
    const startPeriod = row.startPeriod ?? 'MATIN';
    const endPeriod = row.endPeriod ?? 'APRES_MIDI';
    const current = new Date(start);

    while (current.getTime() <= end.getTime()) {
      const date = this.dateKey(current);
      const weekday = current.getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !holidayDates.has(date)) {
        let value = 1;
        if (date === startDate && startPeriod === 'APRES_MIDI') value -= 0.5;
        if (date === endDate && endPeriod === 'MATIN') value -= 0.5;
        if (value > 0) values.set(date, value);
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return values;
  }

  private absenceDailyValues(row: AbsenceDayRow): Map<string, number> {
    const values = new Map<string, number>();
    const startDate = this.sqlDate(row.startDate);
    const endDate = this.sqlDate(row.endDate);

    if (row.durationHours !== null && startDate === endDate) {
      const hours = this.number(row.durationHours);
      return hours > 0 ? new Map([[startDate, this.round(hours / 7)]]) : values;
    }

    const start = this.utcDate(startDate);
    const end = this.utcDate(endDate);
    const startPeriod = row.startPeriod ?? 'MATIN';
    const endPeriod = row.endPeriod ?? 'APRES_MIDI';
    const current = new Date(start);

    while (current.getTime() <= end.getTime()) {
      const date = this.dateKey(current);
      let value = 1;
      if (date === startDate && startPeriod === 'APRES_MIDI') value -= 0.5;
      if (date === endDate && endPeriod === 'MATIN') value -= 0.5;
      if (value > 0) values.set(date, value);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    if (row.durationDays !== null) {
      const expected = this.number(row.durationDays);
      const calculated = [...values.values()].reduce((sum, value) => sum + value, 0);
      const difference = this.round(expected - calculated);
      if (Math.abs(difference) > 0.001 && values.size > 0) {
        const lastKey = [...values.keys()][values.size - 1];
        values.set(lastKey, Math.max(0, this.round((values.get(lastKey) ?? 0) + difference)));
      }
    }

    return values;
  }

  private absenceWorkingDailyValues(
    row: AbsenceDayRow,
    holidayDates: Set<string>,
  ): Map<string, number> {
    const startDate = this.sqlDate(row.startDate);
    const endDate = this.sqlDate(row.endDate);

    if (row.durationHours !== null && startDate === endDate) {
      const date = this.utcDate(startDate);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6 || holidayDates.has(startDate)) return new Map();
      const hours = this.number(row.durationHours);
      return hours > 0 ? new Map([[startDate, this.round(hours / 7)]]) : new Map();
    }

    return this.workingDailyValues(
      {
        startDate,
        endDate,
        startPeriod: row.startPeriod,
        endPeriod: row.endPeriod,
      },
      holidayDates,
    );
  }

  private addWorkingEmployeeDay(
    metrics: DayMetrics,
    employeeId: number,
    serviceId: number,
    date: string,
    days: number,
  ): void {
    const key = `${employeeId}:${date}`;
    const previous = metrics.workingByEmployeeDate.get(key)?.days ?? 0;
    metrics.workingByEmployeeDate.set(key, {
      serviceId,
      days: Math.min(1, this.round(previous + days)),
    });
  }

  private combineUnavailableWorkingDays(
    leaveMetrics: DayMetrics,
    absenceMetrics: DayMetrics,
  ): { total: number; byService: Map<number, number> } {
    const combined = new Map<string, { serviceId: number; days: number }>();

    for (const source of [
      leaveMetrics.workingByEmployeeDate,
      absenceMetrics.workingByEmployeeDate,
    ]) {
      for (const [key, entry] of source.entries()) {
        const previous = combined.get(key)?.days ?? 0;
        combined.set(key, {
          serviceId: entry.serviceId,
          days: Math.min(1, this.round(previous + entry.days)),
        });
      }
    }

    const byService = new Map<number, number>();
    let total = 0;
    for (const entry of combined.values()) {
      total += entry.days;
      byService.set(
        entry.serviceId,
        (byService.get(entry.serviceId) ?? 0) + entry.days,
      );
    }

    for (const [serviceId, days] of byService.entries()) {
      byService.set(serviceId, this.round(days));
    }

    return { total: this.round(total), byService };
  }

  private emptyDayMetrics(): DayMetrics {
    return {
      total: 0,
      workingTotal: 0,
      byService: new Map<number, number>(),
      workingByService: new Map<number, number>(),
      workingByEmployeeDate: new Map<string, { serviceId: number; days: number }>(),
      byType: new Map<string, number>(),
      byMonth: new Map<string, number>(),
    };
  }

  private roundDayMetrics(metrics: DayMetrics): DayMetrics {
    metrics.total = this.round(metrics.total);
    metrics.workingTotal = this.round(metrics.workingTotal);

    for (const [key, value] of metrics.byService.entries()) {
      metrics.byService.set(key, this.round(value));
    }
    for (const [key, value] of metrics.workingByService.entries()) {
      metrics.workingByService.set(key, this.round(value));
    }
    for (const [key, value] of metrics.byType.entries()) {
      metrics.byType.set(key, this.round(value));
    }
    for (const [key, value] of metrics.byMonth.entries()) {
      metrics.byMonth.set(key, this.round(value));
    }

    return metrics;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private businessDaysForUser(
    startDate: string,
    endDate: string,
    hireDate: string | Date | null,
    holidayDates: Set<string>,
  ): number {
    const normalizedHireDate = hireDate ? this.sqlDate(hireDate) : null;
    const effectiveStart = normalizedHireDate && normalizedHireDate > startDate ? normalizedHireDate : startDate;
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

  private sqlDate(value: string | Date): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
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
