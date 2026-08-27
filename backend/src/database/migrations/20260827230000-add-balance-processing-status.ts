import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBalanceProcessingStatus20260827230000
  implements MigrationInterface
{
  name = 'AddBalanceProcessingStatus20260827230000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hadColumn = await queryRunner.hasColumn(
      'leave_requests',
      'balance_processing_status',
    );

    if (!hadColumn) {
      await queryRunner.query(`
        ALTER TABLE leave_requests
        ADD COLUMN balance_processing_status
          ENUM('DEMANDE_ACTUELLE','CONGE_PREVISIONNEL','A_CONSOLIDER','DEFINITIF')
          NOT NULL
          DEFAULT 'DEMANDE_ACTUELLE'
          AFTER status
      `);

      // Les demandes VALIDEE existantes ont déjà été débitées par l'ancien
      // moteur. On ne fait cette reprise qu'au moment où la colonne est créée,
      // afin de ne jamais écraser de futurs statuts prévisionnels.
      await queryRunner.query(`
        UPDATE leave_requests
        SET balance_processing_status = 'DEFINITIF'
        WHERE status = 'VALIDEE'
      `);
    }

    const table = await queryRunner.getTable('leave_requests');
    const hasIndex = Boolean(
      table?.indices.some(
        (index) => index.name === 'IDX_leave_requests_balance_processing',
      ),
    );

    if (!hasIndex) {
      await queryRunner.query(`
        CREATE INDEX IDX_leave_requests_balance_processing
        ON leave_requests (status, balance_processing_status, start_date)
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('leave_requests');
    const hasIndex = Boolean(
      table?.indices.some(
        (index) => index.name === 'IDX_leave_requests_balance_processing',
      ),
    );

    if (hasIndex) {
      await queryRunner.query(
        'DROP INDEX IDX_leave_requests_balance_processing ON leave_requests',
      );
    }

    if (
      await queryRunner.hasColumn('leave_requests', 'balance_processing_status')
    ) {
      await queryRunner.query(
        'ALTER TABLE leave_requests DROP COLUMN balance_processing_status',
      );
    }
  }
}
