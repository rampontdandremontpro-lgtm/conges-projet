-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: cra_days
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `cra_days`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cra_days` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `type` enum('TRAVAIL','CONGE','ABSENCE','NON_PLACE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `duree` decimal(3,1) NOT NULL,
  `commentaire` text COLLATE utf8mb4_unicode_ci,
  `cra_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_217d4a414f36dd522301fc8eb21` (`cra_id`),
  CONSTRAINT `FK_217d4a414f36dd522301fc8eb21` FOREIGN KEY (`cra_id`) REFERENCES `cra` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=2368 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
