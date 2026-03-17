<?php
/**
 * InvestEasy — Authentication API
 * Handles: register, login, logout, session check, profile update
 *
 * GET  auth.php?action=me               → check current session
 * POST auth.php?action=register         → create account
 * POST auth.php?action=login            → sign in
 * POST auth.php?action=logout           → sign out
 * POST auth.php?action=update-profile   → update name/email/username
 */

session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok($data = [])       { echo json_encode(['success' => true]  + $data); exit; }
function fail($code, $msg)    { http_response_code($code); echo json_encode(['success' => false, 'error' => $msg]); exit; }
function currentUid()         { return $_SESSION['user_id'] ?? null; }

// ── DB check ─────────────────────────────────────────────────────────────────

if (!file_exists(__DIR__ . '/db.php')) {
    fail(503, 'Database not configured. Copy db.example.php to db.php and fill in your credentials.');
}
require_once __DIR__ . '/db.php';

// Test DB connection early so we get a useful error instead of a 500
try {
    getDB();
} catch (Exception $e) {
    fail(503, 'Database connection failed: ' . $e->getMessage());
}

// ── Schema init (idempotent) ──────────────────────────────────────────────────

function initSchema() {
    $db = getDB();
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        name         VARCHAR(100)  NOT NULL,
        email        VARCHAR(150)  NOT NULL,
        username     VARCHAR(50)   NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_email    (email),
        UNIQUE KEY uq_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS user_settings (
        user_id         INT PRIMARY KEY,
        notifications   TINYINT(1)   DEFAULT 1,
        price_alerts    TINYINT(1)   DEFAULT 1,
        newsletter      TINYINT(1)   DEFAULT 0,
        currency        VARCHAR(10)  DEFAULT 'USD',
        hide_balances   TINYINT(1)   DEFAULT 0,
        compact_view    TINYINT(1)   DEFAULT 0,
        default_risk    VARCHAR(20)  DEFAULT 'Moderate',
        default_horizon VARCHAR(30)  DEFAULT '1–5 years',
        default_sectors VARCHAR(200) DEFAULT 'Tech, Finance',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS portfolio (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        user_id   INT            NOT NULL,
        ticker    VARCHAR(20)    NOT NULL,
        name      VARCHAR(100)   NOT NULL,
        shares    DECIMAL(12,4)  NOT NULL DEFAULT 0,
        avg_cost  DECIMAL(12,2)  NOT NULL DEFAULT 0,
        UNIQUE KEY uq_user_ticker (user_id, ticker),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS watchlist (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        user_id   INT          NOT NULL,
        ticker    VARCHAR(20)  NOT NULL,
        name      VARCHAR(100) NOT NULL,
        added_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_ticker (user_id, ticker),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS user_progress (
        user_id    INT PRIMARY KEY,
        state      MEDIUMTEXT   NOT NULL,
        updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ── Sanitise username (strip leading @, lowercase) ───────────────────────────
function cleanUsername($u) { return strtolower(ltrim(trim($u), '@')); }

// ── Route ────────────────────────────────────────────────────────────────────

$action = $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

switch ($action) {

    // ── me ───────────────────────────────────────────────────────────────────
    case 'me':
        $uid = currentUid();
        if (!$uid) fail(401, 'Not logged in');
        $db   = getDB();
        $stmt = $db->prepare("SELECT id, name, email, username, created_at FROM users WHERE id = ?");
        $stmt->execute([$uid]);
        $u = $stmt->fetch();
        if (!$u) { session_destroy(); fail(401, 'Session expired'); }
        ok(['user' => $u]);
        break;

    // ── register ─────────────────────────────────────────────────────────────
    case 'register':
        initSchema();
        $name     = trim($body['name']     ?? '');
        $email    = strtolower(trim($body['email']    ?? ''));
        $username = cleanUsername($body['username'] ?? '');
        $password = $body['password'] ?? '';

        if (!$name || !$email || !$username || !$password) fail(400, 'All fields are required.');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL))    fail(400, 'Please enter a valid email address.');
        if (strlen($password) < 6)                         fail(400, 'Password must be at least 6 characters.');
        if (!preg_match('/^[a-z0-9_]+$/', $username))      fail(400, 'Username can only contain letters, numbers and underscores.');
        if (strlen($username) < 3)                         fail(400, 'Username must be at least 3 characters.');

        $db = getDB();
        $chk = $db->prepare("SELECT id FROM users WHERE email = ? OR username = ?");
        $chk->execute([$email, $username]);
        if ($chk->fetch()) fail(409, 'That email or username is already taken.');

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $ins  = $db->prepare("INSERT INTO users (name, email, username, password_hash) VALUES (?, ?, ?, ?)");
        $ins->execute([$name, $email, $username, $hash]);
        $uid = (int)$db->lastInsertId();

        // Create default settings row
        $db->prepare("INSERT IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$uid]);

        session_regenerate_id(true);
        $_SESSION['user_id'] = $uid;
        ok(['user' => ['id' => $uid, 'name' => $name, 'email' => $email, 'username' => $username]]);
        break;

    // ── login ────────────────────────────────────────────────────────────────
    case 'login':
        initSchema();
        $email    = strtolower(trim($body['email']    ?? ''));
        $password = $body['password'] ?? '';

        if (!$email || !$password) fail(400, 'Email and password are required.');

        $db   = getDB();
        $stmt = $db->prepare("SELECT id, name, email, username, password_hash FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $u = $stmt->fetch();

        if (!$u || !password_verify($password, $u['password_hash'])) {
            fail(401, 'Incorrect email or password.');
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$u['id'];
        ok(['user' => ['id' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'username' => $u['username']]]);
        break;

    // ── logout ───────────────────────────────────────────────────────────────
    case 'logout':
        session_destroy();
        ok();
        break;

    // ── update-profile ───────────────────────────────────────────────────────
    case 'update-profile':
        $uid = currentUid();
        if (!$uid) fail(401, 'Not logged in');

        $name     = trim($body['name']     ?? '');
        $email    = strtolower(trim($body['email']    ?? ''));
        $username = cleanUsername($body['username'] ?? '');

        if (!$name || !$email || !$username) fail(400, 'All fields are required.');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Invalid email address.');

        $db  = getDB();
        $chk = $db->prepare("SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?");
        $chk->execute([$email, $username, $uid]);
        if ($chk->fetch()) fail(409, 'That email or username is already taken.');

        $db->prepare("UPDATE users SET name = ?, email = ?, username = ? WHERE id = ?")
           ->execute([$name, $email, $username, $uid]);

        ok(['user' => ['id' => $uid, 'name' => $name, 'email' => $email, 'username' => $username]]);
        break;

    default:
        fail(400, 'Unknown action.');
}
