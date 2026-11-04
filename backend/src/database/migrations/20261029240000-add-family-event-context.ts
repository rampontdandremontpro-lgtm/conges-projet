import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-029/030 — contexte d'événement familial sur la déclaration d'absence.
 */
export class AddFamilyEventContext20261029240000
  implements MigrationInterface
{
  name = 'AddFamilyEventContext20261029240000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('absence_declarations'))) {
      return;
    }
    if (
      !(await queryRunner.hasColumn(
        'absence_declarations',
        'family_event_context',
      ))
    ) {
      await queryRunner.query(
        'ALTER TABLE absence_declarations ADD COLUMN family_event_context TEXT NULL',
      );
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
