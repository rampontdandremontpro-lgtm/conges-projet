import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeServiceIdNullable20261012100000 implements MigrationInterface {
  name = 'MakeServiceIdNullable20261012100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE leave_requests MODIFY service_id BIGINT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE absence_declarations MODIFY service_id BIGINT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE leave_requests MODIFY service_id BIGINT NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE absence_declarations MODIFY service_id BIGINT NOT NULL',
    );
  }
}
