import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — table `illness_maintenance_decisions` : décision RH individuelle
 * sur le maintien de salaire conventionnel (Syntec 5.5) d'un arrêt maladie/accident
 * non professionnel. Non destructive.
 */
export class CreateIllnessMaintenanceDecisions20261031150000
  implements MigrationInterface
{
  name = 'CreateIllnessMaintenanceDecisions20261031150000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('illness_maintenance_decisions')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE illness_maintenance_decisions (
        id BIGINT NOT NULL AUTO_INCREMENT,
        employee_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        basis ENUM('SYNTEC_5_5','ACCORD_ENTREPRISE','AUTRE') NOT NULL DEFAULT 'SYNTEC_5_5',
        justification TEXT NOT NULL,
        decided_by_id BIGINT NULL,
        decided_at DATETIME(6) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_illness_maintenance_employee_dates (employee_id, start_date, end_date),
        CONSTRAINT FK_illness_maintenance_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_illness_maintenance_decided_by FOREIGN KEY (decided_by_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('illness_maintenance_decisions')) {
      await queryRunner.query('DROP TABLE illness_maintenance_decisions');
    }
  }
}
