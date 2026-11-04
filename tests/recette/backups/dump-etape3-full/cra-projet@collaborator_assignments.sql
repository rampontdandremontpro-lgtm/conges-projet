-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: collaborator_assignments
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `collaborator_assignments`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `collaborator_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `is_active` tinyint(4) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `collaborator_id` int(11) NOT NULL,
  `service_id` int(11) NOT NULL,
  `assigned_by_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_8b79fe55f383994d4c31c8f4396` (`collaborator_id`),
  KEY `FK_1433f2f9b31e0cbc702ab2ce52d` (`service_id`),
  KEY `FK_8e7c30055ce1d924913548ac3a1` (`assigned_by_user_id`),
  CONSTRAINT `FK_1433f2f9b31e0cbc702ab2ce52d` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `FK_8b79fe55f383994d4c31c8f4396` FOREIGN KEY (`collaborator_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `FK_8e7c30055ce1d924913548ac3a1` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
