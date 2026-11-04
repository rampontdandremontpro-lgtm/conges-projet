-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: absence_declarations
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `absence_declarations`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `absence_declarations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `created_by_id` bigint(20) DEFAULT NULL,
  `leave_type_id` bigint(20) NOT NULL,
  `service_id` bigint(20) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `start_period` enum('MATIN','APRES_MIDI') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `end_period` enum('MATIN','APRES_MIDI') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `duration_days` decimal(7,2) DEFAULT NULL,
  `duration_hours` decimal(7,2) DEFAULT NULL,
  `status` enum('BROUILLON','DECLAREE','JUSTIFICATIF_EN_ATTENTE','A_VERIFIER_PAR_RH','JUSTIFICATIF_REJETE','ENREGISTREE','ANNULEE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BROUILLON',
  `comment` text COLLATE utf8mb4_unicode_ci,
  `declared_at` datetime DEFAULT NULL,
  `verified_by_rh_id` bigint(20) DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_absence_employee_dates` (`employee_id`,`start_date`,`end_date`),
  KEY `IDX_absence_status_declared` (`status`,`declared_at`),
  KEY `IDX_absence_created_by_id` (`created_by_id`),
  KEY `IDX_absence_leave_type_id` (`leave_type_id`),
  KEY `IDX_absence_service_id` (`service_id`),
  KEY `IDX_absence_verified_by_rh_id` (`verified_by_rh_id`),
  CONSTRAINT `FK_absence_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_absence_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_absence_leave_type` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_absence_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_absence_verified_by_rh` FOREIGN KEY (`verified_by_rh_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
