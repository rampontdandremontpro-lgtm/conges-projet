-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes    Table: documents
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `documents`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `leave_request_id` bigint(20) DEFAULT NULL,
  `absence_declaration_id` bigint(20) DEFAULT NULL,
  `document_kind` enum('JUSTIFICATIF','PDF_VALIDATION','PDF_ANNULATION') COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `storage_key` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` bigint(20) DEFAULT NULL,
  `status` enum('EN_ATTENTE','ACCEPTE','REJETE','ARCHIVE','SUPPRIME') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EN_ATTENTE',
  `uploaded_by_id` bigint(20) DEFAULT NULL,
  `verified_by_rh_id` bigint(20) DEFAULT NULL,
  `rejection_reason` text COLLATE utf8mb4_unicode_ci,
  `retention_until` date DEFAULT NULL,
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_documents_storage_key` (`storage_key`),
  KEY `IDX_documents_leave_request` (`leave_request_id`),
  KEY `IDX_documents_absence_declaration` (`absence_declaration_id`),
  KEY `IDX_documents_kind_status` (`document_kind`,`status`),
  KEY `IDX_documents_uploaded_by_id` (`uploaded_by_id`),
  KEY `IDX_documents_verified_by_rh_id` (`verified_by_rh_id`),
  CONSTRAINT `FK_documents_absence_declaration` FOREIGN KEY (`absence_declaration_id`) REFERENCES `absence_declarations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_documents_leave_request` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_documents_uploaded_by` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `FK_documents_verified_by_rh` FOREIGN KEY (`verified_by_rh_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
