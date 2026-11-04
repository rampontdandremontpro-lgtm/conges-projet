import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';

export interface PeriodClosureLockContext {
  manager: EntityManager;
  queryRunner: QueryRunner;
}

/**
 * Sérialise un traitement transactionnel par période via MySQL `GET_LOCK`, sur
 * une connexion unique explicitement conservée (`QueryRunner`).
 *
 * Garanties :
 * - le verrou est acquis sur une connexion connue (`queryRunner`) ;
 * - le traitement transactionnel s'exécute sur cette même connexion ;
 * - le verrou est conservé jusqu'au COMMIT ou ROLLBACK effectif ;
 * - le verrou est relâché sur la même connexion, y compris après erreur ;
 * - la connexion est rendue au pool dans tous les cas.
 *
 * `GET_LOCK` est possédé par la session MySQL : il ne peut être relâché que par
 * la connexion qui l'a acquis. C'est pourquoi le verrou, la transaction et le
 * `RELEASE_LOCK` doivent partager le même `QueryRunner`.
 */
export async function withPeriodClosureLock<T>(
  dataSource: DataSource,
  lockName: string,
  lockTimeoutSeconds: number,
  work: (ctx: PeriodClosureLockContext) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let lockAcquired = false;
  try {
    const rows = (await queryRunner.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [lockName, lockTimeoutSeconds],
    )) as Array<{ acquired: number | string }>;
    lockAcquired = Number(rows?.[0]?.acquired ?? 0) === 1;

    if (!lockAcquired) {
      throw new ConflictException(
        'Clôture concurrente en cours sur cette période.',
      );
    }

    await queryRunner.startTransaction();
    try {
      const result = await work({
        manager: queryRunner.manager,
        queryRunner,
      });
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    }
  } finally {
    if (lockAcquired) {
      try {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch {
        // La connexion peut déjà être fermée ; le verrou meurt avec la session.
      }
    }
    await queryRunner.release();
  }
}
