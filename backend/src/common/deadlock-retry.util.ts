import { ConflictException, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/**
 * JUR-027 — Sécurisation de la concurrence.
 *
 * Réessai borné et idempotent des opérations transactionnelles victimes d'un
 * deadlock MySQL (`ER_LOCK_DEADLOCK`, errno 1213). Le réessai enveloppe la
 * transaction ENTIÈRE (jamais une portion interne) : en cas de deadlock,
 * TypeORM a déjà rollbacké la transaction, donc rejouer l'opération complète
 * est sûr et idempotent. Aucun réessai n'est effectué pour les autres erreurs.
 */

const DEADLOCK_ERRNO = 1213;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 50;

function isDeadlockError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { errno?: number; code?: string };
  return driverError?.errno === DEADLOCK_ERRNO || driverError?.code === 'ER_LOCK_DEADLOCK';
}

export async function withDeadlockRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; backoffMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const label = options.label ?? 'opération';
  const logger = new Logger('DeadlockRetry');

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isDeadlockError(error) || attempt >= attempts) {
        throw error;
      }
      logger.warn(
        `Deadlock détecté sur « ${label} » — tentative ${attempt}/${attempts}, ` +
          `nouvelle tentative dans ${backoffMs * attempt} ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }

  // Inatteignable (boucle bornée + throw), mais conservé par sécurité.
  void lastError;
  throw new ConflictException(
    'Conflit de concurrence : l’opération a échoué à plusieurs reprises. Veuillez réessayer.',
  );
}
