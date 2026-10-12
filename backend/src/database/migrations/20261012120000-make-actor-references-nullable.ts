import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeActorReferencesNullable20261012120000 implements MigrationInterface {
  name = 'MakeActorReferencesNullable20261012120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE leave_requests MODIFY created_by_id BIGINT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE absence_declarations MODIFY created_by_id BIGINT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE documents MODIFY uploaded_by_id BIGINT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE validator_replacements MODIFY created_by_rh_id BIGINT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE leave_requests MODIFY created_by_id BIGINT NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE absence_declarations MODIFY created_by_id BIGINT NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE documents MODIFY uploaded_by_id BIGINT NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE validator_replacements MODIFY created_by_rh_id BIGINT NOT NULL',
    );
  }
}
