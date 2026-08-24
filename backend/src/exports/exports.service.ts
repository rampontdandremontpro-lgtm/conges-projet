import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ExportFormat, ExportQueryDto } from './dto/export-query.dto';
import { buildXlsx } from './xlsx-builder';

export interface ExportFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

type ExportRow = Record<string, string | number | boolean | Date | null>;

type CountRow = { total: string | number };

type ServiceOptionRow = { id: string | number; name: string };

type EmployeeOptionRow = {
  id: string | number;
  nom: string;
  prenom: string;
  serviceId: string | number | null;
  serviceName: string | null;
};

@Injectable()
export class ExportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(query: ExportQueryDto) {
    this.validateQuery(query);

    const commonParams = this.commonFilterParams(query);
    const periodParams = this.periodFilterParams(query);

    const [
      services,
      employees,
      leaveCount,
      absenceCount,
      balanceCount,
      movementCount,
      derogationCount,
    ] = await Promise.all([
      this.dataSource.query<ServiceOptionRow[]>(
        `
          SELECT id, name
          FROM services
          WHERE is_active = 1
          ORDER BY name ASC
        `,
      ),
      this.dataSource.query<EmployeeOptionRow[]>(
        `
          SELECT
            u.id,
            u.nom,
            u.prenom,
            u.service_id AS serviceId,
            s.name AS serviceName
          FROM users u
          LEFT JOIN services s ON s.id = u.service_id
          WHERE u.is_active = 1
            AND u.role != 'ADMIN'
          ORDER BY u.nom ASC, u.prenom ASC
        `,
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT COUNT(*) AS total
          FROM leave_requests lr
          INNER JOIN users u ON u.id = lr.employee_id
          WHERE lr.status != 'BROUILLON'
            AND (? IS NULL OR lr.start_date <= ?)
            AND (? IS NULL OR lr.end_date >= ?)
            AND (? IS NULL OR u.service_id = ?)
            AND (? IS NULL OR u.id = ?)
        `,
        [
          query.endDate ?? null,
          query.endDate ?? null,
          query.startDate ?? null,
          query.startDate ?? null,
          ...commonParams,
        ],
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT COUNT(*) AS total
          FROM absence_declarations ad
          INNER JOIN users u ON u.id = ad.employee_id
          WHERE ad.status != 'BROUILLON'
            AND (? IS NULL OR ad.start_date <= ?)
            AND (? IS NULL OR ad.end_date >= ?)
            AND (? IS NULL OR u.service_id = ?)
            AND (? IS NULL OR u.id = ?)
        `,
        [
          query.endDate ?? null,
          query.endDate ?? null,
          query.startDate ?? null,
          query.startDate ?? null,
          ...commonParams,
        ],
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.is_active = 1
            AND u.role != 'ADMIN'
            AND (? IS NULL OR u.service_id = ?)
            AND (? IS NULL OR u.id = ?)
        `,
        commonParams,
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT COUNT(*) AS total
          FROM balance_movements bm
          INNER JOIN users u ON u.id = bm.employee_id
          WHERE (? IS NULL OR DATE(bm.created_at) >= ?)
            AND (? IS NULL OR DATE(bm.created_at) <= ?)
            AND (? IS NULL OR u.service_id = ?)
            AND (? IS NULL OR u.id = ?)
        `,
        [...periodParams, ...commonParams],
      ),
      this.dataSource.query<CountRow[]>(
        `
          SELECT COUNT(*) AS total
          FROM derogations d
          INNER JOIN users u ON u.id = d.employee_id
          WHERE (? IS NULL OR d.requested_start_date <= ?)
            AND (? IS NULL OR d.requested_end_date >= ?)
            AND (? IS NULL OR u.service_id = ?)
            AND (? IS NULL OR u.id = ?)
        `,
        [
          query.endDate ?? null,
          query.endDate ?? null,
          query.startDate ?? null,
          query.startDate ?? null,
          ...commonParams,
        ],
      ),
    ]);

