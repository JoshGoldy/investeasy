<?php
header('Content-Type: application/json');
header('Cache-Control: no-store');

// ── Ticker map: app symbol → Yahoo Finance symbol ─────────────────────────────
const TICKER_MAP = [
    'SPX'  => '^GSPC',
    'NDX'  => '^NDX',
    'DJI'  => '^DJI',
    'UKX'  => '^FTSE',
    'AAPL' => 'AAPL',
    'MSFT' => 'MSFT',
    'NVDA' => 'NVDA',
    'TSLA' => 'TSLA',
    'AMZN' => 'AMZN',
    'XAU'  => 'GC=F',
    'CL1'  => 'CL=F',
    'BTC'  => 'BTC-USD',
];

$action = $_GET['action'] ?? '';

// ── Batch quotes ──────────────────────────────────────────────────────────────
if ($action === 'quotes') {
    $raw     = explode(',', $_GET['tickers'] ?? '');
    $tickers = array_filter(array_map('trim', $raw));
    $results = [];

    foreach ($tickers as $ticker) {
        $ySym = TICKER_MAP[$ticker] ?? $ticker;
        $data = fetchYahoo($ySym, '1d', '5d', 60);
        if (!$data || !isset($data['chart']['result'][0])) continue;

        $meta      = $data['chart']['result'][0]['meta'];
        $price     = $meta['regularMarketPrice'] ?? null;
        $prevClose = $meta['previousClose'] ?? $meta['chartPreviousClose'] ?? null;
        $chgPct    = null;

        if ($price && $prevClose && $prevClose > 0) {
            $chgPct = round(($price - $prevClose) / $prevClose * 100, 2);
        } elseif (isset($meta['regularMarketChangePercent'])) {
            $chgPct = round($meta['regularMarketChangePercent'], 2);
        }

        $results[$ticker] = [
            'price' => $price   ? round((float)$price, 4)            : null,
            'chg'   => $chgPct,
            'hi52'  => isset($meta['fiftyTwoWeekHigh']) ? round($meta['fiftyTwoWeekHigh'], 2) : null,
            'lo52'  => isset($meta['fiftyTwoWeekLow'])  ? round($meta['fiftyTwoWeekLow'],  2) : null,
        ];
    }

    echo json_encode(['success' => true, 'quotes' => $results]);

// ── Single ticker chart ────────────────────────────────────────────────────────
} elseif ($action === 'chart') {
    $ticker = trim($_GET['ticker'] ?? '');
    $tf     = $_GET['tf'] ?? '1M';

    if (!$ticker) {
        echo json_encode(['success' => false, 'error' => 'Missing ticker']);
        exit;
    }

    $ySym  = TICKER_MAP[$ticker] ?? $ticker;
    $tfMap = [
        '1D' => ['interval' => '5m',  'range' => '1d',  'cache' => 120],
        '1W' => ['interval' => '60m', 'range' => '5d',  'cache' => 300],
        '1M' => ['interval' => '1d',  'range' => '1mo', 'cache' => 600],
        '3M' => ['interval' => '1d',  'range' => '3mo', 'cache' => 1800],
        '1Y' => ['interval' => '1wk', 'range' => '1y',  'cache' => 3600],
    ];
    $cfg = $tfMap[$tf] ?? $tfMap['1M'];

    $data = fetchYahoo($ySym, $cfg['interval'], $cfg['range'], $cfg['cache']);

    if (!$data || !isset($data['chart']['result'][0])) {
        echo json_encode(['success' => false, 'error' => 'No data from Yahoo Finance']);
        exit;
    }

    $result     = $data['chart']['result'][0];
    $closes     = $result['indicators']['quote'][0]['close'] ?? [];
    $timestamps = $result['timestamp'] ?? [];
    $points     = [];

    for ($i = 0, $n = min(count($closes), count($timestamps)); $i < $n; $i++) {
        if ($closes[$i] !== null && is_numeric($closes[$i])) {
            $points[] = ['time' => (int)$timestamps[$i], 'value' => round((float)$closes[$i], 4)];
        }
    }

    if (empty($points)) {
        echo json_encode(['success' => false, 'error' => 'Empty dataset']);
        exit;
    }

    echo json_encode(['success' => true, 'points' => $points]);

} elseif ($action === 'news') {
    $count = min((int)($_GET['count'] ?? 40), 60);
    $cat   = strtolower(trim($_GET['cat'] ?? 'all'));

    // Different queries per category for more targeted results
    $queries = [
        'all'     => 'stock market investing finance',
        'markets' => 'stock market S&P 500 Wall Street equities',
        'economy' => 'economy inflation interest rates Federal Reserve GDP',
        'tech'    => 'technology stocks AI semiconductor Apple Microsoft Nvidia',
        'crypto'  => 'bitcoin cryptocurrency ethereum blockchain crypto',
    ];
    $q = $queries[$cat] ?? $queries['all'];

    $articles = fetchYahooNews($q, $count);
    if ($articles === null) {
        echo json_encode(['success' => false, 'error' => 'Could not fetch news']);
        exit;
    }
    echo json_encode(['success' => true, 'articles' => $articles, 'fetchedAt' => time()]);

} else {
    echo json_encode(['success' => false, 'error' => 'Unknown action']);
}

