USE `gestion_conges_gmes`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @employee_email = 'collaborateur@gmes.fr';
SET @reference_period = '2026-2027';
SET @employee_id = (SELECT `id` FROM `users` WHERE `email` = @employee_email LIMIT 1);

INSERT INTO `leave_balances` (
  `employee_id`, `reference_period`, `counter_type`, `acquired_days`, `reserved_days`, `consumed_days`, `available_days`
)
SELECT @employee_id, @reference_period, 'N-1', 20.00, 0.00, 0.00, 20.00
WHERE @employee_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  `acquired_days` = 20.00,
  `available_days` = 20.00;

INSERT INTO `leave_balances` (
  `employee_id`, `reference_period`, `counter_type`, `acquired_days`, `reserved_days`, `consumed_days`, `available_days`
)
SELECT @employee_id, @reference_period, 'N', 5.00, 0.00, 0.00, 5.00
WHERE @employee_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  `acquired_days` = 5.00,
  `reserved_days` = 0.00,
  `consumed_days` = 0.00,
  `available_days` = 5.00;

UPDATE `leave_balances`
SET `acquired_days` = 0.00,
    `reserved_days` = 0.00,
    `consumed_days` = 0.00,
    `available_days` = 0.00
WHERE `employee_id` = @employee_id
  AND `reference_period` = @reference_period
  AND `counter_type` = 'N+1';

SELECT
  `counter_type`,
  `acquired_days`,
  `reserved_days`,
  `consumed_days`,
  `available_days`,
  (`available_days` - `reserved_days`) AS `available_after_reservations`
FROM `leave_balances`
WHERE `employee_id` = @employee_id
  AND `reference_period` = @reference_period
ORDER BY FIELD(`counter_type`, 'N-1', 'N', 'N+1');
