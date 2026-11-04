import type { DataSource } from 'typeorm';

/**
 * Garde-fou de compatibilité de schéma (déploiement).
 *
 * Empêche de démarrer un code récent sur une base dont le schéma ne contient
 * pas encore les colonnes/valeurs requises par les entités. Sans ce contrôle,
 * l'application démarrerait puis échouerait en cours d'exécution (colonne
 * inconnue) lors de la première écriture — un échec plus dangereux et plus
 * difficile à diagnostiquer.
 *
 * Les migrations sont volontairement désactivées sur la base réelle (voir
 * `app.module.ts`) ; ce contrôle échoue donc rapidement avec une consigne
 * claire : appliquer les migrations explicitement (`MIGRATIONS_AUTHORIZED=true`)
 * avant de démarrer cette version.
 */
export async function assertDatabaseSchemaCompatible(
  dataSource: DataSource,
): Promise<void> {
  const missing: string[] = [];

  const leaveClassification = await dataSource.query(
    "SHOW COLUMNS FROM leave_requests LIKE 'leave_classification'",
  );
  if (!Array.isArray(leaveClassification) || leaveClassification.length === 0) {
    missing.push('leave_requests.leave_classification');
  }

  const movementType = await dataSource.query(
    "SHOW COLUMNS FROM balance_movements LIKE 'movement_type'",
  );
  const movementTypeValue: string =
    movementType?.[0]?.Type ?? '';
  if (
    !movementTypeValue.includes('SENIORITY_EXTRA') ||
    !movementTypeValue.includes('FRACTIONNEMENT')
  ) {
    missing.push(
      'balance_movements.movement_type (valeurs SENIORITY_EXTRA / FRACTIONNEMENT)',
    );
  }

  if (missing.length > 0) {
    throw new Error(
      'Schéma de base de données incompatible avec cette version du code. ' +
        'Élément(s) manquant(s) : ' +
        missing.join(', ') +
        '. Appliquez d’abord les migrations sur cette base ' +
        '(démarrage avec MIGRATIONS_AUTHORIZED=true), puis redémarrez l’application.',
    );
  }
}
