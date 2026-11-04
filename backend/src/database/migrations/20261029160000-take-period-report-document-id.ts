import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-023 — la preuve du report doit être un document réellement conservé et
 * identifiable : ajoute `document_id` (clé étrangère vers `documents`).
 *
 * NON DESTRUCTIF : la colonne `document_reference` est CONSERVÉE telle quelle
 * (aucune suppression ni conversion approximative de ses valeurs historiques).
 * La preuve exploitable côté applicatif est désormais `document_id` ; l'ancienne
 * colonne reste en place comme trace historique.
 */
export class TakePeriodReportDocumentId20261029160000
  implements MigrationInterface
{
  name = 'TakePeriodReportDocumentId20261029160000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('take_period_reports'))) {
      return;
    }

    // CONSERVATION : `document_reference` n'est jamais supprimée ici.
    if (!(await queryRunner.hasColumn('take_period_reports', 'document_id'))) {
      await queryRunner.query(
        'ALTER TABLE take_period_reports ADD COLUMN document_id BIGINT NULL AFTER justification',
      );
      const rows: Array<{ CONSTRAINT_NAME: string }> = await queryRunner.query(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'take_period_reports' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'FK_take_period_reports_document'",
      );
      if (rows.length === 0) {
        await queryRunner.query(
          'ALTER TABLE take_period_reports ADD CONSTRAINT FK_take_period_reports_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL',
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (
      await queryRunner.hasColumn('take_period_reports', 'document_id')
    ) {
      const rows: Array<{ CONSTRAINT_NAME: string }> = await queryRunner.query(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'take_period_reports' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'FK_take_period_reports_document'",
      );
      if (rows.length > 0) {
        await queryRunner.query(
          'ALTER TABLE take_period_reports DROP FOREIGN KEY FK_take_period_reports_document',
        );
      }
      await queryRunner.query(
        'ALTER TABLE take_period_reports DROP COLUMN document_id',
      );
    }
  }
}
