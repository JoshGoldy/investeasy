<?php
/**
 * InvestEasy Database Config — EXAMPLE
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  SETUP INSTRUCTIONS:                                        │
 * │  1. In cPanel → MySQL Databases:                           │
 * │     a. Create a database  (e.g. investeasy)                │
 * │     b. Create a DB user with a strong password             │
 * │     c. Add user to database — grant ALL PRIVILEGES         │
 * │  2. Copy this file → rename to db.php                      │
 * │  3. Fill in your credentials below                         │
 * │  4. Upload db.php to your server (NEVER commit to git)     │
 * └─────────────────────────────────────────────────────────────┘
 *
 * NOTE: cPanel prefixes DB names and usernames with your cPanel
 * account name automatically. For example if your cPanel username
 * is "john" and you name the DB "investeasy", the full DB name
 * will be "john_investeasy". Same for the DB user.
 */

define('DB_HOST',    'localhost');
define('DB_NAME',    'cpanelusername_investeasy');  // e.g. john_investeasy
define('DB_USER',    'cpanelusername_dbuser');      // e.g. john_ieuser
define('DB_PASS',    'your_strong_password_here');
define('DB_CHARSET', 'utf8mb4');

function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn  = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $opts);
    return $pdo;
}
