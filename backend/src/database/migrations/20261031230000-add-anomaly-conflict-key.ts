import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — scope une décision RH de chevauchement à UN conflit précis :
 * ajoute conflict_key (identifiants triés des déclarations chevauchantes) et
 * remplace l'unicité (salarié, type, période, mois) par
 * (salarié, type, période, mois, conflict_key). Deux conflits distincts du
 * même mois restent ainsi deux anomalies indépendantes.
 * Non destructive (ADD COLUMN + remplacement d'index).
 */
export class AddAnomalyConflictKey20261031230000 implements MigrationInterface {
  name = 'AddAnomalyConflictKey20261031230000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('accrual_anomalies', 'conflict_key'))) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies ADD COLUMN conflict_key VARCHAR(200) NULL AFTER accrual_month`,
      );
    }

    const oldIndexRows: unknown[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'accrual_anomalies'
          AND INDEX_NAME = 'UQ_accrual_anomaly'
        LIMIT 1`,
    );
    if (oldIndexRows.length > 0) {
      await queryRunner.query(
        'ALTER TABLE accrual_anomalies DROP INDEX UQ_accrual_anomaly',
      );
    }

    await queryRunner.query(
      `ALTER TABLE accrual_anomalies ADD UNIQUE INDEX UQ_accrual_anomaly_scoped (employee_id, type, reference_period, accrual_month, conflict_key)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE accrual_anomalies DROP INDEX UQ_accrual_anomaly_scoped',
    );
    await queryRunner.query(
      `ALTER TABLE accrual_anomalies ADD UNIQUE INDEX UQ_accrual_anomaly (employee_id, type, reference_period, accrual_month)`,
    );
    if (await queryRunner.hasColumn('accrual_anomalies', 'conflict_key')) {
      await queryRunner.query(
        'ALTER TABLE accrual_anomalies DROP COLUMN conflict_key',
      );
    }
  }
}
