import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-027 — Lot L6 (structure additive) : preuve de réception d'une
 * notification individuelle.
 *
 * Migration VERSIONNÉE et reproductible, distincte du script de recette
 * `tests/recette/scripts/l6-migrate.mjs`. Comme les autres migrations
 * JUR-027, elle n'est volontairement PAS enregistrée dans app.module.ts.
 *
 * `received_at` est en `datetime(6)` (précision à la milliseconde) pour
 * préserver l'horodatage exact de réception (cf. L6 F8/F9/F10).
 */
export class AddCarryoverReceptionProofs20261028091500
  implements MigrationInterface
{
  name = 'AddCarryoverReceptionProofs20261028091500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`carryover_reception_proofs\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`notification_id\` bigint NOT NULL,
        \`employee_id\` bigint NOT NULL,
        \`mode\` varchar(40) NOT NULL,
        \`received_at\` datetime(6) NULL,
        \`proof_reference\` varchar(255) NULL,
        \`checksum\` varchar(64) NULL,
        \`storage_key\` varchar(500) NULL,
        \`mime_type\` varchar(100) NULL,
        \`file_size\` bigint NULL,
        \`status\` varchar(30) NOT NULL DEFAULT 'EN_ATTENTE',
        \`verified_by_id\` bigint NULL,
        \`verified_at\` datetime(6) NULL,
        \`rejection_reason\` text NULL,
        \`verification_result\` varchar(30) NULL,
        \`verification_note\` text NULL,
        \`simulation\` tinyint(1) NULL DEFAULT 0,
        \`history_json\` json NULL,
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_carryover_reception_proofs_storage\` (\`storage_key\`),
        KEY \`IDX_carryover_reception_proofs_notification\` (\`notification_id\`),
        KEY \`IDX_carryover_reception_proofs_employee\` (\`employee_id\`),
        CONSTRAINT \`FK_carryover_reception_proofs_notification\` FOREIGN KEY (\`notification_id\`) REFERENCES \`carryover_notifications\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_carryover_reception_proofs_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_carryover_reception_proofs_verifier\` FOREIGN KEY (\`verified_by_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Idempotence pour les tables créées par l'ancien script de recette avec
    // `datetime` (sans précision) : alignement sur `datetime(6)`.
    const columns: Array<{ Type: string }> = await queryRunner.query(
      `SHOW COLUMNS FROM \`carryover_reception_proofs\` WHERE Field = 'received_at'`,
    );
    if (columns.length > 0 && !String(columns[0].Type).startsWith('datetime(')) {
      await queryRunner.query(
        `ALTER TABLE \`carryover_reception_proofs\` MODIFY COLUMN \`received_at\` datetime(6) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`carryover_reception_proofs\``);
  }
}
