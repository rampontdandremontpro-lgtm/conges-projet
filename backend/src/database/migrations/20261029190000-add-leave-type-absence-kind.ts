import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-028 — classification métier explicite des types d'absence.
 * Ajoute `absence_kind` (NON_CLASSIFIE par défaut). Aucune correspondance de
 * mots n'est utilisée : la RH classe explicitement les types.
 */
export class AddLeaveTypeAbsenceKind20261029190000
  implements MigrationInterface
{
  name = 'AddLeaveTypeAbsenceKind20261029190000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('leave_types'))) {
      return;
    }
    if (!(await queryRunner.hasColumn('leave_types', 'absence_kind'))) {
      await queryRunner.query(`
        ALTER TABLE leave_types
        ADD COLUMN absence_kind enum('NON_CLASSIFIE','NON_MEDICAL','ARRET_MALADIE','ENFANT_MALADE','AT_MP') NOT NULL DEFAULT 'NON_CLASSIFIE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
