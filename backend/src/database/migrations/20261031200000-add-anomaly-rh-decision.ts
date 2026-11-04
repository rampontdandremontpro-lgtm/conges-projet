import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — statut d'anomalie RH_DECIDED (cause présente mais analyse RH
 * réalisée) + classification retenue appliquée par le moteur. Non destructive
 * (ADD COLUMN + MODIFY ENUM ajoutant RH_DECIDED).
 */
export class AddAnomalyRhDecision20261031200000 implements MigrationInterface {
  name = 'AddAnomalyRhDecision20261031200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('accrual_anomalies', 'retained_kind'))) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies ADD COLUMN retained_kind VARCHAR(40) NULL AFTER resolution_reason`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE accrual_anomalies MODIFY COLUMN status ENUM('OPEN','RH_DECIDED','RESOLVED') NOT NULL DEFAULT 'OPEN'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('accrual_anomalies', 'retained_kind')) {
      await queryRunner.query('ALTER TABLE accrual_anomalies DROP COLUMN retained_kind');
    }
    await queryRunner.query(
      `ALTER TABLE accrual_anomalies MODIFY COLUMN status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN'`,
    );
  }
}
