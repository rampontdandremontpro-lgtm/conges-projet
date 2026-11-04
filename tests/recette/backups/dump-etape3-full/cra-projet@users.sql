-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: users
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `users`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prenom` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fonction` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('COLLABORATEUR','CLIENT','RH','ADMIN','SUPER_CLIENT','SUPER_ADMIN') COLLATE utf8mb4_unicode_ci NOT NULL,
  `contract_type` enum('CDI','CDD','FREELANCE') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(4) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `service_id` int(11) DEFAULT NULL,
  `contract_start_date` date DEFAULT NULL,
  `contract_end_date` date DEFAULT NULL,
  `cra_start_date` date DEFAULT NULL,
  `password_reset_token_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_reset_token_expires_at` datetime DEFAULT NULL,
  `company_id` int(11) DEFAULT NULL,
  `saved_signature_type` enum('DRAWN','INITIALS') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `saved_signature_data` longtext COLLATE utf8mb4_unicode_ci,
  `saved_signature_updated_at` datetime DEFAULT NULL,
  `auth_version` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_97672ac88f789774dd47f7c8be` (`email`),
  KEY `FK_7a468ab9243446ae6a06faff0d7` (`service_id`),
  KEY `FK_7ae6334059289559722437bcc1c` (`company_id`),
  CONSTRAINT `FK_7a468ab9243446ae6a06faff0d7` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `FK_7ae6334059289559722437bcc1c` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
