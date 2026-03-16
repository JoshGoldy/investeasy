<?php
header('Content-Type: application/json');
header('Cache-Control: no-store');

// ── Ticker map: app symbol → Yahoo Finance symbol ─────────────────────────────
const TICKER_MAP = [
    // Indices
    'SPX'   => '^GSPC',
    'NDX'   => '^NDX',
    'DJI'   => '^DJI',
    'UKX'   => '^FTSE',
    // Tech / equities
    'AAPL'  => 'AAPL',
    'MSFT'  => 'MSFT',
    'NVDA'  => 'NVDA',
    'TSLA'  => 'TSLA',
    'AMZN'  => 'AMZN',
    'GOOGL' => 'GOOGL',
    'META'  => 'META',
    // Finance
    'JPM'   => 'JPM',
    'BAC'   => 'BAC',
    'GS'    => 'GS',
    // Healthcare
    'JNJ'   => 'JNJ',
    'PFE'   => 'PFE',
    'MRK'   => 'MRK',
    // Energy
    'XOM'   => 'XOM',
    'CVX'   => 'CVX',
    // Consumer
    'WMT'   => 'WMT',
    'COST'  => 'COST',
    // Industrial
    'BA'    => 'BA',
    'CAT'   => 'CAT',
    // Commodities
    'XAU'   => 'GC=F',
    'XAG'   => 'SI=F',
    'CL1'   => 'CL=F',
    'NG1'   => 'NG=F',
    'HG1'   => 'HG=F',
    'PL1'   => 'PL=F',
    'ZW1'   => 'ZW=F',
    // Crypto — must use Yahoo Finance -USD suffix
    'BTC'   => 'BTC-USD',
    'ETH'   => 'ETH-USD',
    'SOL'   => 'SOL-USD',
    'XRP'   => 'XRP-USD',
    'BNB'   => 'BNB-USD',
    'ADA'   => 'ADA-USD',
    'DOGE'  => 'DOGE-USD',
    'AVAX'  => 'AVAX-USD',
    'LINK'  => 'LINK-USD',
    'MATIC' => 'MATIC-USD',
];

$action = $_GET['action'] ?? '';

// ── Batch quotes ──────────────────────────────────────────────────────────────
if ($action === 'quotes') {
    $raw     = explode(',', $_GET['tickers'] ?? '');
    $tickers = array_filter(array_map('trim', $raw));
    $results = [];

    foreach ($tickers as $ticker) {
        if (!isset(TICKER_MAP[$ticker])) continue;   // skip unknown tickers — never fall back to raw symbol
        $ySym = TICKER_MAP[$ticker];
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

    if (!isset(TICKER_MAP[$ticker])) {
        echo json_encode(['success' => false, 'error' => 'Unknown ticker']);
        exit;
    }
    $ySym  = TICKER_MAP[$ticker];
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

} elseif ($action === 'article') {
    $url = trim($_GET['url'] ?? '');
    if (!$url || !filter_var($url, FILTER_VALIDATE_URL)) {
        echo json_encode(['success' => false, 'error' => 'Invalid URL']);
        exit;
    }
    $scheme = parse_url($url, PHP_URL_SCHEME);
    if (!in_array($scheme, ['http', 'https'])) {
        echo json_encode(['success' => false, 'error' => 'Invalid URL scheme']);
        exit;
    }

    $cachePath = sys_get_temp_dir() . '/ie_art_' . md5($url) . '.json';
    if (file_exists($cachePath) && (time() - filemtime($cachePath)) < 3600) {
        $cached = @file_get_contents($cachePath);
        if ($cached) { echo $cached; exit; }
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept: text/html,application/xhtml+xml',
            'Accept-Language: en-US,en;q=0.9',
        ],
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!$html || $code !== 200) {
        echo json_encode(['success' => false, 'error' => 'Could not fetch article']);
        exit;
    }

    $paragraphs = extractArticleText($html);
    $out = json_encode(['success' => true, 'paragraphs' => $paragraphs]);
    @file_put_contents($cachePath, $out);
    echo $out;

} elseif ($action === 'news') {
    $articles = fetchNewsFromRSS();
    if ($articles === null) {
        echo json_encode(['success' => false, 'error' => 'Could not fetch news']);
        exit;
    }
    echo json_encode(['success' => true, 'articles' => $articles, 'fetchedAt' => time()]);

} else {
    echo json_encode(['success' => false, 'error' => 'Unknown action']);
}

