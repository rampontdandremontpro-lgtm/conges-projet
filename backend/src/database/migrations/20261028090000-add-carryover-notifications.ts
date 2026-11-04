import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L6 (structure additive) : notification individuelle
 * d'information des salariés (droits reportés pour maladie).
 *
 * Migration VERSIONNÉE et reproductible, distincte du script de recette
 * `tests/recette/scripts/l6-migrate.mjs`. Comme les autres migrations
 * JUR-027 (L1/L3/L4), elle n'est volontairement PAS enregistrée dans le
 * tableau `migrations` d'app.module.ts : elle ne doit pas s'exécuter au
 * démarrage du backend normal (base `gestion_conges_gmes`).
 *
 * La colonne `transmitted_at` est en `datetime(6)` (précision à la
 * milliseconde) afin d'éviter l'arrondi à la seconde supérieure qui rendait
 * `receivedAt < transmittedAt` (faux rejets L6 F8/F9/F10).
 */
export class AddCarryoverNotifications20261028090000
  implements MigrationInterface
{
  name = 'AddCarryoverNotifications20261028090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`carryover_notifications\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`reference\` varchar(80) NOT NULL,
        \`employee_id\` bigint NOT NULL,
        \`status\` varchar(30) NOT NULL DEFAULT 'BROUILLON',
        \`established_at\` date NULL,
        \`reprise_date\` date NULL,
        \`content_json\` json NULL,
        \`transmission_mode\` varchar(40) NULL,
        \`transmitted_at\` datetime(6) NULL,
        \`expected_receipt_date\` date NULL,
        \`active_key\` varchar(60) NULL,
        \`document_reference\` varchar(80) NULL,
        \`document_checksum\` varchar(64) NULL,
        \`transmitted_content_json\` json NULL,
        \`coherence_anomaly\` tinyint(1) NULL DEFAULT 0,
        \`coherence_note\` text NULL,
        \`corrected_from_id\` bigint NULL,
        \`version\` int NOT NULL DEFAULT 0,
        \`created_by_id\` bigint NULL,
        \`cancel_reason\` text NULL,
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_carryover_notifications_reference\` (\`reference\`),
        UNIQUE KEY \`UQ_carryover_notifications_active_key\` (\`active_key\`),
        KEY \`IDX_carryover_notifications_employee\` (\`employee_id\`),
        KEY \`IDX_carryover_notifications_status\` (\`status\`),
        CONSTRAINT \`FK_carryover_notifications_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_carryover_notifications_creator\` FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_carryover_notifications_corrected_from\` FOREIGN KEY (\`corrected_from_id\`) REFERENCES \`carryover_notifications\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Idempotence pour les tables créées par l'ancien script de recette avec
    // `datetime` (sans précision) : alignement sur `datetime(6)`.
    const columns: Array<{ Type: string }> = await queryRunner.query(
      `SHOW COLUMNS FROM \`carryover_notifications\` WHERE Field = 'transmitted_at'`,
    );
    if (columns.length > 0 && !String(columns[0].Type).startsWith('datetime(')) {
      await queryRunner.query(
        `ALTER TABLE \`carryover_notifications\` MODIFY COLUMN \`transmitted_at\` datetime(6) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`carryover_notifications\``);
  }
}
