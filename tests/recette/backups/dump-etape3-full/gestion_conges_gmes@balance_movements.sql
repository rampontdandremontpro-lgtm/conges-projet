-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes    Table: balance_movements
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `balance_movements`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `balance_movements` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `leave_balance_id` bigint(20) NOT NULL,
  `leave_request_id` bigint(20) DEFAULT NULL,
  `actor_id` bigint(20) DEFAULT NULL,
  `movement_type` enum('ACQUISITION','RESERVATION','LIBERATION_RESERVATION','DEDUCTION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE','RECREDIT','REMISE_A_ZERO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `days` decimal(7,2) NOT NULL,
  `balance_before` decimal(7,2) NOT NULL,
  `balance_after` decimal(7,2) NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_balance_movements_employee_created` (`employee_id`,`created_at`),
  KEY `IDX_balance_movements_leave_request` (`leave_request_id`),
  KEY `IDX_balance_movements_leave_balance_id` (`leave_balance_id`),
  KEY `IDX_balance_movements_actor_id` (`actor_id`),
  CONSTRAINT `FK_balance_movements_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_balance_movements_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_balance_movements_leave_balance` FOREIGN KEY (`leave_balance_id`) REFERENCES `leave_balances` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_balance_movements_leave_request` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
