-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: spotify_db    Table: tracks
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `tracks`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `tracks` (
  `track_uri` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `track_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `duration_ms` bigint(20) DEFAULT NULL,
  `album_uri` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `artist_uri` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`track_uri`),
  KEY `album_uri` (`album_uri`),
  KEY `artist_uri` (`artist_uri`),
  CONSTRAINT `tracks_ibfk_1` FOREIGN KEY (`album_uri`) REFERENCES `albums` (`album_uri`),
  CONSTRAINT `tracks_ibfk_2` FOREIGN KEY (`artist_uri`) REFERENCES `artists` (`artist_uri`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
