import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { StatisticsQueryDto } from './dto/statistics-query.dto';

interface CountRow {
  label: string;
  total: string | number;
}

interface ServiceStatisticsRow {
  serviceId: string | number;
  serviceName: string;
  leaveRequests: string | number;
  validatedRequests: string | number;
  refusedRequests: string | number;
  absenceDeclarations: string | number;
  deductedDays: string | number | null;
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
    const year = query.year ?? new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const [
      leaveStatusRows,
      absenceStatusRows,
      serviceRows,
      leaveTypeRows,
      monthlyRows,
      totalsRows,
    ] = await Promise.all([
      this.dataSource.query<CountRow[]>(
        `
          SELECT status AS label, COUNT(*) AS total
          FROM leave_requests
          WHERE start_date <= ? AND end_date >= ?
          GROUP BY status
          ORDER BY status
        `,
        [endDate, startDate],
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT status AS label, COUNT(*) AS total
          FROM absence_declarations
          WHERE start_date <= ? AND end_date >= ?
          GROUP BY status
          ORDER BY status
        `,
        [endDate, startDate],
      ),
      this.dataSource.query<ServiceStatisticsRow[]>(
        `
          SELECT
            s.id AS serviceId,
            CASE
              WHEN s.external_company_name IS NULL THEN s.name
              ELSE CONCAT(s.external_company_name, ' — ', s.name)
            END AS serviceName,
            COALESCE(lr.leaveRequests, 0) AS leaveRequests,
            COALESCE(lr.validatedRequests, 0) AS validatedRequests,
            COALESCE(lr.refusedRequests, 0) AS refusedRequests,
            COALESCE(ad.absenceDeclarations, 0) AS absenceDeclarations,
            COALESCE(lr.deductedDays, 0) AS deductedDays
          FROM services s
          LEFT JOIN (
            SELECT
              service_id,
              COUNT(*) AS leaveRequests,
              SUM(status = 'VALIDEE') AS validatedRequests,
              SUM(status = 'REFUSEE') AS refusedRequests,
              SUM(CASE WHEN status = 'VALIDEE' THEN deducted_days ELSE 0 END) AS deductedDays
            FROM leave_requests
            WHERE start_date <= ? AND end_date >= ?
            GROUP BY service_id
          ) lr ON lr.service_id = s.id
          LEFT JOIN (
            SELECT service_id, COUNT(*) AS absenceDeclarations
            FROM absence_declarations
            WHERE start_date <= ? AND end_date >= ?
            GROUP BY service_id
          ) ad ON ad.service_id = s.id
          WHERE s.is_active = 1
          ORDER BY serviceName
        `,
        [endDate, startDate, endDate, startDate],
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT lt.name AS label, COUNT(lr.id) AS total
          FROM leave_types lt
          LEFT JOIN leave_requests lr
            ON lr.leave_type_id = lt.id
            AND lr.start_date <= ?
            AND lr.end_date >= ?
          WHERE lt.category = 'DEMANDE_CONGE'
          GROUP BY lt.id, lt.name
          ORDER BY lt.name
        `,
        [endDate, startDate],
      ),
      this.dataSource.query<
        Array<{
          monthNumber: string | number;
          leaveRequests: string | number;
          validatedRequests: string | number;
          absenceDeclarations: string | number;
        }>
      >(
        `
          SELECT
            months.month_number AS monthNumber,
            COALESCE(lr.leave_requests, 0) AS leaveRequests,
            COALESCE(lr.validated_requests, 0) AS validatedRequests,
            COALESCE(ad.absence_declarations, 0) AS absenceDeclarations
          FROM (
            SELECT 1 AS month_number UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
            SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
            SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
          ) months
          LEFT JOIN (
            SELECT
              MONTH(start_date) AS month_number,
              COUNT(*) AS leave_requests,
              SUM(status = 'VALIDEE') AS validated_requests
            FROM leave_requests
            WHERE YEAR(start_date) = ?
            GROUP BY MONTH(start_date)
          ) lr ON lr.month_number = months.month_number
          LEFT JOIN (
            SELECT
              MONTH(start_date) AS month_number,
              COUNT(*) AS absence_declarations
            FROM absence_declarations
            WHERE YEAR(start_date) = ?
            GROUP BY MONTH(start_date)
          ) ad ON ad.month_number = months.month_number
          ORDER BY months.month_number
        `,
        [year, year],
      ),
      this.dataSource.query<
        Array<{
          leaveRequests: string | number;
          validatedRequests: string | number;
          refusedRequests: string | number;
          pendingRequests: string | number;
          expiredRequests: string | number;
          absenceDeclarations: string | number;
          recordedAbsences: string | number;
          deductedDays: string | number | null;
        }>
      >(
        `
          SELECT
            (SELECT COUNT(*) FROM leave_requests WHERE start_date <= ? AND end_date >= ?) AS leaveRequests,
            (SELECT COUNT(*) FROM leave_requests WHERE status = 'VALIDEE' AND start_date <= ? AND end_date >= ?) AS validatedRequests,
            (SELECT COUNT(*) FROM leave_requests WHERE status = 'REFUSEE' AND start_date <= ? AND end_date >= ?) AS refusedRequests,
            (SELECT COUNT(*) FROM leave_requests WHERE status = 'EN_ATTENTE_VALIDATION' AND start_date <= ? AND end_date >= ?) AS pendingRequests,
            (SELECT COUNT(*) FROM leave_requests WHERE status = 'EXPIREE_NON_VALIDEE' AND start_date <= ? AND end_date >= ?) AS expiredRequests,
            (SELECT COUNT(*) FROM absence_declarations WHERE start_date <= ? AND end_date >= ?) AS absenceDeclarations,
            (SELECT COUNT(*) FROM absence_declarations WHERE status = 'ENREGISTREE' AND start_date <= ? AND end_date >= ?) AS recordedAbsences,
            (SELECT COALESCE(SUM(deducted_days), 0) FROM leave_requests WHERE status = 'VALIDEE' AND start_date <= ? AND end_date >= ?) AS deductedDays
        `,
        [
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
        ],
      ),
    ]);

