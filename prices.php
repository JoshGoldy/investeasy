<?php
header('Content-Type: application/json');
header('Cache-Control: no-store');

// ── One-time cleanup: purge stale cache files written before ETH→ETH-USD fix ──
// These files were created when ETH mapped to Ethan Allen (NYSE:ETH, ~$22).
// Safe to run every request — file_exists() is a no-op once they're gone.
foreach ([
    // Old keys (ETH → Ethan Allen raw symbol)
    md5('ETH5m1d'), md5('ETH1d5d'), md5('ETH60m5d'),
    md5('ETH1d1mo'), md5('ETH1d3mo'), md5('ETH1wk1y'),
    // New keys (ETH-USD) — purge in case a bad response was ever cached under these too
    md5('ETH-USD5m1d'), md5('ETH-USD1d5d'), md5('ETH-USD60m5d'),
    md5('ETH-USD1d1mo'), md5('ETH-USD1d3mo'), md5('ETH-USD1wk1y'),
] as $_stale) {
    $_f = sys_get_temp_dir() . '/ie_' . $_stale . '.json';
    if (file_exists($_f)) @unlink($_f);
}
unset($_stale, $_f);

// Force PHP to recompile this file on next request (clears any OPcache serving old code)
if (function_exists('opcache_invalidate')) opcache_invalidate(__FILE__, true);

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
        // Reject if Yahoo returned a different symbol (e.g. ETH→Ethan Allen instead of ETH-USD→Ethereum)
        $retSym = strtolower($meta['symbol'] ?? '');
        if ($retSym && $retSym !== strtolower($ySym)) continue;
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
    // Reject if Yahoo returned a different symbol (e.g. ETH→Ethan Allen instead of ETH-USD→Ethereum)
    $retSym = strtolower($result['meta']['symbol'] ?? '');
    if ($retSym && $retSym !== strtolower($ySym)) {
        echo json_encode(['success' => false, 'error' => 'Symbol mismatch: got ' . ($result['meta']['symbol'] ?? '?') . ', expected ' . $ySym]);
        exit;
    }
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

} elseif ($action === 'calendar') {
    $from = $_GET['from'] ?? date('Y-m-d');
    $to   = $_GET['to']   ?? date('Y-m-d', strtotime('+90 days'));
    $earnings = fetchEarningsCalendar($from, $to);
    $economic = generateEconomicEvents($from, $to);
    echo json_encode(['success' => true, 'earnings' => $earnings, 'economic' => $economic]);

} else {
    echo json_encode(['success' => false, 'error' => 'Unknown action']);
}

