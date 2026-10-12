import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserExitDate20260930180000 implements MigrationInterface {
  name = 'AddUserExitDate20260930180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) {
      // La table users n'existe pas encore : rien à migrer. Les environnements
      // fraîchement générés la créeront avec la colonne via les entités.
      return;
    }

    if (!(await queryRunner.hasColumn('users', 'exit_date'))) {
      await queryRunner.query(`
        ALTER TABLE users
        ADD COLUMN exit_date DATE NULL
        AFTER hire_date
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('users', 'exit_date')) {
      await queryRunner.query(
        'ALTER TABLE users DROP COLUMN exit_date',
      );
    }
  }
}
