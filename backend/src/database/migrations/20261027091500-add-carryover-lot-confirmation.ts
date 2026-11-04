import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L3b : migration STRICTEMENT ADDITIVE sur `carryover_lots`.
 *
 * NON enregistrée dans app.module.ts (jamais exécutée par migrationsRun au
 * démarrage du backend normal). Appliquée manuellement, uniquement sur
 * `gestion_conges_gmes_test`, via `tests/recette/scripts/l3-migrate.mjs`.
 *
 * - `confirmation_status` : état de la confirmation RH (EN_ATTENTE/CONFIRMEE/REFUSEE).
 * - `reference_period_end_date` : date exacte de fin de période de référence
 *   FIGÉE au calcul (évite tout recalcul silencieux si REFERENCE_PERIOD_START change).
 */
export class AddCarryoverLotConfirmation20261027091500 implements MigrationInterface {
  name = 'AddCarryoverLotConfirmation20261027091500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        ADD COLUMN \`confirmation_status\` varchar(20) NULL,
        ADD COLUMN \`reference_period_end_date\` date NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        DROP COLUMN \`confirmation_status\`,
        DROP COLUMN \`reference_period_end_date\``,
    );
  }
}
