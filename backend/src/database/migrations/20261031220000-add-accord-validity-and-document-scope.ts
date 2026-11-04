import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — fondements RÉELLEMENT vérifiables :
 *  - accord d'entreprise : période de validité ENREGISTRÉE sur l'entité
 *    (source de vérité, non modifiable par une simple décision) ;
 *  - document justificatif (CONTRACTUEL/AUTRE) : périmètre salarié
 *    (related_employee_id) pour refuser un document appartenant à autrui.
 * Non destructive (ADD COLUMN NULL).
 */
export class AddAccordValidityAndDocumentScope20261031220000 implements MigrationInterface {
  name = 'AddAccordValidityAndDocumentScope20261031220000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('legal_entities', 'accord_valid_from'))) {
      await queryRunner.query(
        `ALTER TABLE legal_entities ADD COLUMN accord_valid_from DATE NULL AFTER accord_idcc`,
      );
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'accord_valid_to'))) {
      await queryRunner.query(
        `ALTER TABLE legal_entities ADD COLUMN accord_valid_to DATE NULL AFTER accord_valid_from`,
      );
    }
    if (!(await queryRunner.hasColumn('documents', 'related_employee_id'))) {
      await queryRunner.query(
        `ALTER TABLE documents ADD COLUMN related_employee_id BIGINT NULL AFTER uploaded_by_id`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('documents', 'related_employee_id')) {
      await queryRunner.query(
        'ALTER TABLE documents DROP COLUMN related_employee_id',
      );
    }
    if (await queryRunner.hasColumn('legal_entities', 'accord_valid_to')) {
      await queryRunner.query(
        'ALTER TABLE legal_entities DROP COLUMN accord_valid_to',
      );
    }
    if (await queryRunner.hasColumn('legal_entities', 'accord_valid_from')) {
      await queryRunner.query(
        'ALTER TABLE legal_entities DROP COLUMN accord_valid_from',
      );
    }
  }
}
