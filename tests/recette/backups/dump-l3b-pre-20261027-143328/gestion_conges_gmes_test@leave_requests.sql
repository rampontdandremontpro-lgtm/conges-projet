-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: leave_requests
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `leave_requests`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `created_by_id` bigint(20) DEFAULT NULL,
  `leave_type_id` bigint(20) NOT NULL,
  `service_id` bigint(20) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `start_period` enum('MATIN','APRES_MIDI') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MATIN',
  `end_period` enum('MATIN','APRES_MIDI') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'APRES_MIDI',
  `calendar_duration` int(11) NOT NULL,
  `deducted_days` decimal(7,2) NOT NULL,
  `duration_hours` decimal(7,2) DEFAULT NULL,
  `status` enum('BROUILLON','EN_ATTENTE_VALIDATION','VALIDEE','REFUSEE','ANNULEE','ANNULATION_EN_ATTENTE_ACCORD','ANNULEE_APRES_VALIDATION','EXPIREE_NON_VALIDEE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BROUILLON',
  `balance_processing_status` enum('DEMANDE_ACTUELLE','CONGE_PREVISIONNEL','A_CONSOLIDER','DEFINITIF') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DEMANDE_ACTUELLE',
  `is_anticipated_leave` tinyint(1) NOT NULL DEFAULT '0',
  `comment` text COLLATE utf8mb4_unicode_ci,
  `submitted_at` datetime DEFAULT NULL,
  `modification_deadline` date DEFAULT NULL,
  `real_balance_before` decimal(7,2) DEFAULT NULL,
  `potential_balance_before` decimal(7,2) DEFAULT NULL,
  `real_balance_after` decimal(7,2) DEFAULT NULL,
  `final_decider_id` bigint(20) DEFAULT NULL,
  `final_decider_role` enum('COLLABORATEUR','RESPONSABLE_SERVICE','RH','DIRECTEUR','ADMIN') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_at` datetime DEFAULT NULL,
  `refusal_comment` text COLLATE utf8mb4_unicode_ci,
  `employee_signature_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_signature_data` longtext COLLATE utf8mb4_unicode_ci,
  `employee_signed_at` datetime DEFAULT NULL,
  `validator_signature_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `validator_signature_data` longtext COLLATE utf8mb4_unicode_ci,
  `validator_signed_at` datetime DEFAULT NULL,
  `rh_confirmed_director_agreement` tinyint(1) NOT NULL DEFAULT '0',
  `rh_director_agreement_confirmed_at` datetime DEFAULT NULL,
  `is_urgent` tinyint(1) NOT NULL DEFAULT '0',
  `urgent_reason` text COLLATE utf8mb4_unicode_ci,
  `version` int(11) NOT NULL DEFAULT '1',
  `locked_at` datetime DEFAULT NULL,
  `cancellation_requested_by_id` bigint(20) DEFAULT NULL,
  `cancellation_reason` text COLLATE utf8mb4_unicode_ci,
  `employee_cancellation_consent` tinyint(1) DEFAULT NULL,
  `employee_cancellation_response_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_leave_requests_employee_dates` (`employee_id`,`start_date`,`end_date`),
  KEY `IDX_leave_requests_service_status` (`service_id`,`status`),
  KEY `IDX_leave_requests_status_submitted` (`status`,`submitted_at`),
  KEY `IDX_leave_requests_created_by_id` (`created_by_id`),
  KEY `IDX_leave_requests_leave_type_id` (`leave_type_id`),
  KEY `IDX_leave_requests_final_decider_id` (`final_decider_id`),
  KEY `IDX_leave_requests_cancellation_requested_by_id` (`cancellation_requested_by_id`),
  KEY `IDX_leave_requests_balance_processing` (`status`,`balance_processing_status`,`start_date`),
  CONSTRAINT `FK_leave_requests_cancellation_requested_by` FOREIGN KEY (`cancellation_requested_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_leave_requests_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_leave_requests_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_leave_requests_final_decider` FOREIGN KEY (`final_decider_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_leave_requests_leave_type` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_leave_requests_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
