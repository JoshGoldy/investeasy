<?php
/**
 * InvestEasy FinBot API Proxy
 * 
 * This script proxies requests from the frontend to the Anthropic Claude API.
 * The API key stays server-side and is never exposed to the browser.
 * 
 * Upload this file to your public_html folder alongside index.html.
 * 
 * SETUP: Replace the API key below with your actual Anthropic API key.
 */

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
// Use '*' for testing, but restrict to your domain in production
define('ALLOWED_ORIGIN', '*');

// ── CORS HEADERS ───────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('X-Content-Type-Options: nosniff');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── ONLY ALLOW POST ────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed. Use POST.']);
    exit;
}

// ── SIMPLE RATE LIMITING (file-based, no Redis needed) ─────────────────────

function checkRateLimit($ip) {
    $rateFile = sys_get_temp_dir() . '/investeasy_rate_' . md5($ip) . '.json';
    $now = time();
    $window = 3600; // 1 hour
    
    $data = ['requests' => [], 'blocked_until' => 0];
    if (file_exists($rateFile)) {
        $raw = file_get_contents($rateFile);
        $data = json_decode($raw, true) ?: $data;
    }
    
    // Clean old entries
    $data['requests'] = array_filter($data['requests'], function($t) use ($now, $window) {
        return ($now - $t) < $window;
    });
    
    if (count($data['requests']) >= RATE_LIMIT) {
        return false;
    }
    
    $data['requests'][] = $now;
    file_put_contents($rateFile, json_encode($data), LOCK_EX);
    return true;
}

$clientIP = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (!checkRateLimit($clientIP)) {
    http_response_code(429);
    echo json_encode([
        'error' => 'Rate limit exceeded. You can make ' . RATE_LIMIT . ' requests per hour. Please try again later.'
    ]);
    exit;
}

// ── PARSE REQUEST ──────────────────────────────────────────────────────────

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);

if (!$input || empty($input['prompt'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing "prompt" field in request body.']);
    exit;
}

$prompt = trim($input['prompt']);

// Basic input validation
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

// ── CALL ANTHROPIC API ─────────────────────────────────────────────────────

$apiUrl = 'https://api.anthropic.com/v1/messages';

$payload = json_encode([
    'model' => MODEL,
    'max_tokens' => MAX_TOKENS,
    'messages' => [
        [
            'role' => 'user',
            'content' => $prompt
        ]
    ]
]);

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'x-api-key: ' . ANTHROPIC_API_KEY,
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_TIMEOUT => 120, // FinBot responses can take a while
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// ── HANDLE ERRORS ──────────────────────────────────────────────────────────

if ($curlError) {
    http_response_code(502);
    echo json_encode(['error' => 'Failed to reach AI service. Please try again. (' . $curlError . ')']);
    exit;
}

if ($httpCode !== 200) {
    $errorData = json_decode($response, true);
    $errorMsg = $errorData['error']['message'] ?? 'API returned status ' . $httpCode;
    
    // Don't expose internal API details to the client
    if ($httpCode === 401) {
        $errorMsg = 'API authentication failed. Please contact the site administrator.';
    } elseif ($httpCode === 429) {
        $errorMsg = 'AI service is busy. Please wait a moment and try again.';
    } elseif ($httpCode >= 500) {
        $errorMsg = 'AI service is temporarily unavailable. Please try again later.';
    }
    
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

// Extract text content
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

// Return clean response
echo json_encode([
    'success' => true,
    'text' => trim($text),
    'usage' => [
        'input_tokens' => $data['usage']['input_tokens'] ?? 0,
        'output_tokens' => $data['usage']['output_tokens'] ?? 0,
    ]
]);
