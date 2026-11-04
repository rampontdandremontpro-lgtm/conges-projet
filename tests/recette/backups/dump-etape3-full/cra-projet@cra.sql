-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: cra-projet    Table: cra
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `cra`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cra` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `mois` int(11) NOT NULL,
  `annee` int(11) NOT NULL,
  `statut` enum('BROUILLON','SOUMIS_CLIENT','REFUSE_CLIENT','VALIDE_CLIENT','REFUSE_ADMIN','VALIDE_ADMIN','ARCHIVE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BROUILLON',
  `date_soumission` datetime DEFAULT NULL,
  `date_validation_client` datetime DEFAULT NULL,
  `date_refus_client` datetime DEFAULT NULL,
  `motif_refus_client` text COLLATE utf8mb4_unicode_ci,
  `date_validation_admin` datetime DEFAULT NULL,
  `date_refus_admin` datetime DEFAULT NULL,
  `motif_refus_admin` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `collaborateur_id` int(11) NOT NULL,
  `service_id` int(11) NOT NULL,
  `client_validator_id` int(11) DEFAULT NULL,
  `client_refuser_id` int(11) DEFAULT NULL,
  `admin_validator_id` int(11) DEFAULT NULL,
  `admin_refuser_id` int(11) DEFAULT NULL,
  `client_signature_type` enum('DRAWN','INITIALS') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_signature_data` longtext COLLATE utf8mb4_unicode_ci,
  `admin_signature_type` enum('DRAWN','INITIALS') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `admin_signature_data` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `FK_0a557d2c8f73cd9b263f0279e5a` (`collaborateur_id`),
  KEY `FK_7a8a7a857c37aa45cfa4f03d06d` (`service_id`),
  KEY `FK_1e0e063b48dbc0b269dfe01e39a` (`client_validator_id`),
  KEY `FK_9739fedd6f9b4d5e4cd63cd33e8` (`client_refuser_id`),
  KEY `FK_b82aba6cc1e6e60749a4a74a47e` (`admin_validator_id`),
  KEY `FK_e4d397edbc49b4782e193d83deb` (`admin_refuser_id`),
  CONSTRAINT `FK_0a557d2c8f73cd9b263f0279e5a` FOREIGN KEY (`collaborateur_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `FK_1e0e063b48dbc0b269dfe01e39a` FOREIGN KEY (`client_validator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `FK_7a8a7a857c37aa45cfa4f03d06d` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `FK_9739fedd6f9b4d5e4cd63cd33e8` FOREIGN KEY (`client_refuser_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `FK_b82aba6cc1e6e60749a4a74a47e` FOREIGN KEY (`admin_validator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `FK_e4d397edbc49b4782e193d83deb` FOREIGN KEY (`admin_refuser_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=63 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
