<?php
/**
 * InvestEasy — Authentication API
 * Handles: register, login, logout, session check, profile update, credit deduction
 *
 * GET  auth.php?action=me               → check current session
 * POST auth.php?action=register         → create account
 * POST auth.php?action=login            → sign in
 * POST auth.php?action=logout           → sign out
 * POST auth.php?action=update-profile   → update name/email/username
 * POST auth.php?action=change-password  → change password (logged-in user)
 * POST auth.php?action=reset-password   → reset password by email (forgot password)
 * POST auth.php?action=deduct-credits   → deduct FinBot credits (internal)
 */

// Buffer output so any PHP warnings/notices don't corrupt the JSON response
ob_start();

// Accept session ID from Authorization: Bearer header so cookie failures don't break auth
if (empty($_COOKIE[session_name()])) {
    $ah = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([a-zA-Z0-9,\-]+)$/i', $ah, $m)) {
        session_id($m[1]);
    }
}
session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { ob_end_clean(); http_response_code(204); exit; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok($data = [])       { ob_end_clean(); echo json_encode(['success' => true]  + $data); exit; }
function fail($code, $msg)    { http_response_code($code); ob_end_clean(); echo json_encode(['success' => false, 'error' => $msg]); exit; }
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
        id               INT AUTO_INCREMENT PRIMARY KEY,
        name             VARCHAR(100)  NOT NULL,
        email            VARCHAR(150)  NOT NULL,
        username         VARCHAR(50)   NOT NULL,
        password_hash    VARCHAR(255)  NOT NULL,
        age              TINYINT UNSIGNED NULL DEFAULT NULL,
        tier             ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free',
        finbot_credits   INT NOT NULL DEFAULT 0,
        credits_reset_at TIMESTAMP NULL DEFAULT NULL,
        created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_email    (email),
        UNIQUE KEY uq_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Add columns to existing tables that pre-date this schema
    try { $db->exec("ALTER TABLE users ADD COLUMN age TINYINT UNSIGNED NULL DEFAULT NULL"); } catch (Exception $e) {}
    try { $db->exec("ALTER TABLE users ADD COLUMN tier ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free'"); } catch (Exception $e) {}
    try { $db->exec("ALTER TABLE users ADD COLUMN finbot_credits INT NOT NULL DEFAULT 0"); } catch (Exception $e) {}
    try { $db->exec("ALTER TABLE users ADD COLUMN credits_reset_at TIMESTAMP NULL DEFAULT NULL"); } catch (Exception $e) {}

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

    $db->exec("CREATE TABLE IF NOT EXISTS saved_reports (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS user_progress (
        user_id    INT PRIMARY KEY,
        state      MEDIUMTEXT   NOT NULL,
        updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS price_alerts (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT              NOT NULL,
        ticker     VARCHAR(20)      NOT NULL,
        name       VARCHAR(100)     NOT NULL,
        target     DECIMAL(15,4)    NOT NULL,
        direction  ENUM('above','below') NOT NULL,
        triggered  TINYINT(1)       NOT NULL DEFAULT 0,
        created_at TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT         NOT NULL,
        token      VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP   NOT NULL,
        UNIQUE KEY uq_token (token),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ── Credit defaults per tier ──────────────────────────────────────────────────

function defaultCredits($tier) {
    return ['free' => 0, 'pro' => 50, 'enterprise' => 200][$tier] ?? 0;
}

// ── Monthly credit reset ──────────────────────────────────────────────────────
// If it has been ≥ 30 days since the last reset (or never reset), refill credits.

function resetCreditsIfNeeded($db, $uid) {
    $stmt = $db->prepare("SELECT tier, credits_reset_at FROM users WHERE id = ?");
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row || $row['tier'] === 'free') return;

    $now       = new DateTime();
    $resetAt   = $row['credits_reset_at'] ? new DateTime($row['credits_reset_at']) : null;
    $needReset = !$resetAt || ($now->diff($resetAt)->days >= 30);

    if ($needReset) {
        $credits = defaultCredits($row['tier']);
        $upd = $db->prepare("UPDATE users SET finbot_credits = ?, credits_reset_at = NOW() WHERE id = ?");
        $upd->execute([$credits, $uid]);
    }
}

// ── Sanitise username (strip leading @, lowercase) ───────────────────────────
function cleanUsername($u) { return strtolower(ltrim(trim($u), '@')); }

// ── Fetch full user row (with tier + credits) ─────────────────────────────────
function fetchUser($db, $id) {
    $s = $db->prepare("SELECT id, name, email, username, age, tier, finbot_credits, created_at FROM users WHERE id = ?");
    $s->execute([$id]);
    return $s->fetch();
}

// ── Route ────────────────────────────────────────────────────────────────────

$action = $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

try { switch ($action) {

    // ── me ───────────────────────────────────────────────────────────────────
    case 'me':
        $uid = currentUid();
        if (!$uid) fail(401, 'Not logged in');
        $db = getDB();
        resetCreditsIfNeeded($db, $uid);
        $u  = fetchUser($db, $uid);
        if (!$u) { session_destroy(); fail(401, 'Session expired'); }
        ok(['user' => $u, 'token' => session_id()]);
        break;

    // ── register ─────────────────────────────────────────────────────────────
    case 'register':
        initSchema();
        $name     = trim($body['name']     ?? '');
        $email    = strtolower(trim($body['email']    ?? ''));
        $username = cleanUsername($body['username'] ?? '');
        $password = $body['password'] ?? '';
        $age      = isset($body['age']) && $body['age'] !== '' ? (int)$body['age'] : null;

        if (!$name || !$email || !$username || !$password) fail(400, 'All fields are required.');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL))    fail(400, 'Please enter a valid email address.');
        if (strlen($password) < 6)                         fail(400, 'Password must be at least 6 characters.');
        if (!preg_match('/^[a-z0-9_]+$/', $username))      fail(400, 'Username can only contain letters, numbers and underscores.');
        if (strlen($username) < 3)                         fail(400, 'Username must be at least 3 characters.');
        if ($age !== null && ($age < 13 || $age > 120))    fail(400, 'Please enter a valid age (13–120).');

        $db = getDB();
        $chk = $db->prepare("SELECT id FROM users WHERE email = ? OR username = ?");
        $chk->execute([$email, $username]);
        if ($chk->fetch()) fail(409, 'That email or username is already taken.');

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $ins  = $db->prepare("INSERT INTO users (name, email, username, password_hash, age, tier, finbot_credits) VALUES (?, ?, ?, ?, ?, 'free', 0)");
        $ins->execute([$name, $email, $username, $hash, $age]);
        $uid = (int)$db->lastInsertId();

        // Create default settings row
        $db->prepare("INSERT IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$uid]);

        session_regenerate_id(true);
        $_SESSION['user_id'] = $uid;
        ok(['user' => fetchUser($db, $uid), 'token' => session_id()]);
        break;

    // ── login ────────────────────────────────────────────────────────────────
    case 'login':
        initSchema();
        $email    = strtolower(trim($body['email']    ?? ''));
        $password = $body['password'] ?? '';

        if (!$email || !$password) fail(400, 'Email and password are required.');

        $db   = getDB();
        $stmt = $db->prepare("SELECT id, password_hash FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $u = $stmt->fetch();

        if (!$u || !password_verify($password, $u['password_hash'])) {
            fail(401, 'Incorrect email or password.');
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$u['id'];
        resetCreditsIfNeeded($db, (int)$u['id']);
        ok(['user' => fetchUser($db, (int)$u['id']), 'token' => session_id()]);
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

        ok(['user' => fetchUser($db, $uid)]);
        break;

    // ── change-password (logged-in) ──────────────────────────────────────────
    case 'change-password':
        $uid = currentUid();
        if (!$uid) fail(401, 'Not logged in');

        $current  = $body['current_password'] ?? '';
        $newPass  = $body['new_password']     ?? '';
        $confirm  = $body['confirm_password'] ?? '';

        if (!$current || !$newPass || !$confirm) fail(400, 'All fields are required.');
        if (strlen($newPass) < 6)                fail(400, 'New password must be at least 6 characters.');
        if ($newPass !== $confirm)               fail(400, 'New passwords do not match.');

        $db   = getDB();
        $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
        $stmt->execute([$uid]);
        $u = $stmt->fetch();
        if (!$u || !password_verify($current, $u['password_hash'])) {
            fail(401, 'Current password is incorrect.');
        }

        $newHash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$newHash, $uid]);
        ok();
        break;

    // ── forgot-password — generate token and send reset email ────────────────
    case 'forgot-password':
        initSchema();
        $email = strtolower(trim($body['email'] ?? ''));
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Please enter a valid email address.');

        $db   = getDB();
        $stmt = $db->prepare("SELECT id, name FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $u = $stmt->fetch();

        // Always return success to prevent email enumeration
        if ($u) {
            // Remove any existing reset tokens for this user
            $db->prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")->execute([$u['id']]);

            // Generate a secure random token
            $token = bin2hex(random_bytes(32));
            $db->prepare("INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))")
               ->execute([$u['id'], $token]);

            // Build the reset URL
            $scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host     = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $dir      = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
            $resetUrl = "$scheme://$host$dir/reset-password.html?token=" . urlencode($token);

            // Send the email
            $name    = $u['name'];
            $subject = 'Reset your FinScope password';
            $body_text = "Hi $name,\r\n\r\n"
                . "You requested a password reset for your FinScope account.\r\n\r\n"
                . "Click the link below to set a new password (link expires in 1 hour):\r\n\r\n"
                . "$resetUrl\r\n\r\n"
                . "If you didn't request this, you can safely ignore this email — your password will not change.\r\n\r\n"
                . "— The FinScope Team";
            $headers = implode("\r\n", [
                'From: FinScope <noreply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . '>',
                'Content-Type: text/plain; charset=UTF-8',
                'X-Mailer: PHP/' . PHP_VERSION,
            ]);
            mail($email, $subject, $body_text, $headers);
        }

        ok(['message' => 'If that email is registered, a reset link has been sent.']);
        break;

    // ── reset-password — validate token and set new password ─────────────────
    case 'reset-password':
        initSchema();
        $token   = trim($body['token']           ?? '');
        $newPass = $body['new_password']          ?? '';
        $confirm = $body['confirm_password']      ?? '';

        if (!$token || !$newPass || !$confirm) fail(400, 'All fields are required.');
        if (strlen($newPass) < 6)  fail(400, 'Password must be at least 6 characters.');
        if ($newPass !== $confirm) fail(400, 'Passwords do not match.');

        $db   = getDB();
        $stmt = $db->prepare("SELECT user_id FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()");
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) fail(400, 'This reset link is invalid or has expired. Please request a new one.');

        $newHash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$newHash, $row['user_id']]);
        $db->prepare("DELETE FROM password_reset_tokens WHERE token = ?")->execute([$token]);
        ok();
        break;

    // ── deduct-credits ───────────────────────────────────────────────────────
    case 'deduct-credits':
        $uid = currentUid();
        if (!$uid) fail(401, 'Not logged in');

        $cost = (int)($body['cost'] ?? 0);
        if ($cost < 1 || $cost > 10) fail(400, 'Invalid credit cost.');

        $db = getDB();
        // Atomic check-and-deduct
        $stmt = $db->prepare("UPDATE users SET finbot_credits = finbot_credits - ? WHERE id = ? AND tier IN ('pro','enterprise') AND finbot_credits >= ?");
        $stmt->execute([$cost, $uid, $cost]);
        if ($stmt->rowCount() === 0) {
            // Check if it's a tier issue or credits issue
            $u = fetchUser($db, $uid);
            if (!$u) fail(401, 'Session expired');
            if ($u['tier'] === 'free') fail(403, 'FinBot requires a Pro or Enterprise plan.');
            fail(402, 'Insufficient credits. Please upgrade your plan or contact support.');
        }

        $u = fetchUser($db, $uid);
        ok(['finbot_credits' => (int)$u['finbot_credits']]);
        break;

    default:
        fail(400, 'Unknown action.');
} } catch (Throwable $e) { fail(500, 'Server error: ' . $e->getMessage()); }
