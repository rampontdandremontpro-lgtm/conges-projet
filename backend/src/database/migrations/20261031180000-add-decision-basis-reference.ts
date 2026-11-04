import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — référence précise du fondement des décisions de maintien de
 * salaire (nature + période d'application) pour ACCORD_ENTREPRISE et AUTRE.
 * Non destructive (ADD COLUMN).
 */
export class AddDecisionBasisReference20261031180000 implements MigrationInterface {
  name = 'AddDecisionBasisReference20261031180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const has = await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_reference');
    if (!has) {
      await queryRunner.query(
        `ALTER TABLE illness_maintenance_decisions ADD COLUMN basis_reference VARCHAR(500) NULL AFTER basis`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('illness_maintenance_decisions', 'basis_reference')) {
      await queryRunner.query('ALTER TABLE illness_maintenance_decisions DROP COLUMN basis_reference');
    }
  }
}
