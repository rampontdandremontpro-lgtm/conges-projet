-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: mail_reminder_logs
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `mail_reminder_logs`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `mail_reminder_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `recipient_email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `digest_date` date NOT NULL,
  `dedup_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reminder_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `last_attempt_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_mail_reminder_logs_recipient_dedup` (`recipient_email`,`dedup_key`),
  KEY `IDX_mail_reminder_logs_status_attempt` (`reminder_status`,`last_attempt_at`)
) ENGINE=InnoDB AUTO_INCREMENT=70 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
