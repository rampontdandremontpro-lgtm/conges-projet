-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes    Table: holidays
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `holidays`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `holidays` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `name` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `holiday_type` enum('NATIONAL','MARTINIQUE','FERMETURE_GMES') COLLATE utf8mb4_unicode_ci NOT NULL,
  `deductible` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by_id` bigint(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_holidays_date_type` (`date`,`holiday_type`),
  KEY `IDX_holidays_created_by_id` (`created_by_id`),
  CONSTRAINT `FK_holidays_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
