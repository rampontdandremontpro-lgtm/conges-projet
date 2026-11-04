-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: backend_base    Table: items
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `items`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `items` (
  `id` varchar(36) NOT NULL,
  `title` varchar(120) NOT NULL,
  `description` text NOT NULL,
  `status` varchar(10) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `owner_profile_id` varchar(255) NOT NULL,
  `category_id` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_e2bb75604546abf6aa43737eaa` (`title`),
  KEY `IDX_36275759f2cbc3b5ca32f39341` (`status`),
  KEY `FK_6e3c5d795e65b2f9afbf804ddb0` (`owner_profile_id`),
  KEY `FK_0c4aa809ddf5b0c6ca45d8a8e80` (`category_id`),
  CONSTRAINT `FK_0c4aa809ddf5b0c6ca45d8a8e80` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `FK_6e3c5d795e65b2f9afbf804ddb0` FOREIGN KEY (`owner_profile_id`) REFERENCES `user_profiles` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
