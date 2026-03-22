<?php
/**
 * InvestEasy FinBot API Proxy
 *
 * This script proxies requests from the frontend to the Anthropic Claude API.
 * The API key stays server-side and is never exposed to the browser.
 *
 * SETUP: Replace the API key below with your actual Anthropic API key.
 *
 * request_type: 'finbot'  → costs 2 credits  (Pro/Enterprise only)
 * request_type: 'news'    → costs 1 credit   (Pro/Enterprise only)
 */

// Accept session ID from Authorization: Bearer header so cookie failures don't break auth
if (empty($_COOKIE[session_name()])) {
    $ah = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([a-zA-Z0-9\-]+)$/i', $ah, $m)) {
        session_id($m[1]);
    }
}
session_start();

// ── CONFIGURATION ──────────────────────────────────────────────────────────

// ⚠️  REPLACE THIS WITH YOUR ACTUAL ANTHROPIC API KEY
define('ANTHROPIC_API_KEY', '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');

// Rate limiting: max requests per IP per hour (adjust as needed)
define('RATE_LIMIT', 20);

// Claude model to use
define('MODEL', 'claude-sonnet-4-20250514');

// Max tokens per response
define('MAX_TOKENS', 4096);

// Allowed origins (add your domain here for production)
define('ALLOWED_ORIGIN', '*');

// Credit costs per request type
define('CREDIT_COST_FINBOT', 5);
define('CREDIT_COST_NEWS',   2);

// ── CORS HEADERS ───────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed. Use POST.']);
    exit;
}

// ── DB + AUTH CHECK ────────────────────────────────────────────────────────

$uid = $_SESSION['user_id'] ?? null;

if (file_exists(__DIR__ . '/db.php')) {
    require_once __DIR__ . '/db.php';

    if (!$uid) {
        http_response_code(401);
        echo json_encode(['error' => 'You must be signed in to use FinBot.', 'code' => 'not_logged_in']);
        exit;
    }

    try {
        $db   = getDB();
        $stmt = $db->prepare("SELECT tier, finbot_credits FROM users WHERE id = ?");
        $stmt->execute([$uid]);
        $user = $stmt->fetch();

        if (!$user) {
            http_response_code(401);
            echo json_encode(['error' => 'Session expired. Please sign in again.', 'code' => 'session_expired']);
            exit;
        }

        if ($user['tier'] === 'free') {
            http_response_code(403);
            echo json_encode(['error' => 'FinBot is available on Pro and Enterprise plans. Upgrade to unlock AI analysis.', 'code' => 'upgrade_required']);
            exit;
        }

        if ((int)$user['finbot_credits'] <= 0) {
            http_response_code(402);
            echo json_encode(['error' => 'You have run out of FinBot credits. Contact support to top up.', 'code' => 'no_credits']);
            exit;
        }
    } catch (Exception $e) {
        // DB unavailable — fall through to allow usage (demo/dev mode)
        $user = null;
    }
} else {
    // No db.php — running in demo mode, skip checks
    $user = null;
}

// ── RATE LIMITING ──────────────────────────────────────────────────────────

function checkRateLimit($ip) {
    $rateFile = sys_get_temp_dir() . '/investeasy_rate_' . md5($ip) . '.json';
    $now = time();
    $window = 3600;
    $data = ['requests' => []];
    if (file_exists($rateFile)) {
        $raw = file_get_contents($rateFile);
        $data = json_decode($raw, true) ?: $data;
    }
    $data['requests'] = array_filter($data['requests'], fn($t) => ($now - $t) < $window);
    if (count($data['requests']) >= RATE_LIMIT) return false;
    $data['requests'][] = $now;
    file_put_contents($rateFile, json_encode($data), LOCK_EX);
    return true;
}

$clientIP = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (!checkRateLimit($clientIP)) {
    http_response_code(429);
    echo json_encode(['error' => 'Rate limit exceeded. You can make ' . RATE_LIMIT . ' requests per hour.']);
    exit;
}

// ── PARSE REQUEST ──────────────────────────────────────────────────────────

$rawInput = file_get_contents('php://input');
$input    = json_decode($rawInput, true);

