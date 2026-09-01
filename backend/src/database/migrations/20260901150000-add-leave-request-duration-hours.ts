import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeaveRequestDurationHours20260901150000 implements MigrationInterface {
  name = 'AddLeaveRequestDurationHours20260901150000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('leave_requests', 'duration_hours'))) {
      await queryRunner.query(`
        ALTER TABLE leave_requests
        ADD COLUMN duration_hours DECIMAL(7,2) NULL
        AFTER deducted_days
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('leave_requests', 'duration_hours')) {
      await queryRunner.query(
        'ALTER TABLE leave_requests DROP COLUMN duration_hours',
      );
    }
  }
}
