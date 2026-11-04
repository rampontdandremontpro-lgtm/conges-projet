-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: backend_base    Table: claims
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `claims`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `claims` (
  `id` varchar(36) NOT NULL,
  `item_id` varchar(255) NOT NULL,
  `requester_profile_id` varchar(255) NOT NULL,
  `target_profile_id` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',
  `resolved_message` text,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_f04016fdcafcd9832319a199a4` (`requester_profile_id`,`status`),
  KEY `FK_883b102a389ac1a792063a1a65f` (`item_id`),
  CONSTRAINT `FK_883b102a389ac1a792063a1a65f` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