// ── Earnings calendar via Yahoo Finance quoteSummary ──────────────────────────
function fetchEarningsCalendar(string $from, string $to): array {
    $cacheKey  = md5($from . $to);
    $cachePath = sys_get_temp_dir() . '/ie_earn_cal_' . $cacheKey . '.json';

    if (file_exists($cachePath) && (time() - filemtime($cachePath)) < 21600) {
        $c = @file_get_contents($cachePath);
        if ($c) return json_decode($c, true) ?: [];
    }

    // Only equity tickers (skip indices, commodities, crypto)
    $stockTickers = ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META',
                     'JPM','BAC','GS','JNJ','PFE','MRK','XOM','CVX','WMT','COST','BA','CAT'];

    $nameMap = [
        'AAPL' => 'Apple',           'MSFT' => 'Microsoft',       'NVDA' => 'NVIDIA',
        'TSLA' => 'Tesla',           'AMZN' => 'Amazon',           'GOOGL' => 'Alphabet',
        'META' => 'Meta Platforms',  'JPM'  => 'JPMorgan Chase',   'BAC'  => 'Bank of America',
        'GS'   => 'Goldman Sachs',   'JNJ'  => 'Johnson & Johnson','PFE'  => 'Pfizer',
        'MRK'  => 'Merck',           'XOM'  => 'ExxonMobil',       'CVX'  => 'Chevron',
        'WMT'  => 'Walmart',         'COST' => 'Costco',           'BA'   => 'Boeing',
        'CAT'  => 'Caterpillar',
    ];

    $fromTs = strtotime($from);
    $toTs   = strtotime($to);

    // Build parallel curl requests
    $mh      = curl_multi_init();
    $handles = [];
    foreach ($stockTickers as $appTicker) {
        $ySym = TICKER_MAP[$appTicker] ?? null;
        if (!$ySym) continue;

        // Per-ticker cache (24 h) so we don't re-fetch every time
        $tc = sys_get_temp_dir() . '/ie_calevent_' . md5($ySym) . '.json';
        if (file_exists($tc) && (time() - filemtime($tc)) < 86400) {
            $cached = @file_get_contents($tc);
            if ($cached) { $handles[$appTicker] = ['cached' => json_decode($cached, true)]; continue; }
        }

        $url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
             . rawurlencode($ySym) . '?modules=calendarEvents';
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => [
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept: application/json',
                'Referer: https://finance.yahoo.com',
            ],
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$appTicker] = ['ch' => $ch, 'ySym' => $ySym];
    }

    // Execute parallel requests
    $running = null;
    do { curl_multi_exec($mh, $running); curl_multi_select($mh); } while ($running > 0);

    $earnings = [];
    foreach ($handles as $appTicker => $h) {
        if (isset($h['cached'])) {
            $data = $h['cached'];
        } else {
            $resp = curl_multi_getcontent($h['ch']);
            $code = curl_getinfo($h['ch'], CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($mh, $h['ch']);
            curl_close($h['ch']);
            if ($code !== 200 || !$resp) continue;
            $data = json_decode($resp, true);
            $tc = sys_get_temp_dir() . '/ie_calevent_' . md5($h['ySym']) . '.json';
            @file_put_contents($tc, $resp);
        }

        $cal    = $data['quoteSummary']['result'][0]['calendarEvents']['earnings'] ?? null;
        if (!$cal) continue;

        foreach ($cal['earningsDate'] ?? [] as $entry) {
            $ts = $entry['raw'] ?? null;
            if (!$ts || $ts < $fromTs || $ts > $toTs) continue;

            // Format revenue estimate
            $revRaw = $cal['revenueAverage']['raw'] ?? null;
            $revStr = null;
            if ($revRaw) {
                if ($revRaw >= 1e12)    $revStr = '$' . round($revRaw / 1e12, 1) . 'T';
                elseif ($revRaw >= 1e9) $revStr = '$' . round($revRaw / 1e9,  1) . 'B';
                elseif ($revRaw >= 1e6) $revStr = '$' . round($revRaw / 1e6,  1) . 'M';
            }

            $epsEst = isset($cal['earningsAverage']['raw']) ? round($cal['earningsAverage']['raw'], 2) : null;
            $epsLow = isset($cal['earningsLow']['raw'])     ? round($cal['earningsLow']['raw'],  2) : null;
            $epsHi  = isset($cal['earningsHigh']['raw'])    ? round($cal['earningsHigh']['raw'], 2) : null;

            $earnings[] = [
                'ticker'  => $appTicker,
                'name'    => $nameMap[$appTicker] ?? $appTicker,
                'date'    => date('Y-m-d', $ts),
                'ts'      => $ts,
                'epsEst'  => $epsEst,
                'epsLow'  => $epsLow,
                'epsHigh' => $epsHi,
                'revEst'  => $revStr,
            ];
            break; // one entry per ticker
        }
    }

    curl_multi_close($mh);
    usort($earnings, fn($a, $b) => $a['ts'] - $b['ts']);
    @file_put_contents($cachePath, json_encode($earnings));
    return $earnings;
}

