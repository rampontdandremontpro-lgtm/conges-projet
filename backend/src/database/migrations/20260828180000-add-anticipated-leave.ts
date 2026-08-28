import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnticipatedLeave20260828180000 implements MigrationInterface {
  name = 'AddAnticipatedLeave20260828180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('leave_requests', 'is_anticipated_leave');
    if (!hasColumn) {
      await queryRunner.query(`
        ALTER TABLE leave_requests
        ADD COLUMN is_anticipated_leave TINYINT(1) NOT NULL DEFAULT 0
        AFTER balance_processing_status
      `);
    }

    // Une demande est historiquement « anticipée » uniquement si sa période
    // de congé était exactement N+1 au moment où elle a été créée.
    await queryRunner.query(`
      UPDATE leave_requests
      SET is_anticipated_leave = 1
      WHERE is_anticipated_leave = 0
        AND (
          CASE
            WHEN MONTH(start_date) >= 6 THEN YEAR(start_date)
            ELSE YEAR(start_date) - 1
          END
        ) = (
          CASE
            WHEN MONTH(DATE(created_at)) >= 6 THEN YEAR(DATE(created_at)) + 1
            ELSE YEAR(DATE(created_at))
          END
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('leave_requests', 'is_anticipated_leave')) {
      await queryRunner.query('ALTER TABLE leave_requests DROP COLUMN is_anticipated_leave');
    }
  }
}
