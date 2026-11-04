-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: gestion_conges_gmes_test    Table: leave_balances
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `leave_balances`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `leave_balances` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` bigint(20) NOT NULL,
  `reference_period` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `counter_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `acquired_days` decimal(7,2) NOT NULL DEFAULT '0.00',
  `reserved_days` decimal(7,2) NOT NULL DEFAULT '0.00',
  `consumed_days` decimal(7,2) NOT NULL DEFAULT '0.00',
  `available_days` decimal(7,2) NOT NULL DEFAULT '0.00',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_leave_balances_employee_period_counter` (`employee_id`,`reference_period`,`counter_type`),
  CONSTRAINT `FK_leave_balances_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
