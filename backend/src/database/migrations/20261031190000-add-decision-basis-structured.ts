import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — fondements de maintien de salaire STRUCTURÉS et vérifiables :
 * période de validité datée, statut de validation (PROPOSED/VALIDATED) et
 * document justificatif rattaché (réutilisation du système documentaire).
 * Non destructive (ADD COLUMN + MODIFY ENUM ajoutant CONTRACTUEL).
 */
export class AddDecisionBasisStructured20261031190000 implements MigrationInterface {
  name = 'AddDecisionBasisStructured20261031190000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_valid_from'))) {
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ADD COLUMN basis_valid_from DATE NULL AFTER basis_reference`,
      );
    }
    if (!(await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_valid_to'))) {
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ADD COLUMN basis_valid_to DATE NULL AFTER basis_valid_from`,
      );
    }
    if (!(await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_validation_status'))) {
      // Les lignes préexistantes reçoivent LEGACY_PENDING (validité indéterminée,
      // droits conservés) ; les nouvelles lignes créées ensuite par l'application
      // repartent sur le défaut PROPOSED.
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ADD COLUMN basis_validation_status ENUM('PROPOSED','VALIDATED','LEGACY_PENDING') NOT NULL DEFAULT 'LEGACY_PENDING' AFTER basis_valid_to`,
      );
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ALTER COLUMN basis_validation_status SET DEFAULT 'PROPOSED'`,
      );
    }
    if (!(await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_document_id'))) {
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ADD COLUMN basis_document_id BIGINT NULL AFTER basis_validation_status`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE illness_maintenance_decisions MODIFY COLUMN basis ENUM('SYNTEC_5_5','ACCORD_ENTREPRISE','CONTRACTUEL','AUTRE') NOT NULL DEFAULT 'SYNTEC_5_5'`,
    );

    // FK non bloquante vers le système documentaire existant.
    const [fkRows] = await queryRunner.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'illness_maintenance_decisions'
          AND COLUMN_NAME = 'basis_document_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
        LIMIT 1`,
    );
    if (!fkRows || fkRows.length === 0) {
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions
           ADD CONSTRAINT FK_illness_maintenance_basis_document
           FOREIGN KEY (basis_document_id) REFERENCES documents(id) ON DELETE SET NULL`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_document_id')) {
      await queryRunner.query(
        'ALTER TABLE illness_maintenance_decisions DROP FOREIGN KEY FK_illness_maintenance_basis_document',
      );
      await queryRunner.query(
        'ALTER TABLE illness_maintenance_decisions DROP COLUMN basis_document_id',
      );
    }
    if (await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_validation_status')) {
      await queryRunner.query(
        'ALTER TABLE illness_maintenance_decisions DROP COLUMN basis_validation_status',
      );
    }
    if (await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_valid_to')) {
      await queryRunner.query(
        'ALTER TABLE illness_maintenance_decisions DROP COLUMN basis_valid_to',
      );
    }
    if (await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_valid_from')) {
      await queryRunner.query(
        'ALTER TABLE illness_maintenance_decisions DROP COLUMN basis_valid_from',
      );
    }
  }
}
