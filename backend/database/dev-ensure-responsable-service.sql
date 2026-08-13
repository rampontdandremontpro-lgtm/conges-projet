USE `gestion_conges_gmes`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @technical_service_id := (
  SELECT `id`
  FROM `services`
  WHERE `name` = 'Équipe technique'
    AND `service_type` = 'INTERNE'
  LIMIT 1
);

INSERT INTO `users` (
  `nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`,
  `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`
) VALUES (
  'ROBERT', 'Julien', 'responsable@gmes.fr',
  '$2b$12$WwBZXF.5hXxz188wXetT..E/b60b5Ki.mP/ft9HiKMPH3ZAq4jkua',
  NULL, 'RESPONSABLE_SERVICE', 'INTERNE', @technical_service_id, '2024-02-01', 'PRESENT', 1
)
ON DUPLICATE KEY UPDATE
  `nom` = VALUES(`nom`),
  `prenom` = VALUES(`prenom`),
  `password_hash` = VALUES(`password_hash`),
  `microsoft_id` = NULL,
  `role` = 'RESPONSABLE_SERVICE',
  `employment_type` = 'INTERNE',
  `service_id` = @technical_service_id,
  `hire_date` = '2024-02-01',
  `presence_status` = 'PRESENT',
  `is_active` = 1;

SET @manager_id := (
  SELECT `id`
  FROM `users`
  WHERE `email` = 'responsable@gmes.fr'
  LIMIT 1
);

UPDATE `services`
SET
  `primary_manager_id` = @manager_id,
  `validation_mode` = 'RESPONSABLE_PUIS_RELAIS',
  `takeover_delay_days` = 7,
  `minimum_presence` = 3,
  `has_minimum_presence_rule` = 1,
  `is_active` = 1
WHERE `id` = @technical_service_id;

SELECT
  u.`id`, u.`nom`, u.`prenom`, u.`email`, u.`role`,
  s.`name` AS `service`, s.`validation_mode`, s.`minimum_presence`
FROM `users` u
LEFT JOIN `services` s ON s.`id` = u.`service_id`
WHERE u.`email` = 'responsable@gmes.fr';
