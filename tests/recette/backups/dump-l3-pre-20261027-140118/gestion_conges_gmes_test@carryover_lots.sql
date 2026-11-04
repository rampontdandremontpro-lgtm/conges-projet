-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: carryover_lots
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `carryover_lots`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `carryover_lots` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `source_reference_period` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_reference_period` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_counter_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'N-1',
  `days` decimal(7,2) NOT NULL DEFAULT '0.00',
  `remaining_days` decimal(7,2) DEFAULT NULL,
  `origin` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AUTRE',
  `regime` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'GENERAL',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'A_VERIFIER',
  `absence_start_date` date DEFAULT NULL,
  `absence_end_date` date DEFAULT NULL,
  `reprise_date` date DEFAULT NULL,
  `information_date` date DEFAULT NULL,
  `information_mode` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proof_id` bigint(20) DEFAULT NULL,
  `expires_at` date DEFAULT NULL,
  `expiry_basis` text COLLATE utf8mb4_unicode_ci,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `created_by` bigint(20) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_carryover_lots_employee_status` (`employee_id`,`status`),
  KEY `IDX_carryover_lots_target` (`target_reference_period`,`target_counter_type`),
  KEY `IDX_carryover_lots_expires` (`expires_at`),
  KEY `FK_carryover_lots_creator` (`created_by`),
  KEY `FK_carryover_lots_proof` (`proof_id`),
  CONSTRAINT `FK_carryover_lots_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_carryover_lots_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`),
  CONSTRAINT `FK_carryover_lots_proof` FOREIGN KEY (`proof_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
