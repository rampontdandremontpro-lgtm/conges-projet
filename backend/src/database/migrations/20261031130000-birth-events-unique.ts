import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-031 — contrainte d'unicité atomique sur (employee_id, date_naissance) :
 * deux créations concurrentes d'un même événement ne peuvent pas produire deux
 * identifiants donnant chacun un nouveau quota.
 */
export class BirthEventsUnique20261031130000 implements MigrationInterface {
  name = 'BirthEventsUnique20261031130000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('birth_events'))) return;

    const indexes: Array<{ Key_name: string; Non_unique: number }> =
      await queryRunner.query('SHOW INDEX FROM birth_events');

    const hasUnique = indexes.some(
      (index) =>
        index.Key_name === 'UQ_birth_events_employee_date' &&
        index.Non_unique === 0,
    );

    if (!hasUnique) {
      await queryRunner.query(
        'ALTER TABLE birth_events ADD UNIQUE KEY UQ_birth_events_employee_date (employee_id, date_naissance)',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('birth_events'))) return;
    await queryRunner.query(
      'ALTER TABLE birth_events DROP INDEX UQ_birth_events_employee_date',
    );
  }
}
