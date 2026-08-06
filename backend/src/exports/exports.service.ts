import { Injectable } from '@nestjs/common';
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

@Injectable()
export class ExportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async exportLeaveRequests(
    query: ExportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportFile> {
    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          lr.id AS identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS collaborateur,
          u.email AS email,
          s.name AS service,
          COALESCE(s.external_company_name, '') AS entreprise_externe,
          lt.name AS type_conge,
          lr.start_date AS date_debut,
          lr.start_period AS periode_debut,
          lr.end_date AS date_fin,
          lr.end_period AS periode_fin,
          lr.calendar_duration AS duree_calendaire,
          lr.deducted_days AS jours_decomptes,
          lr.status AS statut,
          lr.submitted_at AS date_soumission,
          lr.decision_at AS date_decision,
          lr.final_decider_role AS role_decideur,
          lr.refusal_comment AS commentaire_refus,
          lr.created_at AS date_creation,
          lr.updated_at AS date_mise_a_jour
        FROM leave_requests lr
        INNER JOIN users u ON u.id = lr.employee_id
        INNER JOIN services s ON s.id = lr.service_id
        INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE (? IS NULL OR lr.start_date >= ?)
          AND (? IS NULL OR lr.end_date <= ?)
        ORDER BY lr.start_date DESC, lr.id DESC
      `,
      [
        query.startDate ?? null,
        query.startDate ?? null,
        query.endDate ?? null,
        query.endDate ?? null,
      ],
    );

    await this.auditService.record({
      actorId: actor.id,
      action: 'RH_LEAVE_REQUESTS_EXPORTED',
      resourceType: 'EXPORT',
      resourceId: null,
      newValue: {
        format: query.format,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        rowCount: rows.length,
      },
    });

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
    const rows = await this.dataSource.query<ExportRow[]>(
      `
        SELECT
          ad.id AS identifiant,
          CONCAT(u.prenom, ' ', u.nom) AS collaborateur,
          u.email AS email,
          s.name AS service,
          COALESCE(s.external_company_name, '') AS entreprise_externe,
          lt.name AS type_absence,
          ad.start_date AS date_debut,
          ad.start_period AS periode_debut,
          ad.end_date AS date_fin,
          ad.end_period AS periode_fin,
          ad.duration_days AS duree_jours,
          ad.duration_hours AS duree_heures,
          ad.status AS statut,
          ad.declared_at AS date_declaration,
          ad.verified_at AS date_verification_rh,
          ad.comment AS commentaire,
          ad.created_at AS date_creation,
          ad.updated_at AS date_mise_a_jour
        FROM absence_declarations ad
        INNER JOIN users u ON u.id = ad.employee_id
        INNER JOIN services s ON s.id = ad.service_id
        INNER JOIN leave_types lt ON lt.id = ad.leave_type_id
        WHERE (? IS NULL OR ad.start_date >= ?)
          AND (? IS NULL OR ad.end_date <= ?)
        ORDER BY ad.start_date DESC, ad.id DESC
      `,
      [
        query.startDate ?? null,
        query.startDate ?? null,
        query.endDate ?? null,
        query.endDate ?? null,
      ],
    );

    await this.auditService.record({
      actorId: actor.id,
      action: 'RH_ABSENCE_DECLARATIONS_EXPORTED',
      resourceType: 'EXPORT',
      resourceId: null,
      newValue: {
        format: query.format,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        rowCount: rows.length,
      },
    });

    return this.buildFile(
      rows,
      'declarations_absence',
      'Déclarations d’absence',
      query.format,
    );
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