if (!$input || empty($input['prompt'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing "prompt" field in request body.']);
    exit;
}

$prompt      = trim($input['prompt']);
$requestType = $input['request_type'] ?? 'finbot'; // 'finbot' | 'news'
$creditCost  = ($requestType === 'news') ? CREDIT_COST_NEWS : CREDIT_COST_FINBOT;

if (strlen($prompt) < 10) {
    http_response_code(400);
    echo json_encode(['error' => 'Prompt is too short.']);
    exit;
}
if (strlen($prompt) > 10000) {
    http_response_code(400);
    echo json_encode(['error' => 'Prompt is too long. Maximum 10,000 characters.']);
    exit;
}

// ── DEDUCT CREDITS BEFORE CALLING API ─────────────────────────────────────

$creditsRemaining = null;
if (isset($db) && $uid && isset($user) && $user) {
    $upd = $db->prepare("UPDATE users SET finbot_credits = finbot_credits - ? WHERE id = ? AND finbot_credits >= ?");
    $upd->execute([$creditCost, $uid, $creditCost]);
    if ($upd->rowCount() === 0) {
        http_response_code(402);
        echo json_encode(['error' => 'You have run out of FinBot credits.', 'code' => 'no_credits']);
        exit;
    }
    $row = $db->prepare("SELECT finbot_credits FROM users WHERE id = ?");
    $row->execute([$uid]);
    $creditsRemaining = (int)($row->fetchColumn() ?? 0);
}

// ── CALL ANTHROPIC API ─────────────────────────────────────────────────────

$apiUrl  = 'https://api.anthropic.com/v1/messages';
$payload = json_encode([
    'model'      => MODEL,
    'max_tokens' => MAX_TOKENS,
    'messages'   => [['role' => 'user', 'content' => $prompt]],
]);

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'x-api-key: ' . ANTHROPIC_API_KEY,
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// ── HANDLE ERRORS (refund credits on failure) ──────────────────────────────

if ($curlError || $httpCode !== 200) {
    // Refund credits since the call failed
    if (isset($db) && $uid && isset($user) && $user) {
        $db->prepare("UPDATE users SET finbot_credits = finbot_credits + ? WHERE id = ?")->execute([$creditCost, $uid]);
        $creditsRemaining = (int)($user['finbot_credits']); // restore pre-call value
    }

    if ($curlError) {
        http_response_code(502);
        echo json_encode(['error' => 'Failed to reach AI service. Please try again. (' . $curlError . ')']);
        exit;
    }

    $errorData = json_decode($response, true);
    $errorMsg  = $errorData['error']['message'] ?? 'API returned status ' . $httpCode;
    if ($httpCode === 401)       $errorMsg = 'API authentication failed. Please contact the site administrator.';
    elseif ($httpCode === 429)   $errorMsg = 'AI service is busy. Please wait a moment and try again.';
    elseif ($httpCode >= 500)    $errorMsg = 'AI service is temporarily unavailable. Please try again later.';

    http_response_code($httpCode >= 500 ? 502 : $httpCode);
    echo json_encode(['error' => $errorMsg]);
    exit;
}

// ── PARSE & RETURN RESPONSE ────────────────────────────────────────────────

$data = json_decode($response, true);

if (!$data || !isset($data['content'])) {
    http_response_code(502);
    echo json_encode(['error' => 'Invalid response from AI service.']);
    exit;
}

$text = '';
foreach ($data['content'] as $block) {
    if (isset($block['type']) && $block['type'] === 'text') {
        $text .= $block['text'];
    }
}

if (empty(trim($text))) {
    http_response_code(502);
    echo json_encode(['error' => 'Empty response from AI service. Please try again.']);
    exit;
}

$resp = [
    'success' => true,
    'text'    => trim($text),
    'usage'   => [
        'input_tokens'  => $data['usage']['input_tokens']  ?? 0,
        'output_tokens' => $data['usage']['output_tokens'] ?? 0,
    ],
];
if ($creditsRemaining !== null) {
    $resp['credits_remaining'] = $creditsRemaining;
    $resp['credits_used']      = $creditCost;
}

echo json_encode($resp);
