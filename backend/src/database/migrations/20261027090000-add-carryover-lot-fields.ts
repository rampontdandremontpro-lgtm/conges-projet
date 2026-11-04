import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L3 : migration STRICTEMENT ADDITIVE sur `carryover_lots`.
 *
 * VOLONTAIREMENT NON enregistrée dans app.module.ts : elle ne doit PAS
 * s'exécuter au démarrage du backend normal. Elle est appliquée manuellement,
 * uniquement sur `gestion_conges_gmes_test`, via
 * `tests/recette/scripts/l3-migrate.mjs`.
 *
 * Ajoute les colonnes de traçabilité/conditions/unicité nécessaires à L3,
 * sans modifier les tables de compteurs ni aucune table existante.
 */
export class AddCarryoverLotFields20261027090000 implements MigrationInterface {
  name = 'AddCarryoverLotFields20261027090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        ADD COLUMN \`absence_status\` varchar(20) NULL,
        ADD COLUMN \`information_date_certain\` tinyint(1) NULL,
        ADD COLUMN \`acquired_during_l3141_5_5or7\` tinyint(1) NULL,
        ADD COLUMN \`suspension_at_least_one_year_at_period_end\` tinyint(1) NULL,
        ADD COLUMN \`indicative_expires_at\` date NULL,
        ADD COLUMN \`idempotency_key\` varchar(190) NULL,
        ADD COLUMN \`source_movement_id\` bigint NULL,
        ADD COLUMN \`version\` int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        ADD UNIQUE KEY \`IDX_carryover_lots_idempotency\` (\`idempotency_key\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        ADD CONSTRAINT \`FK_carryover_lots_source_movement\`
          FOREIGN KEY (\`source_movement_id\`)
          REFERENCES \`balance_movements\` (\`id\`)
          ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        DROP FOREIGN KEY \`FK_carryover_lots_source_movement\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\` DROP INDEX \`IDX_carryover_lots_idempotency\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\`
        DROP COLUMN \`absence_status\`,
        DROP COLUMN \`information_date_certain\`,
        DROP COLUMN \`acquired_during_l3141_5_5or7\`,
        DROP COLUMN \`suspension_at_least_one_year_at_period_end\`,
        DROP COLUMN \`indicative_expires_at\`,
        DROP COLUMN \`idempotency_key\`,
        DROP COLUMN \`source_movement_id\`,
        DROP COLUMN \`version\``,
    );
  }
}
