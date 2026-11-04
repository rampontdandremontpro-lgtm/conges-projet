import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-024 — distingue « convention non renseignée » (NON_RENSEIGNEE, défaut)
 * de « régime légal confirmé par la RH » (LEGAL). Renomme AUCUN en
 * NON_RENSEIGNEE et ajoute LEGAL. Migration idempotente et non destructive.
 */
export class LegalEntityConventionLegal20261029200000
  implements MigrationInterface
{
  name = 'LegalEntityConventionLegal20261029200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('legal_entities'))) {
      return;
    }
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM legal_entities LIKE 'convention_type'",
    );
    const type = rows?.[0]?.Type ?? '';
    if (!type.includes('LEGAL') || type.includes('AUCUN')) {
      // 1) étendre l'enum (AUCUN conservé temporairement pour les données).
      await queryRunner.query(`
        ALTER TABLE legal_entities
        MODIFY COLUMN convention_type enum('AUCUN','NON_RENSEIGNEE','LEGAL','SYNTEC','ACCORD_ENTREPRISE') NOT NULL DEFAULT 'NON_RENSEIGNEE'
      `);
      // 2) migrer les valeurs existantes.
      await queryRunner.query(
        "UPDATE legal_entities SET convention_type = 'NON_RENSEIGNEE' WHERE convention_type = 'AUCUN'",
      );
      // 3) retirer l'ancienne valeur.
      await queryRunner.query(`
        ALTER TABLE legal_entities
        MODIFY COLUMN convention_type enum('NON_RENSEIGNEE','LEGAL','SYNTEC','ACCORD_ENTREPRISE') NOT NULL DEFAULT 'NON_RENSEIGNEE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
