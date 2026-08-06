-- ============================================================================
-- GMES - Comptes locaux de test (développement uniquement)
-- Script idempotent : il peut être relancé sans créer de doublons.
-- N'exécute aucune suppression et ne modifie pas le schéma.
-- ============================================================================

USE `gestion_conges_gmes`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Mots de passe locaux de test :
-- admin@gmes.fr          / AdminGMES@2026!
-- rh@gmes.fr             / RhGMES@2026!
-- directeur@gmes.fr      / DirecteurGMES@2026!
-- responsable@gmes.fr    / ResponsableGMES@2026!
-- collaborateur@gmes.fr  / CollaborateurGMES@2026!
--
-- Ces comptes servent exclusivement au développement et aux tests locaux.

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'ADMINISTRATION', 'GMES', 'admin@gmes.fr',
  '$2b$12$DTkiZm6PFeUmhzTClz4kxOuNLpIwFBflptTbIQBoXwqlcYfqbH0CO',
  NULL, 'ADMIN', 'INTERNE', NULL, NULL, 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'ADMIN',
  `employment_type` = 'INTERNE',
  `service_id` = NULL,
  `hire_date` = NULL,
  `presence_status` = 'PRESENT',
  `is_active` = 1;

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'DUPONT', 'Sophie', 'rh@gmes.fr',
  '$2b$12$Re3ZvazxqNkNBudBa6tnSuvZiPMNoXJwaopnjkmxvbzeWdBOdPVMi',
  NULL, 'RH', 'INTERNE', 6, '2024-01-01', 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'RH',
  `employment_type` = 'INTERNE',
  `service_id` = 6,
  `hire_date` = '2024-01-01',
  `presence_status` = 'PRESENT',
  `is_active` = 1;

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'LEROY', 'Marc', 'directeur@gmes.fr',
  '$2b$12$f4ZL2RI110g9mz1Xmr729u2Aoh8yKSaal3j8rg541ovTQ.UUKPTtW',
  NULL, 'DIRECTEUR', 'INTERNE', 1, '2023-01-01', 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'DIRECTEUR',
  `employment_type` = 'INTERNE',
  `service_id` = 1,
  `hire_date` = '2023-01-01',
  `presence_status` = 'PRESENT',
  `is_active` = 1;

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'ROBERT', 'Julien', 'responsable@gmes.fr',
  '$2b$12$WwBZXF.5hXxz188wXetT..E/b60b5Ki.mP/ft9HiKMPH3ZAq4jkua',
  NULL, 'RESPONSABLE_SERVICE', 'INTERNE', 4, '2024-02-01', 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'RESPONSABLE_SERVICE',
  `employment_type` = 'INTERNE',
  `service_id` = 4,
  `hire_date` = '2024-02-01',
  `presence_status` = 'PRESENT',
  `is_active` = 1;

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'MARTIN', 'Paul', 'collaborateur@gmes.fr',
  '$2b$12$NfYdoShurVQp1sbnOdWv4.o9Fq19WbT04NPb8.2sYKmDdVtNvnWpq',
  NULL, 'COLLABORATEUR', 'INTERNE', 5, '2025-01-01', 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'COLLABORATEUR',
  `employment_type` = 'INTERNE',
  `service_id` = 5,
  `hire_date` = '2025-01-01',
  `presence_status` = 'PRESENT',
  `is_active` = 1;

-- Configuration conforme au circuit de l'Équipe technique.
UPDATE `services`
SET
  `primary_manager_id` = (
    SELECT `id` FROM `users` WHERE `email` = 'responsable@gmes.fr' LIMIT 1
  ),
  `validation_mode` = 'RESPONSABLE_PUIS_RELAIS',
  `takeover_delay_days` = 7,
  `minimum_presence` = 3,
  `has_minimum_presence_rule` = 1,
  `is_active` = 1
WHERE `id` = 4;

-- Le Pôle Applicatif conserve son circuit Directeur + RH et son seuil de présence.
UPDATE `services`
SET
  `validation_mode` = 'DIRECTEUR_ET_RH',
  `takeover_delay_days` = 7,
  `minimum_presence` = 1,
  `has_minimum_presence_rule` = 1,
  `is_active` = 1
WHERE `id` = 5;

SELECT
  `id`, `nom`, `prenom`, `email`, `role`, `service_id`, `is_active`
FROM `users`
WHERE `email` IN (
  'admin@gmes.fr',
  'rh@gmes.fr',
  'directeur@gmes.fr',
  'responsable@gmes.fr',
  'collaborateur@gmes.fr'
)
ORDER BY FIELD(
  `role`,
  'ADMIN',
  'RH',
  'DIRECTEUR',
  'RESPONSABLE_SERVICE',
  'COLLABORATEUR'
);
