-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: notifications
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `notifications`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `channel` enum('APPLICATION','EMAIL','LES_DEUX') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'LES_DEUX',
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `leave_request_id` bigint(20) DEFAULT NULL,
  `absence_declaration_id` bigint(20) DEFAULT NULL,
  `derogation_id` bigint(20) DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `email_sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_notifications_user_read` (`user_id`,`read_at`),
  KEY `IDX_notifications_type_created` (`type`,`created_at`),
  KEY `IDX_notifications_leave_request_id` (`leave_request_id`),
  KEY `IDX_notifications_absence_declaration_id` (`absence_declaration_id`),
  KEY `IDX_notifications_derogation_id` (`derogation_id`),
  CONSTRAINT `FK_notifications_absence_declaration` FOREIGN KEY (`absence_declaration_id`) REFERENCES `absence_declarations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_notifications_derogation` FOREIGN KEY (`derogation_id`) REFERENCES `derogations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_notifications_leave_request` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `FK_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=256 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
