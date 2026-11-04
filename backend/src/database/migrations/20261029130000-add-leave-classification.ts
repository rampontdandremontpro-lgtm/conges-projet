import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-021/022 — classification fiable des demandes pour le fractionnement.
 *
 * Remplace le drapeau booléen `is_fifth_week` (défaut `false` ambigu) par un
 * enum explicite à trois états :
 *  - UNDETERMINED : non classifiée (demandes historiques) — jamais utilisée
 *    pour un calcul automatique de fractionnement ;
 *  - MAIN : congé principal confirmé ;
 *  - FIFTH_WEEK : cinquième semaine confirmée (exclue du fractionnement).
 *
 * Migration idempotente : ajoute `leave_classification`, recopie les données de
 * l'ancien drapeau (1 → FIFTH_WEEK, 0 → UNDETERMINED) puis supprime l'ancienne
 * colonne (jamais déployée en production).
 */
export class AddLeaveClassification20261029130000
  implements MigrationInterface
{
  name = 'AddLeaveClassification20261029130000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('leave_requests', 'leave_classification'))) {
      await queryRunner.query(
        "ALTER TABLE leave_requests ADD COLUMN leave_classification VARCHAR(20) NOT NULL DEFAULT 'UNDETERMINED'",
      );
    }

    if (await queryRunner.hasColumn('leave_requests', 'is_fifth_week')) {
      await queryRunner.query(
        "UPDATE leave_requests SET leave_classification = CASE WHEN is_fifth_week = 1 THEN 'FIFTH_WEEK' ELSE 'UNDETERMINED' END",
      );
      await queryRunner.query(
        'ALTER TABLE leave_requests DROP COLUMN is_fifth_week',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('leave_requests', 'leave_classification')) {
      await queryRunner.query(
        'ALTER TABLE leave_requests DROP COLUMN leave_classification',
      );
    }
  }
}
