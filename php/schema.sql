-- MENTOR team=0 explicitly grants review access to all groups; it does not grant coordinator administration.
CREATE TABLE IF NOT EXISTS gecc_app_state (
 id TINYINT UNSIGNED PRIMARY KEY CHECK(id=1),
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 document LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(document)),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_accounts (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 username VARCHAR(80) COLLATE utf8mb4_bin NOT NULL UNIQUE,
 name VARCHAR(200) NOT NULL, password_hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
 role ENUM('mentee','mentor','coord') NOT NULL, unit_id VARCHAR(160) CHARACTER SET ascii,
 team INT, active BOOLEAN NOT NULL DEFAULT TRUE, must_change BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CHECK((role='mentee' AND unit_id IS NOT NULL) OR (role='mentor' AND team IS NOT NULL) OR role='coord')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 csrf CHAR(64) CHARACTER SET ascii NOT NULL, expires_at DATETIME(3) NOT NULL,
 FOREIGN KEY(account_id) REFERENCES gecc_accounts(id), INDEX(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_files (
 id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 unit_id VARCHAR(160) CHARACTER SET ascii NOT NULL,
 account_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(200) NOT NULL, mime VARCHAR(100) CHARACTER SET ascii NOT NULL,
 size INT UNSIGNED NOT NULL CHECK(size>0), digest CHAR(64) CHARACTER SET ascii NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(account_id) REFERENCES gecc_accounts(id), INDEX(unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_audit (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
 action VARCHAR(80) NOT NULL, resource VARCHAR(160) NOT NULL, revision BIGINT UNSIGNED,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(account_id) REFERENCES gecc_accounts(id), INDEX(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_login_attempts (
 key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL, reset_at BIGINT UNSIGNED NOT NULL, INDEX(reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gecc_schema_version (
 version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
