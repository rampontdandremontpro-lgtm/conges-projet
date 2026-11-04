-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: backend_base    Table: user_profiles
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `user_profiles`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_profiles` (
  `id` varchar(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `credentials_id` varchar(255) NOT NULL,
  `permission_mask` bigint(20) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `REL_ea4e83c046870edb30bc160a13` (`credentials_id`),
  CONSTRAINT `FK_ea4e83c046870edb30bc160a13f` FOREIGN KEY (`credentials_id`) REFERENCES `user_credentials` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