// ── Article text extractor ────────────────────────────────────────────────────
function extractArticleText(string $html): array {
    // Strip scripts, styles, and noisy structural tags
    $html = preg_replace('/<(script|style|noscript|iframe|aside|nav|header|footer|form)[^>]*>.*?<\/\1>/is', '', $html);
    // Remove HTML comments
    $html = preg_replace('/<!--.*?-->/s', '', $html);

    // Try to isolate article body using common containers (ordered by specificity)
    $body = '';
    $patterns = [
        '/<article[^>]*>(.*?)<\/article>/is',
        '/<div[^>]*\b(?:class|id)="[^"]*\b(?:article-body|article-content|story-body|story-content|post-body|post-content|entry-content|article__body|caas-body|Body|ArticleBody|paywall-article)[^"]*"[^>]*>(.*?)<\/div>/is',
        '/<div[^>]*\b(?:class|id)=\'[^\']*\b(?:article-body|article-content|story-body)[^\']*\'[^>]*>(.*?)<\/div>/is',
        '/<main[^>]*>(.*?)<\/main>/is',
    ];
    foreach ($patterns as $p) {
        if (preg_match($p, $html, $m)) {
            $body = end($m);
            break;
        }
    }
    if (!$body) $body = $html;

    // Pull all <p> tags
    preg_match_all('/<p[^>]*>(.*?)<\/p>/is', $body, $matches);
    $paragraphs = [];
    foreach ($matches[1] as $raw) {
        $text = strip_tags($raw);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/', ' ', trim($text));
        // Skip navigation snippets, cookie notices, very short lines
        if (mb_strlen($text) < 50) continue;
        if (preg_match('/cookie|subscribe|sign up|newsletter|javascript|follow us|advertisement/i', $text)) continue;
        $paragraphs[] = $text;
        if (count($paragraphs) >= 8) break;
    }
    return $paragraphs;
}

