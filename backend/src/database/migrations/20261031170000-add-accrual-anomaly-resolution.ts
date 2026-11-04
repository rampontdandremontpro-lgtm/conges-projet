import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — traçabilité de la résolution des anomalies d'acquisition :
 * mode (VERIFIED = cause disparue, RH_DECISION = clôture RH justifiée) et
 * justification historisée. Non destructive (ADD COLUMN).
 */
export class AddAccrualAnomalyResolution20261031170000 implements MigrationInterface {
  name = 'AddAccrualAnomalyResolution20261031170000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hasMode = await queryRunner.hasColumn('accrual_anomalies', 'resolution_mode');
    if (!hasMode) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies ADD COLUMN resolution_mode ENUM('VERIFIED','RH_DECISION') NULL AFTER resolved_by_id`,
      );
    }

    const hasReason = await queryRunner.hasColumn('accrual_anomalies', 'resolution_reason');
    if (!hasReason) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies ADD COLUMN resolution_reason TEXT NULL AFTER resolution_mode`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('accrual_anomalies', 'resolution_reason')) {
      await queryRunner.query('ALTER TABLE accrual_anomalies DROP COLUMN resolution_reason');
    }
    if (await queryRunner.hasColumn('accrual_anomalies', 'resolution_mode')) {
      await queryRunner.query('ALTER TABLE accrual_anomalies DROP COLUMN resolution_mode');
    }
  }
}
