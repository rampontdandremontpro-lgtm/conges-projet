import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — unicité SQL RÉELLE des anomalies.
 *
 * Un index UNIQUE sur des colonnes NULL (accrual_month, conflict_key) autorise
 * des doublons (NULL ≠ NULL en SQL). On remplace l'index par un index UNIQUE sur
 * des colonnes GÉNÉRÉES qui convertissent NULL en '' : l'unicité devient
 *  - (salarié, type, période, mois) quand il n'y a pas de conflict_key ;
 *  - (salarié, type, période, mois, conflict_key) quand les clés de conflit
 *    diffèrent ;
 *  - les anomalies sans mois (accrual_month NULL) restent uniques.
 *
 * Non destructive : ADD COLUMN générée + remplacement d'index. Les doublons
 * préexistants éventuels sont purgés en conservant la ligne la plus récente.
 */
export class FixAnomalyUniqueness20261031240000 implements MigrationInterface {
  name = 'FixAnomalyUniqueness20261031240000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('accrual_anomalies', 'uq_accrual_month'))) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies
           ADD COLUMN uq_accrual_month VARCHAR(7)
             GENERATED ALWAYS AS (COALESCE(accrual_month, '')) STORED`,
      );
    }
    if (!(await queryRunner.hasColumn('accrual_anomalies', 'uq_conflict_key'))) {
      await queryRunner.query(
        `ALTER TABLE accrual_anomalies
           ADD COLUMN uq_conflict_key VARCHAR(200)
             GENERATED ALWAYS AS (COALESCE(conflict_key, '')) STORED`,
      );
    }

    // Aucune suppression silencieuse : les anomalies peuvent porter une décision
    // RH et un historique. Si des doublons existent, la migration s'ARRÊTE
    // explicitement ; l'opérateur doit les résoudre manuellement (fusion
    // contrôlée préservant les décisions et leur trace) avant de relancer.
    const duplicateRows = (await queryRunner.query(
      `SELECT employee_id, type, reference_period,
              COALESCE(accrual_month, '') AS m,
              COALESCE(conflict_key, '') AS k,
              COUNT(*) AS c
         FROM accrual_anomalies
        GROUP BY employee_id, type, reference_period,
                 COALESCE(accrual_month, ''), COALESCE(conflict_key, '')
        HAVING COUNT(*) > 1
        LIMIT 1`,
    )) as Array<{
      employee_id: number;
      type: string;
      reference_period: string;
      m: string;
      k: string;
      c: number;
    }>;
    if (duplicateRows.length > 0) {
      const d = duplicateRows[0];
      throw new Error(
        `Migration interrompue : anomalies en double détectées (salarié ${d.employee_id}, type ${d.type}, période ${d.reference_period}, mois "${d.m}", conflit "${d.k}", ${d.c} lignes). ` +
        'Résolvez manuellement la fusion (en préservant les décisions RH et leur trace) avant de relancer la migration.',
      );
    }

    // Nouvel index UNIQUE strict (colonnes générées COALESCE(NULL → '')).
    // Ajouté AVANT la suppression de l'ancien index : il sert aussi d'index
    // pour la contrainte de clé étrangère sur employee_id.
    await queryRunner.query(
      `ALTER TABLE accrual_anomalies
         ADD UNIQUE INDEX UQ_accrual_anomaly_unique
         (employee_id, type, reference_period, uq_accrual_month, uq_conflict_key)`,
    );

    const oldIndexRows = (await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'accrual_anomalies'
          AND INDEX_NAME = 'UQ_accrual_anomaly_scoped'
        LIMIT 1`,
    )) as Array<{ INDEX_NAME: string }>;
    if (oldIndexRows.length > 0) {
      await queryRunner.query(
        'ALTER TABLE accrual_anomalies DROP INDEX UQ_accrual_anomaly_scoped',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE accrual_anomalies DROP INDEX UQ_accrual_anomaly_unique',
    );
    if (await queryRunner.hasColumn('accrual_anomalies', 'uq_conflict_key')) {
      await queryRunner.query(
        'ALTER TABLE accrual_anomalies DROP COLUMN uq_conflict_key',
      );
    }
    if (await queryRunner.hasColumn('accrual_anomalies', 'uq_accrual_month')) {
      await queryRunner.query(
        'ALTER TABLE accrual_anomalies DROP COLUMN uq_accrual_month',
      );
    }
    await queryRunner.query(
      `ALTER TABLE accrual_anomalies
         ADD UNIQUE INDEX UQ_accrual_anomaly_scoped
         (employee_id, type, reference_period, accrual_month, conflict_key)`,
    );
  }
}
