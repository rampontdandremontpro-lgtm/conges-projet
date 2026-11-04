import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-024 — distingue la convention de BRANCHE de l'accord d'entreprise
 * (les deux peuvent coexister). L'accord n'est plus une valeur de
 * `convention_type` : il devient un champ séparé (`accord_type`), sans perte
 * des données historiques.
 */
export class LegalEntityAccord20261029210000 implements MigrationInterface {
  name = 'LegalEntityAccord20261029210000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('legal_entities'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('legal_entities', 'accord_type'))) {
      await queryRunner.query(`
        ALTER TABLE legal_entities
        ADD COLUMN accord_type enum('NONE','ACCORD_ENTREPRISE') NOT NULL DEFAULT 'NONE'
      `);
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'accord_name'))) {
      await queryRunner.query(
        'ALTER TABLE legal_entities ADD COLUMN accord_name VARCHAR(180) NULL',
      );
    }
    if (!(await queryRunner.hasColumn('legal_entities', 'accord_idcc'))) {
      await queryRunner.query(
        'ALTER TABLE legal_entities ADD COLUMN accord_idcc VARCHAR(20) NULL',
      );
    }

    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM legal_entities LIKE 'convention_type'",
    );
    const type = rows?.[0]?.Type ?? '';
    if (type.includes('ACCORD_ENTREPRISE')) {
      // Préserver les données : l'accord migre vers les champs dédiés ; la
      // branche est remise à NON_RENSEIGNEE pour re-confirmation RH.
      await queryRunner.query(`
        UPDATE legal_entities
        SET accord_type = 'ACCORD_ENTREPRISE',
            accord_name = convention_name,
            accord_idcc = idcc,
            convention_type = 'NON_RENSEIGNEE',
            convention_name = NULL,
            idcc = NULL
        WHERE convention_type = 'ACCORD_ENTREPRISE'
      `);
      await queryRunner.query(`
        ALTER TABLE legal_entities
        MODIFY COLUMN convention_type enum('NON_RENSEIGNEE','LEGAL','SYNTEC') NOT NULL DEFAULT 'NON_RENSEIGNEE'
      `);
    }
  }

  async down(): Promise<void> {
    // Sans effet.
  }
}
