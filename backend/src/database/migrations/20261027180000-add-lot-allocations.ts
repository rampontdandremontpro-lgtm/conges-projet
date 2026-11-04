import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L4 : migration STRICTEMENT ADDITIVE (recette uniquement).
 *
 * NON enregistrée dans app.module.ts. Appliquée manuellement via
 * `tests/recette/scripts/l4-migrate.mjs` sur `gestion_conges_gmes_test`.
 *
 * - `carryover_lots.reconciled` : rapprochement de l'origine des droits.
 * - `lot_allocations` : traçabilité des réservations/consommations/annulations.
 */
export class AddLotAllocations20261027180000 implements MigrationInterface {
  name = 'AddLotAllocations20261027180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\` ADD COLUMN \`reconciled\` tinyint(1) NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`lot_allocations\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`lot_id\` bigint NOT NULL,
        \`leave_request_id\` bigint NULL,
        \`movement_id\` bigint NULL,
        \`leave_balance_id\` bigint NULL,
        \`operation_type\` varchar(30) NOT NULL,
        \`frozen_in_balance\` tinyint(1) NULL,
        \`days\` decimal(7,2) NOT NULL DEFAULT 0,
        \`covered_dates\` json NULL,
        \`actor_id\` bigint NULL,
        \`reason\` text NULL,
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_lot_allocations_lot\` (\`lot_id\`),
        KEY \`IDX_lot_allocations_request\` (\`leave_request_id\`),
        KEY \`IDX_lot_allocations_movement\` (\`movement_id\`),
        UNIQUE KEY \`UQ_lot_allocations_request_lot_op\` (\`leave_request_id\`, \`lot_id\`, \`operation_type\`),
        CONSTRAINT \`FK_lot_allocations_lot\` FOREIGN KEY (\`lot_id\`) REFERENCES \`carryover_lots\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_lot_allocations_request\` FOREIGN KEY (\`leave_request_id\`) REFERENCES \`leave_requests\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_movement\` FOREIGN KEY (\`movement_id\`) REFERENCES \`balance_movements\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_balance\` FOREIGN KEY (\`leave_balance_id\`) REFERENCES \`leave_balances\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_actor\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`lot_allocations\``);
    await queryRunner.query(
      `ALTER TABLE \`carryover_lots\` DROP COLUMN \`reconciled\``,
    );
  }
}
