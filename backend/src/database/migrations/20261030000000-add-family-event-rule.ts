import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-029/030 — règle résolue d'événement familial persistée sur la
 * déclaration d'absence (durée autorisée, unité, source, anomalies, jours
 * demandés, quota). Migration idempotente et non destructive.
 */
export class AddFamilyEventRule20261030000000
  implements MigrationInterface
{
  name = 'AddFamilyEventRule20261030000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('absence_declarations'))) {
      return;
    }
    if (
      !(await queryRunner.hasColumn(
        'absence_declarations',
        'family_event_rule',
      ))
    ) {
      await queryRunner.query(
        'ALTER TABLE absence_declarations ADD COLUMN family_event_rule TEXT NULL',
      );
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
