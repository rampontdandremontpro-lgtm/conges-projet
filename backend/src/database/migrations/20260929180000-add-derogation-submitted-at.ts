import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDerogationSubmittedAt20260929180000
  implements MigrationInterface
{
  name = 'AddDerogationSubmittedAt20260929180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('derogations');
    if (!table) {
      // La table n'existe pas encore : rien à migrer. Les environnements
      // fraîchement générés la créeront avec la colonne via les entités.
      return;
    }

    if (!(await queryRunner.hasColumn('derogations', 'submitted_at'))) {
      await queryRunner.query(`
        ALTER TABLE derogations
        ADD COLUMN submitted_at DATETIME NULL
        AFTER requested_at
      `);
    }

    // Reprise 1 — source principale : une dérogation a été réellement soumise
    // dès lors qu'au moins une notification DEROGATION_SUBMITTED_RH existe.
    // Cette notification est créée par submitDraft et jamais par createDraft.
    // On retient la date de la PREMIÈRE notification de soumission.
    await queryRunner.query(`
      UPDATE derogations d
      INNER JOIN (
        SELECT derogation_id, MIN(created_at) AS first_submitted_at
        FROM notifications
        WHERE type = 'DEROGATION_SUBMITTED_RH'
          AND derogation_id IS NOT NULL
        GROUP BY derogation_id
      ) n ON n.derogation_id = d.id
      SET d.submitted_at = n.first_submitted_at
      WHERE d.submitted_at IS NULL
    `);

    // Reprise 2 — fallback pour les dérogations définitivement traitées sans
    // notification historique exploitable. Une dérogation ACCORDEE / REFUSEE /
    // UTILISEE a nécessairement franchi le workflow de soumission. On ne
    // l'applique JAMAIS aux EN_ATTENTE_RH (qui peuvent être un simple brouillon
    // jamais soumis).
    await queryRunner.query(`
      UPDATE derogations
      SET submitted_at = COALESCE(decided_at, used_at, requested_at)
      WHERE submitted_at IS NULL
        AND status IN ('ACCORDEE', 'REFUSEE', 'UTILISEE')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('derogations', 'submitted_at')) {
      await queryRunner.query(
        'ALTER TABLE derogations DROP COLUMN submitted_at',
      );
    }
  }
}
