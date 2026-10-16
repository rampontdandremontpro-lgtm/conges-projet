import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLegalEntities20261014100000 implements MigrationInterface {
  name = 'AddLegalEntities20261014100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('legal_entities'))) {
      await queryRunner.query(`
        CREATE TABLE legal_entities (
          id BIGINT NOT NULL AUTO_INCREMENT,
          code VARCHAR(40) NOT NULL,
          name VARCHAR(180) NOT NULL,
          logo_key VARCHAR(60) NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (id),
          UNIQUE KEY UQ_legal_entities_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    const seed = async (
      code: string,
      name: string,
      logoKey: string | null,
      sortOrder: number,
    ): Promise<void> => {
      const rows: unknown[] = await queryRunner.query(
        'SELECT id FROM legal_entities WHERE code = ?',
        [code],
      );
      if (rows.length === 0) {
        await queryRunner.query(
          `INSERT INTO legal_entities (code, name, logo_key, is_active, sort_order)
           VALUES (?, ?, ?, 1, ?)`,
          [code, name, logoKey, sortOrder],
        );
      }
    };

    await seed('GMES', 'GMES', 'gmes-logo', 0);
    await seed('EFFICIENCE', 'Efficience', null, 1);
    await seed('GMES_INGENIERIE', 'GMES Ingénierie', null, 2);

    const usersTable = await queryRunner.getTable('users');
    if (usersTable && !(await queryRunner.hasColumn('users', 'legal_entity_id'))) {
      await queryRunner.query(
        'ALTER TABLE users ADD COLUMN legal_entity_id BIGINT NULL AFTER service_id',
      );
      await queryRunner.query(`
        ALTER TABLE users
        ADD CONSTRAINT FK_users_legal_entity
        FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id)
        ON DELETE SET NULL
      `);
    }

    // Rattachement des collaborateurs internes existants à GMES.
    // Les collaborateurs externes / prestataires sont volontairement laissés
    // sans entreprise de rattachement (legal_entity_id NULL).
    await queryRunner.query(`
      UPDATE users u
      LEFT JOIN legal_entities gm ON gm.code = 'GMES'
      SET u.legal_entity_id = gm.id
      WHERE u.legal_entity_id IS NULL
        AND u.employment_type = 'INTERNE'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('users', 'legal_entity_id')) {
      await queryRunner.query(
        'ALTER TABLE users DROP FOREIGN KEY FK_users_legal_entity',
      );
      await queryRunner.query(
        'ALTER TABLE users DROP COLUMN legal_entity_id',
      );
    }
    await queryRunner.query('DROP TABLE IF EXISTS legal_entities');
  }
}
