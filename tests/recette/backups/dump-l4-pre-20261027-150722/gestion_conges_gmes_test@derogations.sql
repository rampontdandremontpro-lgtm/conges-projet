-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: derogations
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `derogations`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `derogations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `leave_type_id` bigint(20) NOT NULL,
  `leave_request_id` bigint(20) DEFAULT NULL,
  `requested_start_date` date NOT NULL,
  `requested_end_date` date NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('EN_ATTENTE_RH','ACCORDEE','REFUSEE','UTILISEE','EXPIREE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EN_ATTENTE_RH',
  `requested_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` datetime DEFAULT NULL,
  `decided_by_rh_id` bigint(20) DEFAULT NULL,
  `decision_comment` text COLLATE utf8mb4_unicode_ci,
  `decided_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_derogations_leave_request_id` (`leave_request_id`),
  KEY `IDX_derogations_employee_status` (`employee_id`,`status`),
  KEY `IDX_derogations_status_requested` (`status`,`requested_at`),
  KEY `IDX_derogations_leave_type_id` (`leave_type_id`),
  KEY `IDX_derogations_decided_by_rh_id` (`decided_by_rh_id`),
  CONSTRAINT `FK_derogations_decided_by_rh` FOREIGN KEY (`decided_by_rh_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_derogations_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_derogations_leave_request` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_derogations_leave_type` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
