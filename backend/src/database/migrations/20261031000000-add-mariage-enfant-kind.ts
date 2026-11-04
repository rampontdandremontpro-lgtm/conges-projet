import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-029/030 — ajoute `MARIAGE_ENFANT` à la classification métier des
 * absences (article 5.7 Syntec : mariage d'un enfant = 1 jour ouvré).
 * Migration idempotente et non destructive.
 */
export class AddMariageEnfantKind20261031000000
  implements MigrationInterface
{
  name = 'AddMariageEnfantKind20261031000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('leave_types'))) {
      return;
    }
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM leave_types LIKE 'absence_kind'",
    );
    const type = rows?.[0]?.Type ?? '';
    if (!type.includes('MARIAGE_ENFANT')) {
      await queryRunner.query(`
        ALTER TABLE leave_types
        MODIFY COLUMN absence_kind enum(
          'NON_CLASSIFIE','NON_MEDICAL','ARRET_MALADIE','ENFANT_MALADE','AT_MP',
          'MARIAGE_PACS','MARIAGE_ENFANT','NAISSANCE','ADOPTION','DECES','DECES_ENFANT','DEUIL_ENFANT','ANNONCE_HANDICAP_ENFANT'
        ) NOT NULL DEFAULT 'NON_CLASSIFIE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