    const totals = totalsRows[0];
    const result = {
      year,
      period: { startDate, endDate },
      generatedAt: new Date(),
      confidentiality:
        'Données agrégées et non nominatives. Aucun justificatif, commentaire médical, nom ou adresse e-mail n’est exposé.',
      totals: {
        leaveRequests: this.number(totals.leaveRequests),
        validatedRequests: this.number(totals.validatedRequests),
        refusedRequests: this.number(totals.refusedRequests),
        pendingRequests: this.number(totals.pendingRequests),
        expiredRequests: this.number(totals.expiredRequests),
        absenceDeclarations: this.number(totals.absenceDeclarations),
        recordedAbsences: this.number(totals.recordedAbsences),
        deductedDays: this.number(totals.deductedDays),
      },
      leaveRequestsByStatus: leaveStatusRows.map((row) => ({
        status: row.label,
        total: this.number(row.total),
      })),
      absenceDeclarationsByStatus: absenceStatusRows.map((row) => ({
        status: row.label,
        total: this.number(row.total),
      })),
      byService: serviceRows.map((row) => ({
        serviceId: this.number(row.serviceId),
        serviceName: row.serviceName,
        leaveRequests: this.number(row.leaveRequests),
        validatedRequests: this.number(row.validatedRequests),
        refusedRequests: this.number(row.refusedRequests),
        absenceDeclarations: this.number(row.absenceDeclarations),
        deductedDays: this.number(row.deductedDays),
      })),
      byLeaveType: leaveTypeRows.map((row) => ({
        leaveType: row.label,
        total: this.number(row.total),
      })),
      byMonth: monthlyRows.map((row) => ({
        month: this.number(row.monthNumber),
        leaveRequests: this.number(row.leaveRequests),
        validatedRequests: this.number(row.validatedRequests),
        absenceDeclarations: this.number(row.absenceDeclarations),
      })),
    };

    await this.auditService.record({
      actorId: actor.id,
      action: 'DIRECTOR_STATISTICS_VIEWED',
      resourceType: 'REPORT',
      resourceId: null,
      newValue: { year },
    });

    return result;
  }

  private number(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