// ── Economic events (Fed + macro) generated from known patterns ───────────────
function generateEconomicEvents(string $from, string $to): array {
    $fromTs = strtotime($from);
    $toTs   = strtotime($to);
    $events = [];

    // ── Fed 2026 decision dates (published schedule) ──────────────────────────
    $fedDecisions = [
        '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
        '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
    ];
    // FOMC meetings with rate projections (SEP = Summary of Economic Projections)
    $sepMeetings = ['2026-03-18', '2026-06-17', '2026-09-16', '2026-12-09'];

    foreach ($fedDecisions as $d) {
        $ts = strtotime($d);
        if ($ts >= $fromTs && $ts <= $toTs) {
            $hasSep = in_array($d, $sepMeetings);
            $events[] = [
                'date'  => $d,
                'ts'    => $ts,
                'type'  => 'fed',
                'title' => 'FOMC Rate Decision',
                'desc'  => 'Federal Reserve interest rate decision and policy statement.'
                         . ($hasSep ? ' Updated dot-plot and economic projections (SEP) released.' : ''),
            ];
        }
        // Press conference (following day)
        $pcTs = $ts + 86400;
        $pcDate = date('Y-m-d', $pcTs);
        if ($pcTs >= $fromTs && $pcTs <= $toTs) {
            $events[] = [
                'date'  => $pcDate,
                'ts'    => $pcTs,
                'type'  => 'fed',
                'title' => 'Fed Chair Press Conference',
                'desc'  => 'Post-FOMC press conference with Fed Chair Jerome Powell.',
            ];
        }
    }

    // ── Monthly recurring macro events ────────────────────────────────────────
    $cur = new DateTime(date('Y-m-01', $fromTs));
    $end = new DateTime($to);

    while ($cur <= $end) {
        $year  = (int)$cur->format('Y');
        $month = (int)$cur->format('m');

        $prevDt   = (clone $cur)->modify('-1 month');
        $prevName = $prevDt->format('F Y');
        $curName  = $cur->format('F Y');

        // Non-Farm Payrolls: first Friday of the month
        $nfp = new DateTime($cur->format('Y-m-01'));
        while ($nfp->format('N') !== '5') $nfp->modify('+1 day');
        $nfpTs = $nfp->getTimestamp();
        if ($nfpTs >= $fromTs && $nfpTs <= $toTs) {
            $events[] = [
                'date'  => $nfp->format('Y-m-d'),
                'ts'    => $nfpTs,
                'type'  => 'macro',
                'title' => "Non-Farm Payrolls — $prevName",
                'desc'  => "US monthly jobs report covering employment changes and unemployment rate for $prevName.",
            ];
        }

        // CPI: second Wednesday of the month
        $cpi = new DateTime($cur->format('Y-m-01'));
        $wCount = 0;
        while (true) {
            if ($cpi->format('N') === '3') { $wCount++; if ($wCount === 2) break; }
            $cpi->modify('+1 day');
        }
        $cpiTs = $cpi->getTimestamp();
        if ($cpiTs >= $fromTs && $cpiTs <= $toTs) {
            $events[] = [
                'date'  => $cpi->format('Y-m-d'),
                'ts'    => $cpiTs,
                'type'  => 'macro',
                'title' => "CPI — $prevName",
                'desc'  => "Consumer Price Index for $prevName. Primary inflation gauge watched by the Federal Reserve.",
            ];
        }

        // Core PCE: last Thursday of the month
        $pce = new DateTime($cur->format('Y-m-t'));
        while ($pce->format('N') !== '4') $pce->modify('-1 day');
        $pceTs = $pce->getTimestamp();
        if ($pceTs >= $fromTs && $pceTs <= $toTs) {
            $events[] = [
                'date'  => $pce->format('Y-m-d'),
                'ts'    => $pceTs,
                'type'  => 'macro',
                'title' => "Core PCE Price Index — $curName",
                'desc'  => "Fed's preferred inflation measure for $curName. Excludes food and energy prices.",
            ];
        }

        // GDP advance: last week of Jan, Apr, Jul, Oct (approx. -4 business days from month end)
        if (in_array($month, [1, 4, 7, 10])) {
            $qLabels = [1 => 'Q4 ' . ($year-1), 4 => 'Q1 ' . $year, 7 => 'Q2 ' . $year, 10 => 'Q3 ' . $year];
            $gdp = new DateTime($cur->format('Y-m-t'));
            $skip = 0;
            while ($skip < 3) { $gdp->modify('-1 day'); if ($gdp->format('N') <= '5') $skip++; }
            $gdpTs = $gdp->getTimestamp();
            if ($gdpTs >= $fromTs && $gdpTs <= $toTs) {
                $events[] = [
                    'date'  => $gdp->format('Y-m-d'),
                    'ts'    => $gdpTs,
                    'type'  => 'macro',
                    'title' => 'GDP Advance Estimate — ' . $qLabels[$month],
                    'desc'  => 'Bureau of Economic Analysis first estimate of GDP growth for ' . $qLabels[$month] . '.',
                ];
            }
        }

        $cur->modify('+1 month');
    }

    usort($events, fn($a, $b) => $a['ts'] - $b['ts']);
    return $events;
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

    $cutoff72h = time() - 72 * 3600;
    $articles = array_values(array_filter($articles, fn($a) => ($a['pubTime'] ?? 0) >= $cutoff72h));
    usort($articles, fn($a, $b) => $b['pubTime'] - $a['pubTime']);
    $articles = array_values(array_slice($articles, 0, 30));
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