    return {
      filters: {
        services: services.map((service) => ({
          id: Number(service.id),
          name: service.name,
        })),
        employees: employees.map((employee) => ({
          id: Number(employee.id),
          nom: employee.nom,
          prenom: employee.prenom,
          serviceId:
            employee.serviceId === null ? null : Number(employee.serviceId),
          serviceName: employee.serviceName,
        })),
      },
      counts: {
        leaveRequests: this.countValue(leaveCount),
        absenceDeclarations: this.countValue(absenceCount),
        leaveBalances: this.countValue(balanceCount),
        balanceMovements: this.countValue(movementCount),
        derogations: this.countValue(derogationCount),
      },
    };
  }

  async exportLeaveRequests(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    this.validateQuery(query);

    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          lr.id AS Identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS Collaborateur,
          u.email AS Email,
          s.name AS Service,
          COALESCE(s.external_company_name, '') AS Entreprise_externe,
          lt.name AS Type_de_conge,
          lr.start_date AS Date_debut,
          lr.start_period AS Periode_debut,
          lr.end_date AS Date_fin,
          lr.end_period AS Periode_fin,
          lr.calendar_duration AS Duree_calendaire,
          lr.deducted_days AS Jours_decomptes,
          lr.status AS Statut,
          lr.submitted_at AS Date_soumission,
          lr.decision_at AS Date_decision,
          lr.final_decider_role AS Role_decideur,
          lr.refusal_comment AS Commentaire_refus
        FROM leave_requests lr
        INNER JOIN users u ON u.id = lr.employee_id
        INNER JOIN services s ON s.id = lr.service_id
        INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.status != 'BROUILLON'
          AND (? IS NULL OR lr.start_date <= ?)
          AND (? IS NULL OR lr.end_date >= ?)
          AND (? IS NULL OR u.service_id = ?)
          AND (? IS NULL OR u.id = ?)
        ORDER BY lr.start_date DESC, lr.id DESC
      `,
      [
        query.endDate ?? null,
        query.endDate ?? null,
        query.startDate ?? null,
        query.startDate ?? null,
        ...this.commonFilterParams(query),
      ],
    );

    await this.auditExport(actor, 'RH_LEAVE_REQUESTS_EXPORTED', query, rows.length);

    return this.buildFile(
      rows,
      'demandes_conges',
      'Demandes de congés',
      query.format,
    );
  }

  async exportAbsenceDeclarations(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    this.validateQuery(query);

    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          ad.id AS Identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS Collaborateur,
          u.email AS Email,
          s.name AS Service,
          COALESCE(s.external_company_name, '') AS Entreprise_externe,
          lt.name AS Type_absence,
          ad.start_date AS Date_debut,
          ad.start_period AS Periode_debut,
          ad.end_date AS Date_fin,
          ad.end_period AS Periode_fin,
          ad.duration_days AS Duree_jours,
          ad.duration_hours AS Duree_heures,
          ad.status AS Statut,
          ad.declared_at AS Date_declaration,
          ad.verified_at AS Date_verification_RH,
          ad.comment AS Commentaire
        FROM absence_declarations ad
        INNER JOIN users u ON u.id = ad.employee_id
        INNER JOIN services s ON s.id = ad.service_id
        INNER JOIN leave_types lt ON lt.id = ad.leave_type_id
        WHERE ad.status != 'BROUILLON'
          AND (? IS NULL OR ad.start_date <= ?)
          AND (? IS NULL OR ad.end_date >= ?)
          AND (? IS NULL OR u.service_id = ?)
          AND (? IS NULL OR u.id = ?)
        ORDER BY ad.start_date DESC, ad.id DESC
      `,
      [
        query.endDate ?? null,
        query.endDate ?? null,
        query.startDate ?? null,
        query.startDate ?? null,
        ...this.commonFilterParams(query),
      ],
    );

    await this.auditExport(
      actor,
      'RH_ABSENCE_DECLARATIONS_EXPORTED',
      query,
      rows.length,
    );

    return this.buildFile(
      rows,
      'declarations_absence',
      'Déclarations d’absence',
      query.format,
    );
  }

  async exportLeaveBalances(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    this.validateQuery(query);

    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          u.id AS Identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS Collaborateur,
          u.email AS Email,
          COALESCE(s.name, '') AS Service,
          COALESCE(latest.reference_period, '') AS Periode_reference,
          COALESCE(nm1.available_days, 0) AS Conges_a_utiliser,
          COALESCE(n.acquired_days, 0) AS En_acquisition,
          COALESCE(nm1.reserved_days, 0) AS Jours_reserves,
          COALESCE(nm1.available_days, 0) - COALESCE(nm1.reserved_days, 0) AS Disponible_apres_reservations,
          GREATEST(
            COALESCE(nm1.updated_at, '1970-01-01 00:00:00'),
            COALESCE(n.updated_at, '1970-01-01 00:00:00')
          ) AS Derniere_mise_a_jour
        FROM users u
        LEFT JOIN services s ON s.id = u.service_id
        LEFT JOIN (
          SELECT employee_id, MAX(reference_period) AS reference_period
          FROM leave_balances
          GROUP BY employee_id
        ) latest ON latest.employee_id = u.id
        LEFT JOIN leave_balances nm1
          ON nm1.employee_id = u.id
         AND nm1.reference_period = latest.reference_period
         AND nm1.counter_type = 'N-1'
        LEFT JOIN leave_balances n
          ON n.employee_id = u.id
         AND n.reference_period = latest.reference_period
         AND n.counter_type = 'N'
        WHERE u.is_active = 1
          AND u.role != 'ADMIN'
          AND (? IS NULL OR u.service_id = ?)
          AND (? IS NULL OR u.id = ?)
        ORDER BY u.nom ASC, u.prenom ASC
      `,
      this.commonFilterParams(query),
    );

    await this.auditExport(actor, 'RH_LEAVE_BALANCES_EXPORTED', query, rows.length);

    return this.buildFile(
      rows,
      'soldes_collaborateurs',
      'Soldes collaborateurs',
      query.format,
    );
  }

  async exportBalanceMovements(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    this.validateQuery(query);

    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          bm.id AS Identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS Collaborateur,
          u.email AS Email,
          COALESCE(s.name, '') AS Service,
          lb.reference_period AS Periode_reference,
          lb.counter_type AS Compteur,
          bm.movement_type AS Mouvement,
          bm.days AS Jours,
          bm.balance_before AS Solde_avant,
          bm.balance_after AS Solde_apres,
          bm.reason AS Motif,
          bm.leave_request_id AS Demande_conge_liee,
          CASE
            WHEN actor.id IS NULL THEN ''
            ELSE CONCAT(actor.prenom, ' ', actor.nom)
          END AS Effectue_par,
          bm.created_at AS Date_mouvement
        FROM balance_movements bm
        INNER JOIN users u ON u.id = bm.employee_id
        LEFT JOIN services s ON s.id = u.service_id
        INNER JOIN leave_balances lb ON lb.id = bm.leave_balance_id
        LEFT JOIN users actor ON actor.id = bm.actor_id
        WHERE (? IS NULL OR DATE(bm.created_at) >= ?)
          AND (? IS NULL OR DATE(bm.created_at) <= ?)
          AND (? IS NULL OR u.service_id = ?)
          AND (? IS NULL OR u.id = ?)
        ORDER BY bm.created_at DESC, bm.id DESC
      `,
      [
        ...this.periodFilterParams(query),
        ...this.commonFilterParams(query),
      ],
    );

    await this.auditExport(
      actor,
      'RH_BALANCE_MOVEMENTS_EXPORTED',
      query,
      rows.length,
    );

    return this.buildFile(
      rows,
      'mouvements_soldes',
      'Mouvements de soldes',
      query.format,
    );
  }

  async exportDerogations(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    this.validateQuery(query);

    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          d.id AS Identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS Collaborateur,
          u.email AS Email,
          COALESCE(s.name, '') AS Service,
          lt.name AS Type_de_conge,
          d.requested_start_date AS Date_debut,
          d.requested_end_date AS Date_fin,
          d.reason AS Motif,
          CASE
            WHEN d.status = 'EN_ATTENTE_RH' AND d.decided_by_rh_id IS NULL THEN 'En attente'
            WHEN d.status = 'EN_ATTENTE_RH' AND d.decided_by_rh_id IS NOT NULL THEN 'En cours de traitement'
            WHEN d.status = 'ACCORDEE' THEN 'Validée - traitement terminé'
            WHEN d.status = 'REFUSEE' THEN 'Refusée'
            WHEN d.status = 'UTILISEE' THEN 'Appliquée'
            WHEN d.status = 'EXPIREE' THEN 'Délai dépassé'
            ELSE d.status
          END AS Statut,
          d.requested_at AS Demandee_le,
          CASE
            WHEN rh.id IS NULL THEN ''
            ELSE CONCAT(rh.prenom, ' ', rh.nom)
          END AS Decidee_par,
          d.decision_comment AS Commentaire_decision,
          d.decided_at AS Decidee_le,
          d.used_at AS Appliquee_le,
          d.leave_request_id AS Demande_conge
        FROM derogations d
        INNER JOIN users u ON u.id = d.employee_id
        LEFT JOIN services s ON s.id = u.service_id
        INNER JOIN leave_types lt ON lt.id = d.leave_type_id
        LEFT JOIN users rh ON rh.id = d.decided_by_rh_id
        WHERE (? IS NULL OR d.requested_start_date <= ?)
          AND (? IS NULL OR d.requested_end_date >= ?)
          AND (? IS NULL OR u.service_id = ?)
          AND (? IS NULL OR u.id = ?)
        ORDER BY d.requested_at DESC, d.id DESC
      `,
      [
        query.endDate ?? null,
        query.endDate ?? null,
        query.startDate ?? null,
        query.startDate ?? null,
        ...this.commonFilterParams(query),
      ],
    );

    await this.auditExport(actor, 'RH_DEROGATIONS_EXPORTED', query, rows.length);

    return this.buildFile(
      rows,
      'derogations',
      'Dérogations',
      query.format,
    );
  }

  private validateQuery(query: ExportQueryDto): void {
    if (
      query.startDate &&
      query.endDate &&
      query.startDate.localeCompare(query.endDate) > 0
    ) {
      throw new BadRequestException(
        'La date de début doit être antérieure ou égale à la date de fin.',
      );
    }
  }

  private commonFilterParams(query: ExportQueryDto): Array<number | null> {
    return [
      query.serviceId ?? null,
      query.serviceId ?? null,
      query.employeeId ?? null,
      query.employeeId ?? null,
    ];
  }

  private periodFilterParams(query: ExportQueryDto): Array<string | null> {
    return [
      query.startDate ?? null,
      query.startDate ?? null,
      query.endDate ?? null,
      query.endDate ?? null,
    ];
  }

  private countValue(rows: CountRow[]): number {
    return Number(rows[0]?.total ?? 0);
  }

  private async auditExport(
    actor: AuthenticatedUser,
    action: string,
    query: ExportQueryDto,
    rowCount: number,
  ): Promise<void> {
    await this.auditService.record({
      actorId: actor.id,
      action,
      resourceType: 'EXPORT',
      resourceId: null,
      newValue: {
        format: query.format,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        serviceId: query.serviceId ?? null,
        employeeId: query.employeeId ?? null,
        rowCount,
      },
    });
  }

  private async buildFile(
    rows: ExportRow[],
    baseName: string,
    sheetName: string,
    format: ExportFormat,
  ): Promise<ExportFile> {
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === ExportFormat.XLSX) {
      const headers = this.resolveHeaders(rows);
      const normalizedRows = rows.map((row) => {
        const normalized: Record<string, unknown> = {};
        for (const header of headers) {
          normalized[header] = this.normalizeCellValue(row[header]);
        }
        return normalized;
      });
      return {
        buffer: buildXlsx(headers, normalizedRows, sheetName),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `${baseName}_${stamp}.xlsx`,
      };
    }

    const headers = this.resolveHeaders(rows);
    const lines = [
      headers.map((header) => this.escapeCsv(header)).join(';'),
      ...rows.map((row) =>
        headers
          .map((header) => this.escapeCsv(this.normalizeCsvValue(row[header])))
          .join(';'),
      ),
    ];

    return {
      buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${baseName}_${stamp}.csv`,
    };
  }

  private resolveHeaders(rows: ExportRow[]): string[] {
    return rows.length > 0 ? Object.keys(rows[0]) : [];
  }

  private normalizeCellValue(value: ExportRow[string]): unknown {
    if (value instanceof Date) {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return value;
  }

  private normalizeCsvValue(value: ExportRow[string]): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value === null || value === undefined ? '' : String(value);
  }

  private escapeCsv(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return /[;"\r\n]/.test(value) ? `"${escaped}"` : escaped;
  }
}
