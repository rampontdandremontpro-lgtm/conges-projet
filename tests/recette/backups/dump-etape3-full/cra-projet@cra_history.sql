-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: cra_history
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `cra_history`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cra_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action` enum('SOUMIS','REFUSE_CLIENT','CORRIGE','VALIDE_CLIENT','REFUSE_ADMIN','VALIDE_ADMIN','ARCHIVE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `motif` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `cra_id` int(11) NOT NULL,
  `actor_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_bf0adcd6de9c2e057a034546479` (`cra_id`),
  KEY `FK_d495c18f69754026d03e3476a59` (`actor_id`),
  CONSTRAINT `FK_bf0adcd6de9c2e057a034546479` FOREIGN KEY (`cra_id`) REFERENCES `cra` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `FK_d495c18f69754026d03e3476a59` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
