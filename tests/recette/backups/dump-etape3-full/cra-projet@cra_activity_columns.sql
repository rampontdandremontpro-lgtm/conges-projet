-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: cra_activity_columns
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `cra_activity_columns`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cra_activity_columns` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_index` int(11) NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `cra_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_e5f997e5fd0d1304d0863836164` (`cra_id`),
  CONSTRAINT `FK_e5f997e5fd0d1304d0863836164` FOREIGN KEY (`cra_id`) REFERENCES `cra` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=250 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
