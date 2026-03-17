<?php
/**
 * Test DB — SQLite in-memory database that mirrors the production MySQL schema.
 * Used by the PHP test suite instead of db.php so no MySQL is needed.
 */

function getDB(): PDO {
    static $db = null;
    if ($db) return $db;

    $db = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    // SQLite doesn't have AUTO_INCREMENT — use AUTOINCREMENT
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT DEFAULT (datetime('now'))
    )");

    $db->exec("CREATE TABLE IF NOT EXISTS user_settings (
        user_id         INTEGER PRIMARY KEY,
        notifications   INTEGER DEFAULT 1,
        price_alerts    INTEGER DEFAULT 1,
        newsletter      INTEGER DEFAULT 0,
        currency        TEXT DEFAULT 'USD',
        hide_balances   INTEGER DEFAULT 0,
        compact_view    INTEGER DEFAULT 0,
        default_risk    TEXT DEFAULT 'Moderate',
        default_horizon TEXT DEFAULT '1–5 years',
        default_sectors TEXT DEFAULT 'Tech, Finance',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");

    $db->exec("CREATE TABLE IF NOT EXISTS portfolio (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id  INTEGER NOT NULL,
        ticker   TEXT NOT NULL,
        name     TEXT NOT NULL,
        shares   REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        UNIQUE(user_id, ticker),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");

    $db->exec("CREATE TABLE IF NOT EXISTS watchlist (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id  INTEGER NOT NULL,
        ticker   TEXT NOT NULL,
        name     TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, ticker),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");

    $db->exec("CREATE TABLE IF NOT EXISTS saved_reports (
        id           TEXT PRIMARY KEY,
        user_id      INTEGER NOT NULL,
        mode_id      TEXT NOT NULL,
        mode_title   TEXT NOT NULL,
        mode_sub     TEXT DEFAULT '',
        mode_col     TEXT DEFAULT '#10b981',
        mode_icon    TEXT DEFAULT '🤖',
        content      TEXT NOT NULL,
        article_link TEXT DEFAULT '',
        saved_at     INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");

    return $db;
}
