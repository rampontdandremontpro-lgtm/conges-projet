import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMustChangePassword20260828140000 implements MigrationInterface {
  name = 'AddMustChangePassword20260828140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('users', 'must_change_password'))) {
      await queryRunner.query(`
        ALTER TABLE users
        ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE
        AFTER is_active
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('users', 'must_change_password')) {
      await queryRunner.query(
        'ALTER TABLE users DROP COLUMN must_change_password',
      );
    }
  }
}
