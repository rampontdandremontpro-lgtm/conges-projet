import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — table `accrual_anomalies` : anomalies d'acquisition persistantes
 * (chevauchements contradictoires, journées historiques à valider, anciens
 * mouvements ambigus). Non destructive. Unique par (salarié, type, période, mois).
 */
export class CreateAccrualAnomalies20261031160000 implements MigrationInterface {
  name = 'CreateAccrualAnomalies20261031160000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('accrual_anomalies')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE accrual_anomalies (
        id BIGINT NOT NULL AUTO_INCREMENT,
        employee_id BIGINT NOT NULL,
        type ENUM('ABSENCE_OVERLAP_CONFLICT','HISTORICAL_PENDING','AMBIGUOUS_LEGACY') NOT NULL,
        reference_period VARCHAR(20) NOT NULL,
        accrual_month VARCHAR(7) NULL,
        days INT NOT NULL DEFAULT 0,
        detail TEXT NULL,
        status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
        resolved_at DATETIME(6) NULL,
        resolved_by_id BIGINT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_accrual_anomaly (employee_id, type, reference_period, accrual_month),
        INDEX IDX_accrual_anomalies_status (status, employee_id),
        CONSTRAINT FK_accrual_anomalies_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_accrual_anomalies_resolved_by FOREIGN KEY (resolved_by_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('accrual_anomalies')) {
      await queryRunner.query('DROP TABLE accrual_anomalies');
    }
  }
}
