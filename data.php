<?php
/**
 * InvestEasy — Data API
 * Handles: settings, portfolio, watchlist, saved_reports CRUD (all require authentication)
 *
 * GET  data.php?action=settings             → load settings
 * POST data.php?action=settings             → save settings (partial update ok)
 * GET  data.php?action=portfolio            → load portfolio holdings
 * POST data.php?action=portfolio            → add / update a holding
 * DELETE data.php?action=portfolio          → remove a holding  { ticker }
 * GET  data.php?action=watchlist            → load watchlist
 * POST data.php?action=watchlist            → add to watchlist  { ticker, name }
 * DELETE data.php?action=watchlist          → remove from watchlist  { ticker }
 * GET  data.php?action=saved_reports        → load all saved reports for user
 * POST data.php?action=saved_reports        → save a report  { id, modeId, modeTitle, ... }
 * DELETE data.php?action=saved_reports      → delete a report  { id }
 */

session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok($data = [])    { echo json_encode(['success' => true] + $data); exit; }
function fail($code, $msg) { http_response_code($code); echo json_encode(['success' => false, 'error' => $msg]); exit; }

function requireAuth() {
    if (empty($_SESSION['user_id'])) fail(401, 'Not logged in');
    return (int)$_SESSION['user_id'];
}

// ── DB check ─────────────────────────────────────────────────────────────────

if (!file_exists(__DIR__ . '/db.php')) fail(503, 'Database not configured.');
require_once __DIR__ . '/db.php';

// ── Route ────────────────────────────────────────────────────────────────────

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