// ── Yahoo Finance news fetch ──────────────────────────────────────────────────
function fetchYahooNews(string $query, int $count): ?array {
    $cacheKey  = md5('news_' . $query . '_' . $count);
    $cachePath = sys_get_temp_dir() . '/ie_news_' . $cacheKey . '.json';

    if (file_exists($cachePath) && (time() - filemtime($cachePath)) < 300) {
        $cached = @file_get_contents($cachePath);
        if ($cached) {
            $d = json_decode($cached, true);
            if (is_array($d)) return $d;
        }
    }

    $url = 'https://query1.finance.yahoo.com/v1/finance/search?'
         . http_build_query([
             'q'                  => $query,
             'newsCount'          => $count,
             'quotesCount'        => 0,
             'lang'               => 'en-US',
             'region'             => 'US',
             'enableFuzzyQuery'   => 'false',
             'enableCb'           => 'false',
         ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept: application/json, text/plain, */*',
            'Accept-Language: en-US,en;q=0.9',
            'Referer: https://finance.yahoo.com',
        ],
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$response) return null;
    $decoded = json_decode($response, true);
    if (!$decoded || empty($decoded['news'])) return null;

    $articles = [];
    foreach ($decoded['news'] as $item) {
        if (($item['type'] ?? '') !== 'STORY') continue;

        $title     = $item['title']   ?? '';
        $publisher = $item['publisher'] ?? 'Unknown';
        $link      = $item['link']    ?? '';
        $pubTime   = (int)($item['providerPublishTime'] ?? 0);
        $tickers   = $item['relatedTickers'] ?? [];
        $thumb     = null;

        if (!empty($item['thumbnail']['resolutions'])) {
            // Pick the smallest usable thumbnail
            foreach ($item['thumbnail']['resolutions'] as $res) {
                if (($res['width'] ?? 0) >= 100) { $thumb = $res['url']; break; }
            }
        }

        $age = time() - $pubTime;
        if ($age < 3600)       $timeStr = max(1, round($age / 60)) . 'm ago';
        elseif ($age < 86400)  $timeStr = round($age / 3600) . 'h ago';
        else                   $timeStr = round($age / 86400) . 'd ago';

        $articles[] = [
            'uuid'      => $item['uuid'] ?? uniqid(),
            'title'     => $title,
            'publisher' => $publisher,
            'link'      => $link,
            'time'      => $timeStr,
            'pubTime'   => $pubTime,
            'tickers'   => array_slice($tickers, 0, 5),
            'thumbnail' => $thumb,
            'cat'       => categorizeArticle($title, $tickers),
            'hot'       => isHotArticle($title, $tickers),
        ];
    }

    usort($articles, fn($a, $b) => $b['pubTime'] - $a['pubTime']);
    @file_put_contents($cachePath, json_encode($articles));
    return $articles;
}

function categorizeArticle(string $title, array $tickers): string {
    $t = strtolower($title);

    // Crypto: check tickers first, then keywords
    $cryptoTickers = ['BTC-USD','ETH-USD','BNB-USD','XRP-USD','ADA-USD','DOGE-USD','SOL-USD','MATIC-USD','AVAX-USD'];
    foreach ($tickers as $tick) {
        if (in_array($tick, $cryptoTickers)) return 'Crypto';
    }
    if (preg_match('/bitcoin|ethereum|crypto|blockchain|defi|solana|nft|dogecoin|ripple|altcoin|stablecoin|web3/', $t)) return 'Crypto';

    // Economy: macro keywords
    if (preg_match('/\bfed\b|federal reserve|inflation|cpi|ppi|gdp|interest rate|recession|unemployment|payroll|jobs report|treasury|yield curve|fiscal|monetary|tariff|trade war|deficit|surplus|central bank|imf|world bank/', $t)) return 'Economy';

    // Tech: company or sector keywords
    if (preg_match('/apple|microsoft|google|alphabet|amazon|meta|nvidia|tesla|openai|\bai\b|artificial intelligence|chip|semiconductor|software|cloud|cyber|data center|palantir|amd|intel|arm holdings/', $t)) return 'Tech';

    // Default
    return 'Markets';
}

function isHotArticle(string $title, array $tickers): bool {
    $t = strtolower($title);
    if (preg_match('/surge|soar|crash|record|rally|plunge|breaking|alert|spike|all.time.high|ath|collapse|explode|rip/', $t)) return true;
    if (count($tickers) >= 4) return true;
    return false;
}

// ── Yahoo Finance fetch with file cache ────────────────────────────────────────
function fetchYahoo(string $symbol, string $interval, string $range, int $cacheSecs): ?array {
    $cacheDir  = sys_get_temp_dir();
    $cachePath = $cacheDir . '/ie_' . md5($symbol . $interval . $range) . '.json';

    if (file_exists($cachePath) && (time() - filemtime($cachePath)) < $cacheSecs) {
        $cached = @file_get_contents($cachePath);
        if ($cached) return json_decode($cached, true);
    }

    $url = 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($symbol)
         . '?interval=' . $interval . '&range=' . $range . '&includePrePost=false';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept: application/json, text/plain, */*',
            'Accept-Language: en-US,en;q=0.9',
            'Referer: https://finance.yahoo.com',
        ],
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);

    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$response) return null;
    $decoded = json_decode($response, true);
    if (!$decoded) return null;

    @file_put_contents($cachePath, $response);
    return $decoded;
}
