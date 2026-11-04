import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025 / JUR-037 — traçabilité de l'acquisition par nature :
 *  - `balance_movements.accrual_month` : mois d'acquisition stable (AAAA-MM),
 *    pour une idempotence robuste indépendante du libellé du motif.
 *  - `balance_movements.illness_days` : part de crédit acquise au titre de la
 *    maladie non professionnelle (L3141-5-1), isolée par salarié et par période
 *    de référence pour le plafond de 24 jours.
 *  - `legal_entities.illness_wage_maintenance` : décision RH contrôlée et
 *    historisée sur le maintien de salaire conventionnel (Syntec 5.5).
 *
 * Non destructive : ajout de colonnes nulles, aucun effacement de données.
 */
export class AddAccrualIllnessTracking20261031140000 implements MigrationInterface {
  name = 'AddAccrualIllnessTracking20261031140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const movements = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'balance_movements'`,
    );
    const movementColumns = new Set(
      (movements as Array<{ COLUMN_NAME: string }>).map((c) => c.COLUMN_NAME),
    );

    if (!movementColumns.has('accrual_month')) {
      await queryRunner.query(
        `ALTER TABLE balance_movements ADD COLUMN accrual_month VARCHAR(7) NULL`,
      );
    }
    if (!movementColumns.has('illness_days')) {
      await queryRunner.query(
        `ALTER TABLE balance_movements ADD COLUMN illness_days DECIMAL(7,2) NULL`,
      );
    }

    const entities = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'legal_entities'`,
    );
    const entityColumns = new Set(
      (entities as Array<{ COLUMN_NAME: string }>).map((c) => c.COLUMN_NAME),
    );

    if (!entityColumns.has('illness_wage_maintenance')) {
      await queryRunner.query(
        `ALTER TABLE legal_entities ADD COLUMN illness_wage_maintenance
           ENUM('UNKNOWN','MAINTIEN_CONVENTIONNEL','SANS_MAINTIEN') NOT NULL DEFAULT 'UNKNOWN'`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE balance_movements DROP COLUMN IF EXISTS accrual_month`,
    );
    await queryRunner.query(
      `ALTER TABLE balance_movements DROP COLUMN IF EXISTS illness_days`,
    );
    await queryRunner.query(
      `ALTER TABLE legal_entities DROP COLUMN IF EXISTS illness_wage_maintenance`,
    );
  }
}
