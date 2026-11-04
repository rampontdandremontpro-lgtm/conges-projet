import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-028 — interaction arrêt maladie / congés déjà posés.
 *
 *  - ajoute le type de mouvement `ARRET_RESTITUTION` (restitution des jours de
 *    congé couverts par un arrêt maladie) ;
 *  - crée la table `leave_arrete_restaurations` (trace idempotente et
 *    réversible de chaque restitution).
 *
 * Migration idempotente et non destructive (aucune suppression de données).
 */
export class AddArreteRestitution20261029170000
  implements MigrationInterface
{
  name = 'AddArreteRestitution20261029170000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM balance_movements LIKE 'movement_type'",
    );
    const currentType = rows?.[0]?.Type ?? '';

    if (!currentType.includes('ARRET_RESTITUTION')) {
      await queryRunner.query(`
        ALTER TABLE balance_movements
        MODIFY COLUMN movement_type enum(
          'ACQUISITION',
          'RESERVATION',
          'LIBERATION_RESERVATION',
          'DEDUCTION',
          'CORRECTION_POSITIVE',
          'CORRECTION_NEGATIVE',
          'RECREDIT',
          'REMISE_A_ZERO',
          'SENIORITY_EXTRA',
          'FRACTIONNEMENT',
          'ARRET_RESTITUTION'
        ) NOT NULL
      `);
    }

    if (!(await queryRunner.hasTable('leave_arrete_restaurations'))) {
      await queryRunner.query(`
        CREATE TABLE leave_arrete_restaurations (
          id BIGINT NOT NULL AUTO_INCREMENT,
          absence_declaration_id BIGINT NOT NULL,
          leave_request_id BIGINT NOT NULL,
          leave_balance_id BIGINT NOT NULL,
          days DECIMAL(7,2) NOT NULL,
          dates_json TEXT NOT NULL,
          reversed_at DATETIME NULL,
          created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (id),
          UNIQUE KEY UQ_arrete_rest_absence_leave (absence_declaration_id, leave_request_id),
          CONSTRAINT FK_arrete_rest_absence FOREIGN KEY (absence_declaration_id) REFERENCES absence_declarations(id) ON DELETE CASCADE,
          CONSTRAINT FK_arrete_rest_leave_request FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE,
          CONSTRAINT FK_arrete_rest_balance FOREIGN KEY (leave_balance_id) REFERENCES leave_balances(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // Réglages par défaut (fonctionnalité désactivée tant que la RH ne l'active pas).
    await queryRunner.query(`
      INSERT INTO settings (setting_key, setting_value, description) VALUES
        ('ARRET_CHEVAUCHEMENT_ENABLED', 'false', 'JUR-028 - restitution automatique des conges couverts par un arret maladie'),
        ('ARRET_MALADIE_TYPE_IDS', '', 'JUR-028 - identifiants des types arret maladie (separes par des virgules)')
      ON DUPLICATE KEY UPDATE setting_key = setting_key
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS leave_arrete_restaurations');
    // Volontairement sans effet sur l'enum (ne jamais supprimer des valeurs
    // potentiellement référencées par des mouvements existants).
  }
}