switch ($action) {

    // ── SETTINGS ─────────────────────────────────────────────────────────────
    case 'settings':
        $uid = requireAuth();
        $db  = getDB();

        if ($method === 'GET') {
            $stmt = $db->prepare("SELECT * FROM user_settings WHERE user_id = ?");
            $stmt->execute([$uid]);
            $s = $stmt->fetch();

            if (!$s) {
                // Create defaults row if missing
                $db->prepare("INSERT IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$uid]);
                $stmt->execute([$uid]);
                $s = $stmt->fetch();
            }

            // Cast booleans
            foreach (['notifications','price_alerts','newsletter','hide_balances','compact_view'] as $k) {
                $s[$k] = (bool)$s[$k];
            }
            unset($s['user_id']);
            ok(['settings' => $s]);

        } else { // POST — partial update
            $allowed = ['notifications','price_alerts','newsletter','currency',
                        'hide_balances','compact_view','default_risk','default_horizon','default_sectors'];
            $sets = []; $vals = [];
            foreach ($allowed as $k) {
                if (array_key_exists($k, $body)) { $sets[] = "$k = ?"; $vals[] = $body[$k]; }
            }
            if (!$sets) fail(400, 'Nothing to update.');
            $vals[] = $uid;
            $db->prepare("UPDATE user_settings SET " . implode(', ', $sets) . " WHERE user_id = ?")
               ->execute($vals);
            ok();
        }
        break;

    // ── PORTFOLIO ─────────────────────────────────────────────────────────────
    case 'portfolio':
        $uid = requireAuth();
        $db  = getDB();

        if ($method === 'GET') {
            $stmt = $db->prepare("SELECT ticker, name, shares, avg_cost FROM portfolio WHERE user_id = ? ORDER BY ticker");
            $stmt->execute([$uid]);
            $rows = $stmt->fetchAll();
            // Cast numeric types
            foreach ($rows as &$r) {
                $r['shares']   = (float)$r['shares'];
                $r['avg_cost'] = (float)$r['avg_cost'];
            }
            ok(['portfolio' => $rows]);

        } elseif ($method === 'POST') {
            $ticker  = strtoupper(trim($body['ticker']   ?? ''));
            $name    = trim($body['name']     ?? $ticker);
            $shares  = (float)($body['shares']   ?? 0);
            $avgCost = (float)($body['avg_cost'] ?? 0);

            if (!$ticker)    fail(400, 'Ticker is required.');
            if ($shares <= 0) fail(400, 'Shares must be greater than 0.');
            if ($avgCost < 0) fail(400, 'Average cost cannot be negative.');

            $db->prepare(
                "INSERT INTO portfolio (user_id, ticker, name, shares, avg_cost) VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), shares = VALUES(shares), avg_cost = VALUES(avg_cost)"
            )->execute([$uid, $ticker, $name, $shares, $avgCost]);
            ok();

        } elseif ($method === 'DELETE') {
            $ticker = strtoupper(trim($body['ticker'] ?? $_GET['ticker'] ?? ''));
            if (!$ticker) fail(400, 'Ticker is required.');
            $db->prepare("DELETE FROM portfolio WHERE user_id = ? AND ticker = ?")->execute([$uid, $ticker]);
            ok();
        }
        break;

    // ── WATCHLIST ─────────────────────────────────────────────────────────────
    case 'watchlist':
        $uid = requireAuth();
        $db  = getDB();

        if ($method === 'GET') {
            $stmt = $db->prepare("SELECT ticker, name FROM watchlist WHERE user_id = ? ORDER BY added_at DESC");
            $stmt->execute([$uid]);
            ok(['watchlist' => $stmt->fetchAll()]);

        } elseif ($method === 'POST') {
            $ticker = strtoupper(trim($body['ticker'] ?? ''));
            $name   = trim($body['name'] ?? $ticker);
            if (!$ticker) fail(400, 'Ticker is required.');
            $db->prepare("INSERT IGNORE INTO watchlist (user_id, ticker, name) VALUES (?, ?, ?)")
               ->execute([$uid, $ticker, $name]);
            ok();

        } elseif ($method === 'DELETE') {
            $ticker = strtoupper(trim($body['ticker'] ?? $_GET['ticker'] ?? ''));
            if (!$ticker) fail(400, 'Ticker is required.');
            $db->prepare("DELETE FROM watchlist WHERE user_id = ? AND ticker = ?")->execute([$uid, $ticker]);
            ok();
        }
        break;

    // ── SAVED REPORTS ─────────────────────────────────────────────────────────
    case 'saved_reports':
        $uid = requireAuth();
        $db  = getDB();

        if ($method === 'GET') {
            $stmt = $db->prepare("SELECT * FROM saved_reports WHERE user_id = ? ORDER BY saved_at DESC");
            $stmt->execute([$uid]);
            $rows = $stmt->fetchAll();
            // Rename snake_case to camelCase for the frontend
            $reports = array_map(function($r) {
                return [
                    'id'          => $r['id'],
                    'modeId'      => $r['mode_id'],
                    'modeTitle'   => $r['mode_title'],
                    'modeSub'     => $r['mode_sub'],
                    'modeCol'     => $r['mode_col'],
                    'modeIcon'    => $r['mode_icon'],
                    'content'     => $r['content'],
                    'articleLink' => $r['article_link'],
                    'savedAt'     => (int)$r['saved_at'],
                ];
            }, $rows);
            ok(['reports' => $reports]);

        } elseif ($method === 'POST') {
            $id          = trim($body['id']          ?? '');
            $modeId      = trim($body['modeId']      ?? '');
            $modeTitle   = mb_substr(trim($body['modeTitle']   ?? ''), 0, 255);
            $modeSub     = mb_substr(trim($body['modeSub']     ?? ''), 0, 100);
            $modeCol     = mb_substr(trim($body['modeCol']     ?? '#10b981'), 0, 20);
            $modeIcon    = mb_substr(trim($body['modeIcon']    ?? '🤖'), 0, 10);
            $content     = $body['content']     ?? '';
            $articleLink = mb_substr(trim($body['articleLink'] ?? ''), 0, 500);
            $savedAt     = (int)($body['savedAt'] ?? (time() * 1000));

            if (!$id || !$modeId || !$content) fail(400, 'Missing required fields.');

            $db->prepare(
                "INSERT IGNORE INTO saved_reports
                 (id, user_id, mode_id, mode_title, mode_sub, mode_col, mode_icon, content, article_link, saved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )->execute([$id, $uid, $modeId, $modeTitle, $modeSub, $modeCol, $modeIcon, $content, $articleLink, $savedAt]);
            ok();

        } elseif ($method === 'DELETE') {
            $id = trim($body['id'] ?? $_GET['id'] ?? '');
            if (!$id) fail(400, 'Report id is required.');
            $db->prepare("DELETE FROM saved_reports WHERE id = ? AND user_id = ?")->execute([$id, $uid]);
            ok();
        }
        break;

    default:
        fail(400, 'Unknown action.');
}
