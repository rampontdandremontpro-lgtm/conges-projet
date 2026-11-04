-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes    Table: users
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `users`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prenom` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `microsoft_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('COLLABORATEUR','RESPONSABLE_SERVICE','RH','DIRECTEUR','ADMIN') COLLATE utf8mb4_unicode_ci NOT NULL,
  `employment_type` enum('INTERNE','EXTERNE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INTERNE',
  `service_id` bigint(20) DEFAULT NULL,
  `legal_entity_id` bigint(20) DEFAULT NULL,
  `hire_date` date DEFAULT NULL,
  `exit_date` date DEFAULT NULL,
  `presence_status` enum('PRESENT','EN_VACANCES','ABSENT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PRESENT',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0',
  `signature_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signature_data` longtext COLLATE utf8mb4_unicode_ci,
  `signature_updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_users_email` (`email`),
  UNIQUE KEY `UQ_users_microsoft_id` (`microsoft_id`),
  KEY `IDX_users_service_id` (`service_id`),
  KEY `FK_users_legal_entity` (`legal_entity_id`),
  CONSTRAINT `FK_users_legal_entity` FOREIGN KEY (`legal_entity_id`) REFERENCES `legal_entities` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_users_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
