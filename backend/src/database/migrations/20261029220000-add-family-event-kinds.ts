import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-029/030 — ajoute les valeurs d'événements familiaux à la classification
 * métier des absences (absence_kind). Migration idempotente et non destructive.
 */
export class AddFamilyEventKinds20261029220000 implements MigrationInterface {
  name = 'AddFamilyEventKinds20261029220000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('leave_types'))) {
      return;
    }
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM leave_types LIKE 'absence_kind'",
    );
    const type = rows?.[0]?.Type ?? '';
    if (!type.includes('MARIAGE_PACS')) {
      await queryRunner.query(`
        ALTER TABLE leave_types
        MODIFY COLUMN absence_kind enum(
          'NON_CLASSIFIE','NON_MEDICAL','ARRET_MALADIE','ENFANT_MALADE','AT_MP',
          'MARIAGE_PACS','NAISSANCE','ADOPTION','DECES','DEUIL_ENFANT','ANNONCE_HANDICAP_ENFANT'
        ) NOT NULL DEFAULT 'NON_CLASSIFIE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
