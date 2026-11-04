-- MySQLShell dump 2.0.1  Distrib Ver 8.4.10 for Win64 on x86_64 - for MySQL 8.4.10 (MySQL Community Server (GPL)), for Win64 (x86_64)
--
-- Host: localhost
-- ------------------------------------------------------
-- Server version	5.7.24
--
-- Dumping user accounts
--

-- begin user 'root'@'localhost'
CREATE USER IF NOT EXISTS 'root'@'localhost' IDENTIFIED WITH 'mysql_native_password' AS '*81F5E21E35407D884A6CD4A731AEBFB6AF209E1B' REQUIRE NONE PASSWORD EXPIRE DEFAULT ACCOUNT UNLOCK;
-- end user 'root'@'localhost'

-- begin grants 'root'@'localhost'
GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost' WITH GRANT OPTION;
GRANT PROXY ON ''@'' TO 'root'@'localhost' WITH GRANT OPTION;
-- end grants 'root'@'localhost'

-- End of dumping user accounts

