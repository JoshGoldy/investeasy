<?php
/**
 * InvestEasy Database Config — Docker / Local Dev
 *
 * Reads credentials from environment variables set in .env (via docker-compose).
 * For production (cPanel), use db.php from db.example.php instead.
 */

define('DB_HOST',    getenv('DB_HOST')    ?: 'localhost');
define('DB_NAME',    getenv('DB_NAME')    ?: '');
define('DB_USER',    getenv('DB_USER')    ?: '');
define('DB_PASS',    getenv('DB_PASS')    ?: '');
define('DB_CHARSET', getenv('DB_CHARSET') ?: 'utf8mb4');
define('DB_SSL_CA',  getenv('DB_SSL_CA')  ?: '');  // Path to SSL CA cert (Azure MySQL)

function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn  = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    if (DB_SSL_CA) {
        $opts[PDO::MYSQL_ATTR_SSL_CA]           = DB_SSL_CA;
        $opts[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
    }
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $opts);
    return $pdo;
}
