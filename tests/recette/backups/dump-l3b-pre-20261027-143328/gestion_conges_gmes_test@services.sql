-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: services
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `services`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `services` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_type` enum('INTERNE','EXTERNE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `external_company_name` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_manager_id` bigint(20) DEFAULT NULL,
  `validation_mode` enum('RESPONSABLE_PUIS_RELAIS','DIRECTEUR_ET_RH','DIRECTEUR_SEUL','SANS_VALIDATION') COLLATE utf8mb4_unicode_ci NOT NULL,
  `takeover_delay_days` int(11) NOT NULL DEFAULT '7',
  `minimum_presence` int(11) DEFAULT NULL,
  `has_minimum_presence_rule` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_services_name_company` (`name`,`external_company_name`),
  KEY `IDX_services_primary_manager_id` (`primary_manager_id`),
  CONSTRAINT `FK_services_primary_manager` FOREIGN KEY (`primary_manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
