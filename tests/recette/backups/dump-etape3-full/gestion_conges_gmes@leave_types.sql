-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes    Table: leave_types
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `leave_types`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `leave_types` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('DEMANDE_CONGE','DECLARATION_ABSENCE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `deducts_paid_leave_balance` tinyint(1) NOT NULL DEFAULT '0',
  `document_required` tinyint(1) NOT NULL DEFAULT '0',
  `document_can_be_added_later` tinyint(1) NOT NULL DEFAULT '1',
  `employee_can_create` tinyint(1) NOT NULL DEFAULT '1',
  `rh_only` tinyint(1) NOT NULL DEFAULT '0',
  `allows_days` tinyint(1) NOT NULL DEFAULT '1',
  `allows_half_days` tinyint(1) NOT NULL DEFAULT '1',
  `allows_hours` tinyint(1) NOT NULL DEFAULT '0',
  `requires_validation` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_leave_types_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
