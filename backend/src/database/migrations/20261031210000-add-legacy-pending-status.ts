import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JUR-025/037 — compatibilité des décisions de maintien ANTÉRIEURES à la
 * structuration des fondements : ajoute le statut LEGACY_PENDING à l'énumération
 * (non destructive : MODIFY ENUM uniquement).
 *
 * Les décisions préexistantes ont déjà reçu leur statut lors de la migration
 * AddDecisionBasisStructured20261031190000 ; celle-ci (pour les bases déjà
 * migrées) ne fait qu'ajouter la valeur d'énumération. Aucune ligne n'est
 * marquée VALIDATED automatiquement : la validité indéterminée reste traçable
 * et doit être tranchée par la RH.
 */
export class AddLegacyPendingStatus20261031210000 implements MigrationInterface {
  name = 'AddLegacyPendingStatus20261031210000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE illness_maintenance_decisions MODIFY COLUMN basis_validation_status ENUM('PROPOSED','VALIDATED','LEGACY_PENDING') NOT NULL DEFAULT 'PROPOSED'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Aucune ligne ne doit rester sur une valeur inconnue avant rétrécissement.
    await queryRunner.query(
      `UPDATE illness_maintenance_decisions SET basis_validation_status = 'PROPOSED' WHERE basis_validation_status = 'LEGACY_PENDING'`,
    );
    await queryRunner.query(
      `ALTER TABLE illness_maintenance_decisions MODIFY COLUMN basis_validation_status ENUM('PROPOSED','VALIDATED') NOT NULL DEFAULT 'PROPOSED'`,
    );
  }
}
