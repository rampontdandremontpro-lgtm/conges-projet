-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: spotify_db    Table: playlists
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `playlists`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `playlists` (
  `pid` int(11) NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `collaborative` tinyint(1) DEFAULT NULL,
  `modified_at` int(11) DEFAULT NULL,
  `num_tracks` int(11) DEFAULT NULL,
  `num_albums` int(11) DEFAULT NULL,
  `num_followers` int(11) DEFAULT NULL,
  `num_edits` int(11) DEFAULT NULL,
  `duration_ms` bigint(20) DEFAULT NULL,
  `num_artists` int(11) DEFAULT NULL,
  PRIMARY KEY (`pid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
