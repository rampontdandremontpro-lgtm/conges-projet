-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: cra_activity_entries
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `cra_activity_entries`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cra_activity_entries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `duree` decimal(3,1) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `cra_id` int(11) DEFAULT NULL,
  `cra_day_id` int(11) DEFAULT NULL,
  `activity_column_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_1ff942889ec54b77c1d8a7f894b` (`cra_id`),
  KEY `FK_bf971599db4d6df4244c06732d6` (`cra_day_id`),
  KEY `FK_918a62d8e8151df730ddb4400a8` (`activity_column_id`),
  CONSTRAINT `FK_1ff942889ec54b77c1d8a7f894b` FOREIGN KEY (`cra_id`) REFERENCES `cra` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `FK_918a62d8e8151df730ddb4400a8` FOREIGN KEY (`activity_column_id`) REFERENCES `cra_activity_columns` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `FK_bf971599db4d6df4244c06732d6` FOREIGN KEY (`cra_day_id`) REFERENCES `cra_days` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1694 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
