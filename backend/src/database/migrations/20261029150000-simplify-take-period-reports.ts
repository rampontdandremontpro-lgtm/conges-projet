import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-023 — adaptation NON DESTRUCTIVE de `take_period_reports` :
 *  - conserve intégralement les enregistrements existants (aucun DROP TABLE,
 *    aucun DELETE) ;
 *  - si des reports maladie historiques (`report_type = 'MALADIE'`) existent,
 *    la migration REFUSE de s'exécuter (message explicite) AVANT toute
 *    modification du schéma, car leur conversion fiable vers JUR-027 n'est pas
 *    automatisable sans risque de perte ou de transformation silencieuse ;
 *  - sinon, supprime la colonne `report_type` (plus aucun report maladie dans
 *    cette table — uniquement des reports ordinaires) ;
 *  - ajoute `document_reference` (colonne d'historique, jamais supprimée) et
 *    `updated_at` ;
 *  - adapte la contrainte d'unicité (employé + période) ;
 *  - gère proprement les clés étrangères (drop puis re-création).
 */
export class SimplifyTakePeriodReports20261029150000
  implements MigrationInterface
{
  name = 'SimplifyTakePeriodReports20261029150000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('take_period_reports'))) {
      return;
    }

    // Garde-fou AVANT toute modification du schéma : refus sécurisé si des
    // reports maladie historiques existent (aucune donnée perdue).
    if (await queryRunner.hasColumn('take_period_reports', 'report_type')) {
      const maladie = (await queryRunner.query(
        "SELECT COUNT(*) AS c FROM take_period_reports WHERE report_type = 'MALADIE'",
      )) as Array<{ c: string | number }>;
      if (Number(maladie[0]?.c ?? 0) > 0) {
        throw new Error(
          'Migration 20261029150000 refusée : des reports maladie existent dans ' +
            'take_period_reports. Leur migration fiable vers JUR-027 n’est pas ' +
            'automatisable de façon sûre (aucune perte ni transformation silencieuse). ' +
            'Traitez ces enregistrements (rattachement à JUR-027 ou validation RH) ' +
            'avant de relancer la migration. Aucune modification du schéma n’a été effectuée ; ' +
            'toutes les données sont conservées.',
        );
      }
    }

    const dropForeignKey = async (name: string): Promise<void> => {
      const rows: Array<{ CONSTRAINT_NAME: string }> = await queryRunner.query(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'take_period_reports' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?",
        [name],
      );
      if (rows.length > 0) {
        await queryRunner.query(
          `ALTER TABLE take_period_reports DROP FOREIGN KEY \`${name}\``,
        );
      }
    };

    const dropIndex = async (name: string): Promise<void> => {
      const rows: Array<{ Key_name: string }> = await queryRunner.query(
        'SHOW INDEX FROM take_period_reports WHERE Key_name = ?',
        [name],
      );
      if (rows.length > 0) {
        await queryRunner.query(
          `ALTER TABLE take_period_reports DROP INDEX \`${name}\``,
        );
      }
    };

    await dropForeignKey('FK_take_period_reports_employee');
    await dropForeignKey('FK_take_period_reports_requested_by');
    await dropIndex('UQ_take_period_reports_emp_period_type');

    if (await queryRunner.hasColumn('take_period_reports', 'report_type')) {
      await queryRunner.query(
        'ALTER TABLE take_period_reports DROP COLUMN report_type',
      );
    }
    if (!(await queryRunner.hasColumn('take_period_reports', 'document_reference'))) {
      await queryRunner.query(
        'ALTER TABLE take_period_reports ADD COLUMN document_reference VARCHAR(255) NULL AFTER justification',
      );
    }
    if (!(await queryRunner.hasColumn('take_period_reports', 'updated_at'))) {
      await queryRunner.query(
        'ALTER TABLE take_period_reports ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) AFTER created_at',
      );
    }

    await dropIndex('UQ_take_period_reports_emp_period');
    await queryRunner.query(
      'ALTER TABLE take_period_reports ADD UNIQUE KEY UQ_take_period_reports_emp_period (employee_id, reference_period)',
    );

    await queryRunner.query(
      'ALTER TABLE take_period_reports ADD CONSTRAINT FK_take_period_reports_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE take_period_reports ADD CONSTRAINT FK_take_period_reports_requested_by FOREIGN KEY (requested_by_id) REFERENCES users(id) ON DELETE RESTRICT',
    );
  }

  async down(): Promise<void> {
    // Sans effet (aucune donnée de production concernée).
  }
}
