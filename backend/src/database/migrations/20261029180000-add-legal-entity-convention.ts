import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-024 — convention collective applicable par entité juridique.
 *  - ajoute `convention_type` (AUCUN / SYNTEC / ACCORD_ENTREPRISE, défaut AUCUN) ;
 *  - ajoute `idcc` et `convention_name` (identification de la convention).
 *
 * Aucune convention n'est présumée : la valeur par défaut est AUCUN (légal
 * supplétif). Migration idempotente et non destructive.
 */
export class AddLegalEntityConvention20261029180000
  implements MigrationInterface
{
  name = 'AddLegalEntityConvention20261029180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('legal_entities'))) {
      return;
    }

    if (
      !(await queryRunner.hasColumn('legal_entities', 'convention_type'))
    ) {
      await queryRunner.query(`
        ALTER TABLE legal_entities
        ADD COLUMN convention_type enum('AUCUN','SYNTEC','ACCORD_ENTREPRISE') NOT NULL DEFAULT 'AUCUN'
      `);
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'idcc'))) {
      await queryRunner.query(
        'ALTER TABLE legal_entities ADD COLUMN idcc VARCHAR(20) NULL',
      );
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'convention_name'))) {
      await queryRunner.query(
        'ALTER TABLE legal_entities ADD COLUMN convention_name VARCHAR(180) NULL',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Sans effet : ne jamais supprimer de colonnes potentiellement renseignées.
  }
}
