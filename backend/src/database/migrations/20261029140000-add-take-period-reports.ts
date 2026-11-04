import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-023 — suivi des reports de la période de prise.
 *
 * Table `take_period_reports` : trace une demande écrite de report formulée par
 * l'employeur (auteur, date, justification, période, nouvelle échéance), en
 * distinguant reports ordinaires et reports après maladie (JUR-027). Contrainte
 * d'unicité (employé + période + type) pour empêcher les doubles reports.
 *
 * Migration idempotente et non destructive.
 */
export class AddTakePeriodReports20261029140000
  implements MigrationInterface
{
  name = 'AddTakePeriodReports20261029140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('take_period_reports'))) {
      await queryRunner.query(`
        CREATE TABLE take_period_reports (
          id BIGINT NOT NULL AUTO_INCREMENT,
          employee_id BIGINT NOT NULL,
          reference_period VARCHAR(20) NOT NULL,
          report_type VARCHAR(20) NOT NULL,
          requested_by_id BIGINT NOT NULL,
          justification TEXT NOT NULL,
          new_deadline DATE NOT NULL,
          created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (id),
          UNIQUE KEY UQ_take_period_reports_emp_period_type (employee_id, reference_period, report_type),
          CONSTRAINT FK_take_period_reports_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
          CONSTRAINT FK_take_period_reports_requested_by FOREIGN KEY (requested_by_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS take_period_reports');
  }
}
