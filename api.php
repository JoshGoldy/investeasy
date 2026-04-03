<?php
/**
 * InvestEasy FinBot API Proxy
 *
 * Reads all secrets from environment variables — never hardcode keys here.
 * Set these in Azure App Service → Configuration → Application Settings:
 *   ANTHROPIC_API_KEY   your Anthropic API key
 *   FMP_API_KEY         Financial Modeling Prep key (optional)
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

define('ANTHROPIC_API_KEY', getenv('ANTHROPIC_API_KEY') ?: '');
define('FMP_API_KEY',       getenv('FMP_API_KEY')       ?: '');

// Rate limiting: max requests per IP per hour
define('RATE_LIMIT', 20);

// Claude model to use
define('MODEL', 'claude-sonnet-4-6');

// Max tokens per response
define('MAX_TOKENS', 4096);

// Allowed origins
define('ALLOWED_ORIGIN', getenv('ALLOWED_ORIGIN') ?: '*');

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

if (!ANTHROPIC_API_KEY) {
    http_response_code(503);
    echo json_encode(['error' => 'AI service is not configured. Please contact the site administrator.']);
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

// ── FMP HELPERS ────────────────────────────────────────────────────────────

function fmpGet($path) {
    $url = 'https://financialmodelingprep.com/api/v3' . $path . '&apikey=' . FMP_API_KEY;
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    if (!$body) return null;
    $data = json_decode($body, true);
    return (is_array($data) && !empty($data)) ? $data : null;
}

function resolveTicker($input) {
    $input = trim($input);
    if (preg_match('/\(([A-Z]{1,6})\)/', $input, $m)) return $m[1];
    if (preg_match('/^[A-Z]{1,6}$/', $input)) return $input;
    if (!FMP_API_KEY) return null;
    $results = fmpGet('/search?query=' . urlencode($input) . '&limit=1');
    return $results[0]['symbol'] ?? null;
}

function fetchEarningsContext($ticker) {
    if (!FMP_API_KEY || !$ticker) return null;

    $lines = ["## Live Market Data for {$ticker} (Financial Modeling Prep)\n"];

    $estimates = fmpGet("/analyst-estimates/{$ticker}?limit=2");
    if ($estimates) {
        $lines[] = "### Analyst Consensus Estimates\n";
        $lines[] = "| Period | Revenue Est | EPS Est (avg) | EPS High | EPS Low |";
        $lines[] = "|--------|------------|---------------|----------|---------|";
        foreach ($estimates as $e) {
            $rev = isset($e['estimatedRevenueAvg']) ? '$' . number_format($e['estimatedRevenueAvg'] / 1e9, 2) . 'B' : 'N/A';
            $eps = $e['estimatedEpsAverage'] ?? 'N/A';
            $hi  = $e['estimatedEpsHigh']    ?? 'N/A';
            $lo  = $e['estimatedEpsLow']     ?? 'N/A';
            $lines[] = "| {$e['date']} | {$rev} | \${$eps} | \${$hi} | \${$lo} |";
        }
        $lines[] = '';
    }

    $surprises = fmpGet("/historical/earning_surprises/{$ticker}");
    if ($surprises) {
        $lines[] = "### Historical Earnings Beat/Miss (Last 6 Quarters)\n";
        $lines[] = "| Date | EPS Estimate | EPS Actual | Surprise % |";
        $lines[] = "|------|-------------|------------|------------|";
        foreach (array_slice($surprises, 0, 6) as $s) {
            $act  = $s['actualEarningResult'] ?? null;
            $est  = $s['estimatedEarning']    ?? null;
            if ($act === null || $est === null) continue;
            $pct  = ($est != 0) ? round((($act - $est) / abs($est)) * 100, 1) : 0;
            $icon = ($act >= $est) ? '✅' : '❌';
            $lines[] = "| {$s['date']} | \${$est} | \${$act} | {$icon} {$pct}% |";
        }
        $lines[] = '';
    }

    $recs = fmpGet("/analyst-stock-recommendations/{$ticker}?limit=1");
    if ($recs && isset($recs[0])) {
        $r = $recs[0];
        $total = ($r['strongBuy'] ?? 0) + ($r['buy'] ?? 0) + ($r['hold'] ?? 0) + ($r['sell'] ?? 0) + ($r['strongSell'] ?? 0);
        if ($total > 0) {
            $lines[] = "### Analyst Recommendations ({$r['date']})\n";
            $lines[] = "- Strong Buy: **{$r['strongBuy']}** | Buy: **{$r['buy']}** | Hold: **{$r['hold']}** | Sell: **{$r['sell']}** | Strong Sell: **{$r['strongSell']}**";
            $lines[] = "- Total analysts: {$total}";
            $lines[] = '';
        }
    }

    if (count($lines) <= 1) return null;
    $lines[] = "*Source: Financial Modeling Prep — data as of request time.*\n";
    return implode("\n", $lines);
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

if (!$input || (empty($input['prompt']) && empty($input['user']))) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing "prompt" field in request body.']);
    exit;
}

$prompt      = trim($input['prompt'] ?? $input['user'] ?? '');
$clientSys   = trim($input['system'] ?? '');
$mode        = trim($input['mode']   ?? '');
$requestType = $input['request_type'] ?? 'finbot';
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

// ── BUILD SYSTEM PROMPT ────────────────────────────────────────────────────

$today        = date('l, j F Y');
$systemPrompt = $clientSys ?: 'You are FinBot, an expert financial analyst AI. Respond in clean Markdown with headers, bullet points, and tables where useful.';
$systemPrompt .= "\n\nToday's date is {$today}. When citing market data, analyst estimates, or any figures, note if they may be from your training data rather than live sources.";

if ($mode === 'earnings' && FMP_API_KEY) {
    $ticker = resolveTicker($prompt);
    if ($ticker) {
        $liveData = fetchEarningsContext($ticker);
        if ($liveData) {
            $systemPrompt .= "\n\nThe following live market data has been retrieved for **{$ticker}**. Use it as the primary source — it is more accurate than your training data:\n\n" . $liveData;
        }
    }
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
    'system'     => $systemPrompt,
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
    if (isset($db) && $uid && isset($user) && $user) {
        $db->prepare("UPDATE users SET finbot_credits = finbot_credits + ? WHERE id = ?")->execute([$creditCost, $uid]);
        $creditsRemaining = (int)($user['finbot_credits']);
    }

    if ($curlError) {
        http_response_code(502);
        echo json_encode(['error' => 'Failed to reach AI service. Please try again. (' . $curlError . ')']);
        exit;
    }

    $errorData = json_decode($response, true);
    $errorMsg  = $errorData['error']['message'] ?? 'API returned status ' . $httpCode;
    if ($httpCode === 401)     $errorMsg = 'API authentication failed. Please contact the site administrator.';
    elseif ($httpCode === 429) $errorMsg = 'AI service is busy. Please wait a moment and try again.';
    elseif ($httpCode >= 500)  $errorMsg = 'AI service is temporarily unavailable. Please try again later.';

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
