import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-031 — table `birth_events` : événement de naissance géré par le backend
 * (identifiant fiable, rattachement des périodes de paternité). Non destructive
 * et idempotente.
 */
export class CreateBirthEvents20261031120000 implements MigrationInterface {
  name = 'CreateBirthEvents20261031120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('birth_events')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE birth_events (
        id VARCHAR(40) NOT NULL,
        employee_id BIGINT NOT NULL,
        date_naissance DATE NOT NULL,
        nb_enfants INT NOT NULL,
        created_by_id BIGINT NULL,
        corrections JSON NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_birth_events_employee_date (employee_id, date_naissance),
        CONSTRAINT FK_birth_events_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_birth_events_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('birth_events')) {
      await queryRunner.query('DROP TABLE birth_events');
    }
  }
}
