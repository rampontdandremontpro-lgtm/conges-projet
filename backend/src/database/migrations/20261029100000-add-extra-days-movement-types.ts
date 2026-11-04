import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-019/020/021/022 — types de mouvement dédiés aux droits supplémentaires
 * d'ancienneté et de fractionnement. Ces droits ne doivent PAS être comptés
 * comme de l'ACQUISITION (sinon ils pollueraient le calcul du droit de base et
 * l'arrondi L3141-7), ni comme des CORRECTION_* (ce ne sont pas des
 * corrections manuelles).
 *
 * Migration idempotente : n'altère l'enum que si les valeurs manquent.
 */
export class AddExtraDaysMovementTypes20261029100000
  implements MigrationInterface
{
  name = 'AddExtraDaysMovementTypes20261029100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ Type: string }> = await queryRunner.query(
      "SHOW COLUMNS FROM balance_movements LIKE 'movement_type'",
    );
    const currentType = rows?.[0]?.Type ?? '';

    const missing = ['SENIORITY_EXTRA', 'FRACTIONNEMENT'].filter(
      (value) => !currentType.includes(value),
    );

    if (missing.length === 0) {
      return;
    }

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
        'FRACTIONNEMENT'
      ) NOT NULL
    `);
  }

  async down(): Promise<void> {
    // Volontairement sans effet : ne jamais supprimer des valeurs d'enum qui
    // pourraient être référencées par des mouvements existants.
  }
}
