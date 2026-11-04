import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L1 (structure additive, sans aucune règle active).
 *
 * Cette migration crée uniquement la table `carryover_lots`. Elle est
 * VOLONTAIREMENT NON enregistrée dans le tableau `migrations` de
 * app.module.ts : elle ne doit PAS s'exécuter au démarrage du backend normal
 * (base `gestion_conges_gmes`). Elle est appliquée manuellement, uniquement
 * sur `gestion_conges_gmes_test`, via `tests/recette/scripts/l1-migrate.mjs`.
 *
 * `remaining_days = NULL` signifie « quantité inconnue », jamais « zéro jour ».
 */
export class AddCarryoverLots20261026180000 implements MigrationInterface {
  name = 'AddCarryoverLots20261026180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`carryover_lots\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`employee_id\` bigint NOT NULL,
        \`source_reference_period\` varchar(20) NOT NULL,
        \`target_reference_period\` varchar(20) NOT NULL,
        \`target_counter_type\` varchar(20) NOT NULL DEFAULT 'N-1',
        \`days\` decimal(7,2) NOT NULL DEFAULT 0,
        \`remaining_days\` decimal(7,2) NULL,
        \`origin\` varchar(20) NOT NULL DEFAULT 'AUTRE',
        \`regime\` varchar(20) NOT NULL DEFAULT 'GENERAL',
        \`status\` varchar(20) NOT NULL DEFAULT 'A_VERIFIER',
        \`absence_start_date\` date NULL,
        \`absence_end_date\` date NULL,
        \`reprise_date\` date NULL,
        \`information_date\` date NULL,
        \`information_mode\` varchar(40) NULL,
        \`proof_id\` bigint NULL,
        \`expires_at\` date NULL,
        \`expiry_basis\` text NULL,
        \`reason\` text NULL,
        \`created_by\` bigint NULL,
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_carryover_lots_employee_status\` (\`employee_id\`, \`status\`),
        KEY \`IDX_carryover_lots_target\` (\`target_reference_period\`, \`target_counter_type\`),
        KEY \`IDX_carryover_lots_expires\` (\`expires_at\`),
        CONSTRAINT \`FK_carryover_lots_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_carryover_lots_creator\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_carryover_lots_proof\` FOREIGN KEY (\`proof_id\`) REFERENCES \`documents\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`carryover_lots\``);
  }
}
