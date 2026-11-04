import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-031 — ajoute `PATERNITE_ACCUEIL` à la classification métier des absences
 * (congé de paternité et d'accueil de l'enfant). Migration idempotente et non
 * destructive.
 */
export class AddPaterniteKind20261031010000 implements MigrationInterface {
  name = 'AddPaterniteKind20261031010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('leave_types'))) {
      return;
    }
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM leave_types LIKE 'absence_kind'",
    );
    const type = rows?.[0]?.Type ?? '';
    if (!type.includes('PATERNITE_ACCUEIL')) {
      await queryRunner.query(`
        ALTER TABLE leave_types
        MODIFY COLUMN absence_kind enum(
          'NON_CLASSIFIE','NON_MEDICAL','ARRET_MALADIE','ENFANT_MALADE','AT_MP',
          'MARIAGE_PACS','MARIAGE_ENFANT','PATERNITE_ACCUEIL','NAISSANCE','ADOPTION','DECES','DECES_ENFANT','DEUIL_ENFANT','ANNONCE_HANDICAP_ENFANT'
        ) NOT NULL DEFAULT 'NON_CLASSIFIE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
