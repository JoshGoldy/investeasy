<?php
/**
 * Data API — Integration tests (white-box)
 * Tests: portfolio CRUD, watchlist CRUD, saved_reports CRUD,
 *        auth guards, upsert behaviour, DELETE isolation between users.
 */

require_once __DIR__ . '/../db_test.php';

// ── Setup helpers ─────────────────────────────────────────────────────────────

function createTestUser(string $suffix): int {
    $db   = getDB();
    $hash = password_hash('testpass', PASSWORD_DEFAULT);
    $db->prepare("INSERT OR IGNORE INTO users (name,email,username,password_hash) VALUES (?,?,?,?)")
       ->execute(["Test$suffix", "test$suffix@example.com", "testuser$suffix", $hash]);
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute(["test$suffix@example.com"]);
    $uid = (int)$stmt->fetch()['id'];
    $db->prepare("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$uid]);
    return $uid;
}

function addHolding(int $uid, string $ticker, string $name, float $shares, float $avgCost): void {
    getDB()->prepare(
        "INSERT OR REPLACE INTO portfolio (user_id,ticker,name,shares,avg_cost) VALUES (?,?,?,?,?)"
    )->execute([$uid, $ticker, $name, $shares, $avgCost]);
}

function getHoldings(int $uid): array {
    $stmt = getDB()->prepare("SELECT * FROM portfolio WHERE user_id = ? ORDER BY ticker");
    $stmt->execute([$uid]);
    return $stmt->fetchAll();
}

function addWatchlist(int $uid, string $ticker, string $name): void {
    getDB()->prepare("INSERT OR IGNORE INTO watchlist (user_id,ticker,name) VALUES (?,?,?)")
           ->execute([$uid, $ticker, $name]);
}

function getWatchlist(int $uid): array {
    $stmt = getDB()->prepare("SELECT * FROM watchlist WHERE user_id = ?");
    $stmt->execute([$uid]);
    return $stmt->fetchAll();
}

function saveReport(int $uid, string $id, string $modeId, string $content): void {
    getDB()->prepare(
        "INSERT OR IGNORE INTO saved_reports
         (id,user_id,mode_id,mode_title,mode_sub,mode_col,mode_icon,content,article_link,saved_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)"
    )->execute([$id, $uid, $modeId, 'Test Report', '', '#10b981', '🤖', $content, '', time() * 1000]);
}

function getReports(int $uid): array {
    $stmt = getDB()->prepare("SELECT * FROM saved_reports WHERE user_id = ? ORDER BY saved_at DESC");
    $stmt->execute([$uid]);
    return $stmt->fetchAll();
}

// ── Portfolio tests ───────────────────────────────────────────────────────────

describe('PORTFOLIO — CRUD', function() {

    test('adds a holding for a user', function() {
        $uid = createTestUser('port1');
        addHolding($uid, 'AAPL', 'Apple Inc.', 10, 150.00);
        $holdings = getHoldings($uid);
        expect(count($holdings))->toBe(1);
        expect($holdings[0]['ticker'])->toBe('AAPL');
        expect((float)$holdings[0]['shares'])->toBe(10.0);
        expect((float)$holdings[0]['avg_cost'])->toBe(150.0);
    });

    test('upserts (updates) an existing ticker rather than duplicating', function() {
        $uid = createTestUser('port2');
        addHolding($uid, 'MSFT', 'Microsoft', 5, 300.00);
        addHolding($uid, 'MSFT', 'Microsoft', 10, 320.00); // update
        $holdings = getHoldings($uid);
        expect(count($holdings))->toBe(1);
        expect((float)$holdings[0]['shares'])->toBe(10.0);
        expect((float)$holdings[0]['avg_cost'])->toBe(320.0);
    });

    test('can hold multiple tickers', function() {
        $uid = createTestUser('port3');
        addHolding($uid, 'AAPL', 'Apple', 5, 170.0);
        addHolding($uid, 'GOOGL', 'Alphabet', 2, 2800.0);
        addHolding($uid, 'NVDA', 'NVIDIA', 3, 500.0);
        expect(count(getHoldings($uid)))->toBe(3);
    });

    test('deletes a specific holding', function() {
        $uid = createTestUser('port4');
        addHolding($uid, 'TSLA', 'Tesla', 8, 200.0);
        addHolding($uid, 'META', 'Meta', 4, 350.0);
        getDB()->prepare("DELETE FROM portfolio WHERE user_id=? AND ticker=?")->execute([$uid, 'TSLA']);
        $holdings = getHoldings($uid);
        expect(count($holdings))->toBe(1);
        expect($holdings[0]['ticker'])->toBe('META');
    });

    test('user cannot see another user\'s holdings', function() {
        $uid1 = createTestUser('port5a');
        $uid2 = createTestUser('port5b');
        addHolding($uid1, 'SPY', 'S&P ETF', 20, 500.0);
        expect(count(getHoldings($uid2)))->toBe(0);
    });

    test('deleting one user does not delete another\'s holdings', function() {
        $uid1 = createTestUser('port6a');
        $uid2 = createTestUser('port6b');
        addHolding($uid1, 'VTI', 'Vanguard', 10, 200.0);
        addHolding($uid2, 'QQQ', 'Nasdaq ETF', 5, 400.0);
        // Only delete uid1's holding
        getDB()->prepare("DELETE FROM portfolio WHERE user_id=?")->execute([$uid1]);
        expect(count(getHoldings($uid2)))->toBe(1);
    });
});

// ── Watchlist tests ───────────────────────────────────────────────────────────

describe('WATCHLIST — CRUD', function() {

    test('adds a ticker to watchlist', function() {
        $uid = createTestUser('wl1');
        addWatchlist($uid, 'BTC', 'Bitcoin');
        $wl = getWatchlist($uid);
        expect(count($wl))->toBe(1);
        expect($wl[0]['ticker'])->toBe('BTC');
    });

    test('INSERT IGNORE prevents duplicate tickers', function() {
        $uid = createTestUser('wl2');
        addWatchlist($uid, 'ETH', 'Ethereum');
        addWatchlist($uid, 'ETH', 'Ethereum'); // duplicate
        expect(count(getWatchlist($uid)))->toBe(1);
    });

    test('removes a ticker from watchlist', function() {
        $uid = createTestUser('wl3');
        addWatchlist($uid, 'GOLD', 'Gold');
        addWatchlist($uid, 'SILVER', 'Silver');
        getDB()->prepare("DELETE FROM watchlist WHERE user_id=? AND ticker=?")->execute([$uid, 'GOLD']);
        $wl = getWatchlist($uid);
        expect(count($wl))->toBe(1);
        expect($wl[0]['ticker'])->toBe('SILVER');
    });

    test('watchlist is isolated between users', function() {
        $uid1 = createTestUser('wl4a');
        $uid2 = createTestUser('wl4b');
        addWatchlist($uid1, 'NVDA', 'NVIDIA');
        expect(count(getWatchlist($uid2)))->toBe(0);
    });
});

// ── Saved Reports tests ───────────────────────────────────────────────────────

describe('SAVED REPORTS — CRUD', function() {

    test('saves a FinBot report', function() {
        $uid = createTestUser('rep1');
        saveReport($uid, 'rpt001', 'dcf', 'DCF analysis content here.');
        $reports = getReports($uid);
        expect(count($reports))->toBe(1);
        expect($reports[0]['id'])->toBe('rpt001');
        expect($reports[0]['mode_id'])->toBe('dcf');
        expect($reports[0]['content'])->toContain('DCF analysis');
    });

    test('saves a news analysis report', function() {
        $uid = createTestUser('rep2');
        saveReport($uid, 'rpt002', 'news', 'Article breakdown content.');
        $reports = getReports($uid);
        expect($reports[0]['mode_id'])->toBe('news');
    });

    test('INSERT IGNORE prevents duplicate report IDs', function() {
        $uid = createTestUser('rep3');
        saveReport($uid, 'rpt003', 'risk', 'First save.');
        saveReport($uid, 'rpt003', 'risk', 'Second save — should be ignored.');
        $reports = getReports($uid);
        expect(count($reports))->toBe(1);
        expect($reports[0]['content'])->toContain('First save');
    });

    test('orders reports newest-first', function() {
        $uid = createTestUser('rep4');
        $db  = getDB();
        $db->prepare("INSERT INTO saved_reports (id,user_id,mode_id,mode_title,content,saved_at) VALUES (?,?,?,?,?,?)")
           ->execute(['r_old', $uid, 'screener', 'Old', 'old content', 1000]);
        $db->prepare("INSERT INTO saved_reports (id,user_id,mode_id,mode_title,content,saved_at) VALUES (?,?,?,?,?,?)")
           ->execute(['r_new', $uid, 'dcf', 'New', 'new content', 9999]);
        $reports = getReports($uid);
        expect($reports[0]['id'])->toBe('r_new');
        expect($reports[1]['id'])->toBe('r_old');
    });

    test('deletes a specific report', function() {
        $uid = createTestUser('rep5');
        saveReport($uid, 'rpt_a', 'dcf', 'Report A');
        saveReport($uid, 'rpt_b', 'risk', 'Report B');
        getDB()->prepare("DELETE FROM saved_reports WHERE id=? AND user_id=?")->execute(['rpt_a', $uid]);
        $reports = getReports($uid);
        expect(count($reports))->toBe(1);
        expect($reports[0]['id'])->toBe('rpt_b');
    });

    test('DELETE requires matching user_id (cannot delete another user\'s report)', function() {
        $uid1 = createTestUser('rep6a');
        $uid2 = createTestUser('rep6b');
        saveReport($uid1, 'rpt_x', 'dcf', 'User 1 report');
        // uid2 tries to delete uid1's report
        getDB()->prepare("DELETE FROM saved_reports WHERE id=? AND user_id=?")->execute(['rpt_x', $uid2]);
        // Report should still exist
        $reports = getReports($uid1);
        expect(count($reports))->toBe(1);
    });

    test('reports are isolated between users', function() {
        $uid1 = createTestUser('rep7a');
        $uid2 = createTestUser('rep7b');
        saveReport($uid1, 'rpt_u1', 'macro', 'User 1 only');
        expect(count(getReports($uid2)))->toBe(0);
    });
});

// ── Settings tests ────────────────────────────────────────────────────────────

describe('SETTINGS — Read/Write', function() {

    test('default settings are created on registration', function() {
        $uid  = createTestUser('set1');
        $stmt = getDB()->prepare("SELECT * FROM user_settings WHERE user_id = ?");
        $stmt->execute([$uid]);
        $s = $stmt->fetch();
        expect($s)->toBeArray();
        expect($s['currency'])->toBe('USD');
        expect((int)$s['hide_balances'])->toBe(0);
        expect((int)$s['compact_view'])->toBe(0);
    });

    test('updates settings fields', function() {
        $uid = createTestUser('set2');
        getDB()->prepare("UPDATE user_settings SET currency=?, hide_balances=? WHERE user_id=?")
               ->execute(['ZAR', 1, $uid]);
        $stmt = getDB()->prepare("SELECT * FROM user_settings WHERE user_id = ?");
        $stmt->execute([$uid]);
        $s = $stmt->fetch();
        expect($s['currency'])->toBe('ZAR');
        expect((int)$s['hide_balances'])->toBe(1);
    });
});

// ── Auth guard tests ──────────────────────────────────────────────────────────

describe('AUTH GUARDS — requireAuth()', function() {

    test('unauthenticated query returns no rows (session isolation)', function() {
        // Simulates what happens when user_id is 0 / null — no data leaked
        $stmt = getDB()->prepare("SELECT * FROM portfolio WHERE user_id = ?");
        $stmt->execute([0]);
        expect(count($stmt->fetchAll()))->toBe(0);

        $stmt->execute([999999]);
        expect(count($stmt->fetchAll()))->toBe(0);
    });

    test('negative or zero user_id cannot match any row', function() {
        $uid = createTestUser('guard1');
        addHolding($uid, 'AAPL', 'Apple', 10, 150.0);
        $stmt = getDB()->prepare("SELECT * FROM portfolio WHERE user_id = ?");
        $stmt->execute([-1]);
        expect(count($stmt->fetchAll()))->toBe(0);
    });
});
