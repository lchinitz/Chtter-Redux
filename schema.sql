-- Chtter database schema
-- Exported from AWS RDS (MySQL 8) via DBeaver, 16 November 2026.
-- AUTO_INCREMENT counters removed so this creates clean, empty tables.
--
-- To recreate:  mysql -h <host> -u admin -p < schema.sql

CREATE DATABASE IF NOT EXISTS `chtter`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `chtter`;

CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `userName` varchar(100) NOT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `userName` (`userName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `contacts` (
  `contact_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `contact_type` enum('email','text','whatsapp') NOT NULL,   -- a new channel needs ALTER TABLE
  `contact_value` varchar(255) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '0',                    -- new contacts start OFF
  PRIMARY KEY (`contact_id`),
  UNIQUE KEY `unique_user_contact_type` (`user_id`,`contact_type`),   -- upsertContact relies on this
  CONSTRAINT `contacts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