// ── RSS news fetch ────────────────────────────────────────────────────────────
function fetchNewsFromRSS(): ?array {
    $cachePath = sys_get_temp_dir() . '/ie_news_rss.json';

    // Serve cache if fresh (< 5 min)
    $staleCache = null;
    if (file_exists($cachePath)) {
        $cached = @file_get_contents($cachePath);
        if ($cached) {
            $d = json_decode($cached, true);
            if (is_array($d) && count($d) > 0) {
                if ((time() - filemtime($cachePath)) < 300) return $d;
                $staleCache = $d; // keep for fallback if live fetch fails
            }
        }
    }

    // Multiple feeds — ordered by reliability
    $feeds = [
        ['url' => 'https://www.cnbc.com/id/100003114/device/rss/rss.html',                                           'pub' => 'CNBC'],
        ['url' => 'https://www.cnbc.com/id/10000664/device/rss/rss.html',                                            'pub' => 'CNBC'],
        ['url' => 'https://feeds.marketwatch.com/marketwatch/topstories/',                                           'pub' => 'MarketWatch'],
        ['url' => 'https://feeds.marketwatch.com/marketwatch/marketpulse/',                                          'pub' => 'MarketWatch'],
        ['url' => 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',                   'pub' => 'Yahoo Finance'],
        ['url' => 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^NDX&region=US&lang=en-US',                    'pub' => 'Yahoo Finance'],
        ['url' => 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',                                       'pub' => 'New York Times'],
        ['url' => 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                                                   'pub' => 'Wall Street Journal'],
        ['url' => 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',             'pub' => 'CNBC'],
        ['url' => 'https://feeds.reuters.com/reuters/businessNews',                                                  'pub' => 'Reuters'],
    ];

    $articles = [];
    $seen     = [];

    foreach ($feeds as $feed) {
        $xml = fetchXmlFeed($feed['url']);
        if (!$xml) continue;

        // RSS 2.0: items live under channel/item
        $items = isset($xml->channel) ? $xml->channel->item : $xml->item;
        if (!$items) continue;

        foreach ($items as $item) {
            $title = html_entity_decode(trim((string)$item->title), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if (!$title) continue;
            $key = md5(strtolower($title));
            if (isset($seen[$key])) continue;
            $seen[$key] = true;

            // Link — try <link>, then <guid> if it looks like a URL
            $link = trim((string)$item->link);
            if (!$link) {
                $guid = trim((string)$item->guid);
                if (filter_var($guid, FILTER_VALIDATE_URL)) $link = $guid;
            }
            // Yahoo Finance article links frequently 404 — replace with a Google search
            if ($link && strpos($link, 'finance.yahoo.com') !== false) {
                $link = 'https://www.google.com/search?q=' . urlencode($title) . '&tbm=nws';
            }

            // Description / summary from RSS
            $desc = '';
            if (!empty($item->description)) {
                $raw  = (string)$item->description;
                $desc = strip_tags($raw);
                $desc = html_entity_decode($desc, ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $desc = preg_replace('/\s+/', ' ', trim($desc));
                // Drop if it's just the title echoed back or is too short
                if (strlen($desc) < 60 || similar_text(strtolower($desc), strtolower($title)) / max(strlen($title),1) > 0.85) {
                    $desc = '';
                }
                if (strlen($desc) > 800) $desc = substr($desc, 0, 800) . '…';
            }

            // Publisher — prefer <source> tag, fall back to feed default
            $publisher = $feed['pub'];
            if (!empty($item->source)) {
                $src = trim((string)$item->source);
                if ($src) $publisher = $src;
            }

            // Thumbnail — try media:content, then media:thumbnail, then enclosure
            $thumb = null;
            $media = $item->children('media', true);
            if (!empty($media->content)) {
                $a = $media->content->attributes();
                if (!empty($a['url'])) $thumb = (string)$a['url'];
            }
            if (!$thumb && !empty($media->thumbnail)) {
                $a = $media->thumbnail->attributes();
                if (!empty($a['url'])) $thumb = (string)$a['url'];
            }
            if (!$thumb && !empty($item->enclosure)) {
                $a = $item->enclosure->attributes();
                if (!empty($a['type']) && strpos((string)$a['type'], 'image') === 0) {
                    $thumb = (string)($a['url'] ?? '');
                }
            }

            $pubTime = strtotime((string)$item->pubDate) ?: 0;
            $age     = max(0, time() - $pubTime);
            if ($age < 3600)      $timeStr = max(1, round($age / 60)) . 'm ago';
            elseif ($age < 86400) $timeStr = round($age / 3600) . 'h ago';
            else                  $timeStr = round($age / 86400) . 'd ago';

            $articles[] = [
                'uuid'        => md5($title . $link),
                'title'       => $title,
                'publisher'   => $publisher,
                'link'        => $link,
                'description' => $desc,
                'time'        => $timeStr,
                'pubTime'     => $pubTime,
                'tickers'     => [],
                'thumbnail'   => $thumb ?: null,
                'cat'         => categorizeArticle($title, []),
                'hot'         => isHotArticle($title, []),
            ];

            if (count($articles) >= 60) break 2;
        }
    }

    if (!$articles) {
        // All feeds failed — serve stale cache rather than null so the UI always has real news
        return $staleCache;
    }

    usort($articles, fn($a, $b) => $b['pubTime'] - $a['pubTime']);
    $articles = array_values(array_slice($articles, 0, 50));
    @file_put_contents($cachePath, json_encode($articles));
    return $articles;
}

function fetchXmlFeed(string $url): ?SimpleXMLElement {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: Mozilla/5.0 (compatible; RSS reader/1.0)',
            'Accept: application/rss+xml, application/xml, text/xml, */*',
        ],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$body || $code !== 200) return null;
    libxml_use_internal_errors(true);
    $xml = simplexml_load_string($body);
    return $xml ?: null;
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
