import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-021/022 — identification fiable de la cinquième semaine de congés.
 *
 * Le fractionnement ne peut pas être calculé de façon fiable en supposant que
 * les 20 premiers jours ouvrés (ou 24 ouvrables) chronologiques constituent le
 * congé principal : la 5e semaine peut être prise avant une fraction du congé
 * principal. Cette colonne permet à la RH de marquer explicitement une demande
 * comme relevant de la 5e semaine (exclue du fractionnement).
 *
 * Migration idempotente et non destructive (simple ajout de colonne, défaut 0).
 */
export class AddLeaveRequestIsFifthWeek20261029120000
  implements MigrationInterface
{
  name = 'AddLeaveRequestIsFifthWeek20261029120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('leave_requests', 'is_fifth_week'))) {
      await queryRunner.query(
        'ALTER TABLE leave_requests ADD COLUMN is_fifth_week TINYINT(1) NOT NULL DEFAULT 0',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('leave_requests', 'is_fifth_week')) {
      await queryRunner.query(
        'ALTER TABLE leave_requests DROP COLUMN is_fifth_week',
      );
    }
  }
}
