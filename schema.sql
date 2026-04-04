-- InvestEasy — Manual Database Schema
-- Run this against your MySQL database to set up all required tables.
-- Safe to re-run: all statements use CREATE TABLE IF NOT EXISTS.
--
-- For Azure MySQL Flexible Server:
--   mysql -h <server>.mysql.database.azure.com -u <admin> -p <dbname> < schema.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(100)        NOT NULL,
    email            VARCHAR(150)        NOT NULL,
    username         VARCHAR(50)         NOT NULL,
    password_hash    VARCHAR(255)        NOT NULL,
    age              TINYINT UNSIGNED    NULL DEFAULT NULL,
    tier             ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free',
    finbot_credits   INT                 NOT NULL DEFAULT 0,
    credits_reset_at TIMESTAMP           NULL DEFAULT NULL,
    created_at       TIMESTAMP           DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_email    (email),
    UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    user_id          INT          PRIMARY KEY,
    notifications    TINYINT(1)   DEFAULT 1,
    price_alerts     TINYINT(1)   DEFAULT 1,
    newsletter       TINYINT(1)   DEFAULT 0,
    currency         VARCHAR(10)  DEFAULT 'USD',
    hide_balances    TINYINT(1)   DEFAULT 0,
    compact_view     TINYINT(1)   DEFAULT 0,
    default_risk     VARCHAR(20)  DEFAULT 'Moderate',
    default_horizon  VARCHAR(30)  DEFAULT '1–5 years',
    default_sectors  VARCHAR(200) DEFAULT 'Tech, Finance',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- portfolio
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    user_id   INT           NOT NULL,
    ticker    VARCHAR(20)   NOT NULL,
    name      VARCHAR(100)  NOT NULL,
    shares    DECIMAL(12,4) NOT NULL DEFAULT 0,
    avg_cost  DECIMAL(12,2) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_user_ticker (user_id, ticker),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- watchlist
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    user_id   INT          NOT NULL,
    ticker    VARCHAR(20)  NOT NULL,
    name      VARCHAR(100) NOT NULL,
    added_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_ticker (user_id, ticker),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- saved_reports
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_reports (
    id           VARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id      INT          NOT NULL,
    mode_id      VARCHAR(50)  NOT NULL,
    mode_title   VARCHAR(255) NOT NULL DEFAULT '',
    mode_sub     VARCHAR(100) NOT NULL DEFAULT '',
    mode_col     VARCHAR(20)  NOT NULL DEFAULT '#10b981',
    mode_icon    VARCHAR(10)  NOT NULL DEFAULT '',
    content      MEDIUMTEXT   NOT NULL,
    article_link VARCHAR(500) NOT NULL DEFAULT '',
    saved_at     BIGINT       NOT NULL DEFAULT 0,
    tags         TEXT         NULL,
    folder       TEXT         NULL,
    starred      TINYINT(1)   NOT NULL DEFAULT 0,
    note         TEXT         NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- price_alerts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alerts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT              NOT NULL,
    ticker     VARCHAR(20)      NOT NULL,
    name       VARCHAR(100)     NOT NULL,
    target     DECIMAL(15,4)    NOT NULL,
    direction  ENUM('above','below') NOT NULL,
    triggered  TINYINT(1)       NOT NULL DEFAULT 0,
    created_at TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_progress
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_progress (
    user_id    INT        PRIMARY KEY,
    state      MEDIUMTEXT NOT NULL,
    updated_at TIMESTAMP  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- password_reset_tokens
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT         NOT NULL,
    token      VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP   NOT NULL,
    UNIQUE KEY uq_token (token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
