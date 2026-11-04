-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost    Database: spotify_db    Table: playliststracks
-- ------------------------------------------------------
-- Server version	5.7.24

--
-- Table structure for table `playliststracks`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `playliststracks` (
  `pid` int(11) NOT NULL,
  `track_uri` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pos` int(11) DEFAULT NULL,
  PRIMARY KEY (`pid`,`track_uri`),
  KEY `track_uri` (`track_uri`),
  CONSTRAINT `playliststracks_ibfk_1` FOREIGN KEY (`pid`) REFERENCES `playlists` (`pid`),
  CONSTRAINT `playliststracks_ibfk_2` FOREIGN KEY (`track_uri`) REFERENCES `tracks` (`track_uri`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
