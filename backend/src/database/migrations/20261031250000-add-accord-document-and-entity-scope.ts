import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — séparation téléversement / vérification juridique :
 *  - documents.related_legal_entity_id : périmètre ENTITÉ d'un justificatif
 *    d'accord d'entreprise ;
 *  - legal_entities.accord_document_id : justificatif VÉRIFIÉ adossé aux dates
 *    de validité de l'accord (les dates seules ne font pas preuve).
 * Non destructive (ADD COLUMN NULL).
 */
export class AddAccordDocumentAndEntityScope20261031250000 implements MigrationInterface {
  name = 'AddAccordDocumentAndEntityScope20261031250000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('documents', 'related_legal_entity_id'))) {
      await queryRunner.query(
        `ALTER TABLE documents ADD COLUMN related_legal_entity_id BIGINT NULL AFTER related_employee_id`,
      );
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'accord_document_id'))) {
      await queryRunner.query(
        `ALTER TABLE legal_entities ADD COLUMN accord_document_id BIGINT NULL AFTER accord_valid_to`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('legal_entities', 'accord_document_id')) {
      await queryRunner.query(
        'ALTER TABLE legal_entities DROP COLUMN accord_document_id',
      );
    }
    if (await queryRunner.hasColumn('documents', 'related_legal_entity_id')) {
      await queryRunner.query(
        'ALTER TABLE documents DROP COLUMN related_legal_entity_id',
      );
    }
  }
}
