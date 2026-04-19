import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  quotes: { limit: 60, windowSeconds: 60 },
  chart: { limit: 120, windowSeconds: 5 * 60 },
  news: { limit: 20, windowSeconds: 5 * 60 },
  article: { limit: 20, windowSeconds: 10 * 60 },
  calendar: { limit: 20, windowSeconds: 10 * 60 },
};

const CACHE_TTLS: Record<string, number> = {
  quotes: 60,
  chart: 300,
  news: 300,
  calendar: 900,
};

const ALLOWED_ARTICLE_HOSTS = new Set([
  "www.cnbc.com",
  "cnbc.com",
  "www.marketwatch.com",
  "marketwatch.com",
  "www.wsj.com",
  "wsj.com",
  "www.reuters.com",
  "reuters.com",
  "rss.nytimes.com",
  "www.nytimes.com",
  "nytimes.com",
]);

let adminClient: ReturnType<typeof createClient> | null = null;

const TICKER_MAP: Record<string, string> = {
  SPX: "^GSPC",
  NDX: "^NDX",
  DJI: "^DJI",
  UKX: "^FTSE",
  N225: "^N225",
  DAX: "^GDAXI",
  HSI: "^HSI",
  AXJO: "^AXJO",
  AAPL: "AAPL",
  MSFT: "MSFT",
  NVDA: "NVDA",
  TSLA: "TSLA",
  AMZN: "AMZN",
  GOOGL: "GOOGL",
  META: "META",
  NFLX: "NFLX",
  AMD: "AMD",
  AVGO: "AVGO",
  CRM: "CRM",
  ADBE: "ADBE",
  INTC: "INTC",
  TM: "TM",
  JPM: "JPM",
  BAC: "BAC",
  GS: "GS",
  V: "V",
  MA: "MA",
  "BRK.B": "BRK-B",
  JNJ: "JNJ",
  PFE: "PFE",
  MRK: "MRK",
  UNH: "UNH",
  XOM: "XOM",
  CVX: "CVX",
  WMT: "WMT",
  COST: "COST",
  KO: "KO",
  MCD: "MCD",
  NKE: "NKE",
  BA: "BA",
  CAT: "CAT",
  XAU: "GC=F",
  XAG: "SI=F",
  CL1: "CL=F",
  NG1: "NG=F",
  HG1: "HG=F",
  PL1: "PL=F",
  ZW1: "ZW=F",
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  BNB: "BNB-USD",
  ADA: "ADA-USD",
  DOGE: "DOGE-USD",
  AVAX: "AVAX-USD",
  LINK: "LINK-USD",
  MATIC: "POL-USD",
  NPN: "NPN.JO",
  PRX: "PRX.JO",
  BHG: "BHP.JO",
  AGL: "AGL.JO",
  GLN: "GLN.JO",
  CFR: "CFR.JO",
  FSR: "FSR.JO",
  SBK: "SBK.JO",
  CPI: "CPI.JO",
  ABG: "ABG.JO",
  NED: "NED.JO",
  SHP: "SHP.JO",
  MTN: "MTN.JO",
  SLM: "SLM.JO",
  DSY: "DSY.JO",
  OMU: "OMU.JO",
  SOLJ: "SOL.JO",
  ANG: "ANG.JO",
  MNP: "MNP.JO",
  IMP: "IMP.JO",
};

const NAME_MAP: Record<string, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta Platforms",
  NFLX: "Netflix",
  AMD: "AMD",
  AVGO: "Broadcom",
  CRM: "Salesforce",
  ADBE: "Adobe",
  INTC: "Intel",
  TM: "Toyota",
  JPM: "JPMorgan Chase",
  BAC: "Bank of America",
  GS: "Goldman Sachs",
  V: "Visa",
  MA: "Mastercard",
  "BRK.B": "Berkshire Hathaway B",
  JNJ: "Johnson & Johnson",
  PFE: "Pfizer",
  MRK: "Merck",
  UNH: "UnitedHealth",
  XOM: "ExxonMobil",
  CVX: "Chevron",
  WMT: "Walmart",
  COST: "Costco",
  KO: "Coca-Cola",
  MCD: "McDonald's",
  NKE: "Nike",
  BA: "Boeing",
  CAT: "Caterpillar",
};

const CHART_CONFIG: Record<string, { interval: string; range: string; trailingSeconds?: number }> = {
  "1D": { interval: "15m", range: "5d", trailingSeconds: 24 * 60 * 60 },
  "1W": { interval: "60m", range: "5d" },
  "1M": { interval: "1d", range: "1mo" },
  "3M": { interval: "1d", range: "3mo" },
  "1Y": { interval: "1wk", range: "1y" },
  "ALL": { interval: "1mo", range: "max" },
};

const NEWS_FEEDS = [
  { id: "cnbc-top", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", pub: "CNBC", kind: "rss" },
  { id: "cnbc-finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", pub: "CNBC", kind: "rss" },
  { id: "marketwatch-top", url: "https://feeds.marketwatch.com/marketwatch/topstories/", pub: "MarketWatch", kind: "rss" },
  { id: "marketwatch-pulse", url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", pub: "MarketWatch", kind: "rss" },
  { id: "nyt-business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", pub: "New York Times", kind: "rss" },
  { id: "guardian-business", url: "https://content.guardianapis.com/business?api-key=test&show-fields=headline,trailText,thumbnail&page-size=20&order-by=newest", pub: "The Guardian", kind: "guardian" },
  { id: "guardian-tech", url: "https://content.guardianapis.com/technology?api-key=test&show-fields=headline,trailText,thumbnail&page-size=20&order-by=newest", pub: "The Guardian", kind: "guardian" },
] as const;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

async function createAdminClient() {
  if (adminClient) return adminClient;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment configuration for rate limiting.");
  }
  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

async function consumeRateLimit(action: string, subject: string) {
  const cfg = RATE_LIMITS[action];
  if (!cfg) return;
  const adminClient = await createAdminClient();
  const { data, error } = await adminClient.rpc("consume_rate_limit", {
    p_scope: `market-data:${action}`,
    p_subject: subject.slice(0, 160),
    p_limit: cfg.limit,
    p_window_seconds: cfg.windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    return json({ error: "Rate limit reached. Please wait a moment and try again." }, 429);
  }
  return null;
}

async function logFunctionEvent(
  service: string,
  level: string,
  subject: string | null,
  event: string,
  detail?: string,
  meta: Record<string, unknown> = {},
) {
  try {
    const adminClient = await createAdminClient();
    await adminClient.rpc("log_function_event", {
      p_service: service,
      p_level: level,
      p_subject: subject,
      p_event: event,
      p_detail: detail ?? null,
      p_meta: meta,
    });
  } catch (_) {
    // Logging should stay best-effort.
  }
}

function getCacheTtl(action: string, context: Record<string, unknown> = {}) {
  if (action === "quotes") {
    return 60;
  }
  if (action === "chart") {
    const tf = String(context.tf || "").toUpperCase();
    if (tf === "1D") return 60;
    if (["1W", "1M", "3M", "1Y", "ALL"].includes(tf)) return 300;
  }
  return CACHE_TTLS[action] ?? 0;
}

async function getCachedPayload(cacheKey: string) {
  const client = await createAdminClient();
  const { data, error } = await client
    .from("market_cache")
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) throw new Error(`Cache lookup failed: ${error.message}`);
  if (!data?.payload || !data.expires_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.payload;
}

async function setCachedPayload(cacheKey: string, payload: Record<string, unknown>, ttlSeconds: number) {
  if (!ttlSeconds) return;
  const client = await createAdminClient();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await client
    .from("market_cache")
    .upsert({
      cache_key: cacheKey,
      payload,
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  if (error) throw new Error(`Cache write failed: ${error.message}`);
}

function sanitizeCacheKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9:_.,-]/g, "_").slice(0, 180);
}

async function withMarketCache(
  action: string,
  cacheKey: string,
  context: Record<string, unknown>,
  builder: () => Promise<Record<string, unknown>>,
) {
  const ttlSeconds = getCacheTtl(action, context);
  if (ttlSeconds > 0) {
    try {
      const cached = await getCachedPayload(cacheKey);
      if (cached) return json(cached as Record<string, unknown>);
    } catch (error) {
      await logFunctionEvent("market-data", "warn", cacheKey, "cache_read_failed", error instanceof Error ? error.message : "Unknown cache read failure", { action });
    }
  }

  const payload = await builder();
  if (ttlSeconds > 0) {
    try {
      await setCachedPayload(cacheKey, payload, ttlSeconds);
    } catch (error) {
      await logFunctionEvent("market-data", "warn", cacheKey, "cache_write_failed", error instanceof Error ? error.message : "Unknown cache write failure", { action });
    }
  }
  return json(payload);
}

async function fetchJson(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`Upstream request failed with ${resp.status}`);
  return resp.json();
}

async function fetchText(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`Upstream request failed with ${resp.status}`);
  return resp.text();
}

function parseTickers(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v || "").trim()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function fetchYahooChart(symbol: string, interval: string, range: string) {
  return fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
        Referer: "https://finance.yahoo.com",
      },
    },
  );
}

function buildSyntheticIntradaySeries(currentPrice: number, previousClose: number, pointCount = 24) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (pointCount - 1) * 15 * 60;
  const base = previousClose > 0 ? previousClose : currentPrice;
  const delta = currentPrice - base;
  const points: Array<{ time: number; value: number }> = [];

  for (let i = 0; i < pointCount; i++) {
    const progress = pointCount === 1 ? 1 : i / (pointCount - 1);
    const ease = progress * progress * (3 - 2 * progress);
    points.push({
      time: start + i * 15 * 60,
      value: Number((base + delta * ease).toFixed(4)),
    });
  }

  return points;
}

function isJseSymbol(symbol: string) {
  return symbol.endsWith(".JO");
}

function getJohannesburgParts(unixTime: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(unixTime * 1000));

  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: String(map.weekday || ""),
    minutes: hour * 60 + minute,
  };
}

function keepLatestJseSession(points: Array<{ time: number; value: number }>) {
  if (points.length < 2) return points;

  const byDate = new Map<string, Array<{ time: number; value: number }>>();
  for (const point of points) {
    const info = getJohannesburgParts(point.time);
    if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(info.weekday)) continue;
    if (info.minutes < 9 * 60 || info.minutes > 17 * 60 + 10) continue;
    if (!byDate.has(info.dateKey)) byDate.set(info.dateKey, []);
    byDate.get(info.dateKey)?.push(point);
  }

  const latestDate = [...byDate.keys()].sort().pop();
  if (!latestDate) return points;
  const sessionPoints = byDate.get(latestDate) || [];
  return sessionPoints.length > 1 ? sessionPoints : points;
}

function dropTerminalOutlier(points: Array<{ time: number; value: number }>, symbol: string, tf: string) {
  if (tf !== "1D" || !isJseSymbol(symbol) || points.length < 3) return points;

  const prevPrev = points[points.length - 3]?.value;
  const prev = points[points.length - 2]?.value;
  const last = points[points.length - 1]?.value;
  if (!prevPrev || !prev || !last) return points;

  const baselineMove = Math.abs((prev - prevPrev) / prevPrev);
  const lastMove = Math.abs((last - prev) / prev);

  // Yahoo occasionally appends a synthetic last point for JSE symbols long after
  // the session is over. If that last point is dramatically larger than the
  // recent bar-to-bar movement, drop it and keep the continuous intraday series.
  if (lastMove > 0.05 && lastMove > Math.max(0.01, baselineMove * 4)) {
    return points.slice(0, -1);
  }

  return points;
}

function trimIntradayPoints(
  points: Array<{ time: number; value: number }>,
  meta: Record<string, unknown> | undefined,
  symbol: string,
  tf: string,
  trailingSeconds?: number,
) {
  if (!points.length) return points;

  let trimmed = points;

  if (tf === "1D" && isJseSymbol(symbol)) {
    trimmed = keepLatestJseSession(points);
  }

  if (trailingSeconds && trimmed.length) {
    const latest = Number(trimmed[trimmed.length - 1]?.time || 0);
    const cutoff = latest - trailingSeconds;
    const trailing = trimmed.filter((point) => Number(point.time || 0) >= cutoff);
    if (trailing.length > 1) trimmed = trailing;
  }

  return dropTerminalOutlier(trimmed, symbol, tf);
}

async function handleQuotes(rawTickers: unknown) {
  const tickers = parseTickers(rawTickers);
  if (!tickers.length) return json({ success: false, error: "No tickers provided." }, 400);
  if (tickers.length > 80) return json({ success: false, error: "Too many tickers requested at once." }, 400);
  const normalized = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))].sort();
  const cacheKey = `quotes:${sanitizeCacheKeyPart(normalized.join(","))}`;

  return withMarketCache("quotes", cacheKey, { tickers: normalized }, async () => {
    const quotes: Record<string, unknown> = {};

    await Promise.all(
      normalized.map(async (ticker) => {
        const mapped = TICKER_MAP[ticker];
        if (!mapped) return;
        try {
          const data = await fetchYahooChart(mapped, "1d", "5d");
          const result = data?.chart?.result?.[0];
          const meta = result?.meta;
          if (!meta) return;
          const closes = result?.indicators?.quote?.[0]?.close || [];
          const timestamps = result?.timestamp || [];
          const rawPoints: Array<{ time: number; value: number }> = [];
          for (let i = 0; i < Math.min(closes.length, timestamps.length); i++) {
            if (closes[i] == null) continue;
            rawPoints.push({ time: Number(timestamps[i]), value: Number(Number(closes[i]).toFixed(4)) });
          }
          const cleanedPoints = trimIntradayPoints(rawPoints, meta, mapped, "1D", 24 * 60 * 60);
          const latestPoint = cleanedPoints[cleanedPoints.length - 1]?.value;
          const price = latestPoint ?? meta.regularMarketPrice ?? null;
          const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
          const chg =
            price && prevClose && prevClose > 0
              ? Number((((price - prevClose) / prevClose) * 100).toFixed(2))
              : meta.regularMarketChangePercent != null
                ? Number(Number(meta.regularMarketChangePercent).toFixed(2))
                : null;
          quotes[ticker] = {
            price: price != null ? Number(Number(price).toFixed(4)) : null,
            chg,
            hi52: meta.fiftyTwoWeekHigh != null ? Number(Number(meta.fiftyTwoWeekHigh).toFixed(2)) : null,
            lo52: meta.fiftyTwoWeekLow != null ? Number(Number(meta.fiftyTwoWeekLow).toFixed(2)) : null,
          };
        } catch (_) {}
      }),
    );

    return { success: true, quotes };
  });
}

async function handleChart(ticker: string, tf: string) {
  const mapped = TICKER_MAP[ticker];
  if (!mapped) return json({ success: false, error: "Unknown ticker" }, 400);
  const cacheKey = `chart:${sanitizeCacheKeyPart(`${ticker.toUpperCase()}:${tf}`)}`;
  return withMarketCache("chart", cacheKey, { ticker, tf }, async () => {
    const baseCfg = CHART_CONFIG[tf] || CHART_CONFIG["1M"];
    const cfg =
      tf === "1D" && isJseSymbol(mapped)
        ? { interval: "5m", range: "1d", trailingSeconds: undefined }
        : baseCfg;
    const extractPoints = (result: any, config: { trailingSeconds?: number }) => {
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const timestamps = result?.timestamp || [];
      const points = [];
      for (let i = 0; i < Math.min(closes.length, timestamps.length); i++) {
        if (closes[i] == null) continue;
        points.push({ time: Number(timestamps[i]), value: Number(Number(closes[i]).toFixed(4)) });
      }
      return trimIntradayPoints(points, result?.meta, mapped, tf, config.trailingSeconds);
    };

    const data = await fetchYahooChart(mapped, cfg.interval, cfg.range);
    let result = data?.chart?.result?.[0];
    if (!result) return { success: false, error: "No chart data" };

    let cleanedPoints = extractPoints(result, cfg);

    if (tf === "1D" && isJseSymbol(mapped) && cleanedPoints.length < 2) {
      const fallbackCfg = { interval: "15m", range: "5d", trailingSeconds: undefined };
      try {
        const fallbackData = await fetchYahooChart(mapped, fallbackCfg.interval, fallbackCfg.range);
        const fallbackResult = fallbackData?.chart?.result?.[0];
        if (fallbackResult) {
          result = fallbackResult;
          cleanedPoints = extractPoints(fallbackResult, fallbackCfg);
        }
      } catch (_) {
        // Continue into synthetic fallback below.
      }
    }

    if (tf === "1D" && isJseSymbol(mapped) && cleanedPoints.length < 2) {
      const meta = result?.meta || {};
      const currentPrice = Number(meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose ?? 0);
      const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose ?? currentPrice);
      if (currentPrice > 0) {
        cleanedPoints = buildSyntheticIntradaySeries(currentPrice, previousClose);
      }
    }

    if (cleanedPoints.length < 2) {
      return { success: false, error: "No valid chart data" };
    }

    return { success: true, points: cleanedPoints };
  });
}

function decodeHtml(html: string) {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractArticleParagraphs(html: string) {
  const cleaned = html
    .replace(/<(script|style|noscript|iframe|aside|nav|header|footer|form)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const matches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs: string[] = [];
  for (const match of matches) {
    const text = decodeHtml(match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    if (text.length < 50) continue;
    if (/cookie|subscribe|newsletter|advertisement|sign up|follow us/i.test(text)) continue;
    paragraphs.push(text);
    if (paragraphs.length >= 8) break;
  }
  return paragraphs;
}

async function handleArticle(url: string) {
  if (!/^https?:\/\//i.test(url)) return json({ success: false, error: "Invalid URL" }, 400);
  if (url.length > 2000) return json({ success: false, error: "Article URL is too long." }, 400);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_) {
    return json({ success: false, error: "Invalid URL" }, 400);
  }
  if (!ALLOWED_ARTICLE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return json({ success: false, error: "This article source is not supported." }, 400);
  }
  const html = await fetchText(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const paragraphs = extractArticleParagraphs(html);
  return json({ success: true, paragraphs });
}

function stripCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function extractXmlTag(block: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? stripCdata(match[1]) : "";
}

function parseRssItems(xmlText: string, defaultPublisher: string) {
  const items = [...xmlText.matchAll(/<item\b[\s\S]*?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const articles: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const title = decodeHtml(extractXmlTag(item, "title")).trim();
    if (!title) continue;
    const link = decodeHtml(extractXmlTag(item, "link")).trim();
    const rawDesc = extractXmlTag(item, "description");
    const description = decodeHtml(rawDesc.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).slice(0, 800);
    const publisher = decodeHtml(extractXmlTag(item, "source")).trim() || defaultPublisher;
    const pubDate = extractXmlTag(item, "pubDate").trim();
    const pubTime = Math.floor(new Date(pubDate).getTime() / 1000) || Math.floor(Date.now() / 1000);
    const age = Math.max(0, Math.floor(Date.now() / 1000) - pubTime);
    const time = age < 3600 ? `${Math.max(1, Math.round(age / 60))}m ago` : age < 86400 ? `${Math.round(age / 3600)}h ago` : `${Math.round(age / 86400)}d ago`;
    articles.push({
      uuid: crypto.randomUUID().slice(0, 16),
      title,
      publisher,
      link,
      description,
      time,
      pubTime,
      tickers: [],
      thumbnail: null,
      cat: "Markets",
      hot: /surge|soar|crash|record|rally|plunge|breaking|alert|spike/i.test(title.toLowerCase()),
    });
  }
  return articles;
}

function classifyNewsCategory(title: string) {
  const t = title.toLowerCase();
  if (/bitcoin|ethereum|crypto|blockchain|defi|solana|nft|dogecoin|ripple|altcoin/.test(t)) return "Crypto";
  if (/\bfed\b|federal reserve|inflation|cpi|ppi|gdp|interest rate|recession|unemployment|tariff|trade war|central bank/.test(t)) return "Economy";
  if (/apple|microsoft|google|alphabet|amazon|meta|nvidia|tesla|openai|\bai\b|artificial intelligence|chip|semiconductor|software|cloud|cyber/.test(t)) return "Tech";
  if (/\bearnings\b|quarterly results|revenue|eps|\bebit\b|net income|beat estimates|miss estimates|q[1-4] results|profit warning|guidance/.test(t)) return "Earnings";
  if (/\boil\b|crude|brent|gold|silver|copper|wheat|corn|soybean|\bnatural gas\b|commodity|commodities|wti|opec/.test(t)) return "Commodities";
  if (/\bforex\b|exchange rate|dollar index|\bdxy\b|currency|yen|euro|pound sterling|gbp|eur\/usd|usd\/jpy|fx market|devaluation/.test(t)) return "Forex";
  if (/real estate|housing market|reit|mortgage rate|home price|property market|construction|homebuilder|rental market/.test(t)) return "Real Estate";
  return "Markets";
}

function isHotNewsTitle(title: string) {
  return /surge|soar|crash|record|rally|plunge|breaking|alert|spike|all.time.high|ath|collapse|explode/i.test(title);
}

function formatRelativeNewsTime(pubTime: number) {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - pubTime);
  return age < 3600
    ? `${Math.max(1, Math.round(age / 60))}m ago`
    : age < 86400
      ? `${Math.round(age / 3600)}h ago`
      : `${Math.round(age / 86400)}d ago`;
}

async function fetchGuardianItems(url: string, publisher: string) {
  const payload = await fetchJson(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (payload?.response?.status !== "ok" || !Array.isArray(payload?.response?.results)) return [];
  return payload.response.results.map((item: Record<string, unknown>) => {
    const title = String((item.fields as Record<string, unknown> | undefined)?.headline || item.webTitle || "").trim();
    const pubTime = Math.floor(new Date(String(item.webPublicationDate || "")).getTime() / 1000) || Math.floor(Date.now() / 1000);
    const description = String((item.fields as Record<string, unknown> | undefined)?.trailText || "").replace(/<[^>]+>/g, "").trim().slice(0, 800);
    return {
      uuid: crypto.randomUUID().slice(0, 16),
      title,
      publisher,
      link: String(item.webUrl || ""),
      description,
      time: formatRelativeNewsTime(pubTime),
      pubTime,
      tickers: [],
      thumbnail: (item.fields as Record<string, unknown> | undefined)?.thumbnail || null,
      cat: classifyNewsCategory(title),
      hot: isHotNewsTitle(title),
    };
  }).filter((item: Record<string, unknown>) => String(item.title || ""));
}

async function handleNews() {
  return withMarketCache("news", "news:feed:top30", {}, async () => {
    const seen = new Set<string>();
    const combined: Array<Record<string, unknown>> = [];
    const sourceDiagnostics: Array<Record<string, unknown>> = [];
    const cutoff72h = Math.floor(Date.now() / 1000) - 72 * 60 * 60;

    await Promise.all(
      NEWS_FEEDS.map(async ({ id, url, pub, kind }) => {
        try {
          const items = kind === "guardian"
            ? await fetchGuardianItems(url, pub)
            : parseRssItems(await fetchText(url, {
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; RSS reader/1.0)",
                Accept: "application/rss+xml, application/xml, text/xml, */*",
              },
            }), pub);
          let accepted = 0;
          for (const item of items) {
            const key = String(item.title || "").trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            if (Number(item.pubTime || 0) < cutoff72h) continue;
            seen.add(key);
            combined.push(item);
            accepted++;
          }
          sourceDiagnostics.push({ id, publisher: pub, kind, fetched: items.length, accepted, status: accepted > 0 ? "ok" : "empty" });
        } catch (error) {
          sourceDiagnostics.push({
            id,
            publisher: pub,
            kind,
            fetched: 0,
            accepted: 0,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown source failure",
          });
        }
      }),
    );

    combined.sort((a, b) => Number(b.pubTime || 0) - Number(a.pubTime || 0));
    return {
      success: true,
      articles: combined.slice(0, 30),
      fetchedAt: Math.floor(Date.now() / 1000),
      diagnostics: {
        sourceCount: NEWS_FEEDS.length,
        totalArticles: combined.length,
        sources: sourceDiagnostics,
      },
    };
  });
}

async function fetchQuoteSummary(symbol: string) {
  return fetchJson(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://finance.yahoo.com",
      },
    },
  );
}

async function fetchEarningsCalendar(from: string, to: string) {
  const stockTickers = Object.keys(NAME_MAP);
  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs = Math.floor(new Date(to).getTime() / 1000);
  const events: Array<Record<string, unknown>> = [];

  await Promise.all(
    stockTickers.map(async (ticker) => {
      const mapped = TICKER_MAP[ticker];
      if (!mapped) return;
      try {
        const data = await fetchQuoteSummary(mapped);
        const earnings = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
        if (!earnings?.earningsDate) return;
        for (const entry of earnings.earningsDate) {
          const ts = Number(entry?.raw || 0);
          if (!ts || ts < fromTs || ts > toTs) continue;
          const revRaw = Number(earnings?.revenueAverage?.raw || 0);
          const revEst =
            revRaw >= 1e12 ? `$${(revRaw / 1e12).toFixed(1)}T` :
            revRaw >= 1e9 ? `$${(revRaw / 1e9).toFixed(1)}B` :
            revRaw >= 1e6 ? `$${(revRaw / 1e6).toFixed(1)}M` :
            null;
          events.push({
            ticker,
            name: NAME_MAP[ticker] || ticker,
            date: new Date(ts * 1000).toISOString().slice(0, 10),
            ts,
            epsEst: earnings?.earningsAverage?.raw != null ? Number(Number(earnings.earningsAverage.raw).toFixed(2)) : null,
            epsLow: earnings?.earningsLow?.raw != null ? Number(Number(earnings.earningsLow.raw).toFixed(2)) : null,
            epsHigh: earnings?.earningsHigh?.raw != null ? Number(Number(earnings.earningsHigh.raw).toFixed(2)) : null,
            revEst,
          });
          break;
        }
      } catch (_) {}
    }),
  );

  events.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  return events;
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (d.getUTCMonth() === monthIndex) {
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === nth) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return new Date(d);
}

function pushIfInRange(events: Array<Record<string, unknown>>, date: Date, fromTs: number, toTs: number, payload: Record<string, unknown>) {
  const ts = Math.floor(date.getTime() / 1000);
  if (ts < fromTs || ts > toTs) return;
  events.push({ date: date.toISOString().slice(0, 10), ts, ...payload });
}

function generateEconomicEvents(from: string, to: string) {
  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs = Math.floor(new Date(to).getTime() / 1000);
  const events: Array<Record<string, unknown>> = [];

  const fedDates = [
    "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  ];
  for (const d of fedDates) {
    const dt = new Date(`${d}T00:00:00Z`);
    pushIfInRange(events, dt, fromTs, toTs, {
      type: "fed",
      impact: "high",
      title: "FOMC Rate Decision",
      desc: "Federal Reserve interest rate decision and policy statement.",
      assets: ["TLT", "GLD", "UUP", "SPY"],
    });
  }

  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const nfp = nthWeekdayOfMonth(year, month, 5, 1);
    const cpi = nthWeekdayOfMonth(year, month, 4, 2);
    const ppi = nthWeekdayOfMonth(year, month, 4, 3);

    if (nfp) pushIfInRange(events, nfp, fromTs, toTs, {
      type: "macro",
      impact: "high",
      title: `Non-Farm Payrolls — ${monthLabel}`,
      desc: "Monthly US jobs report with payroll growth, unemployment, and wage trends.",
      assets: ["SPY", "TLT", "UUP", "GLD"],
    });
    if (cpi) pushIfInRange(events, cpi, fromTs, toTs, {
      type: "macro",
      impact: "high",
      title: `CPI Inflation Report — ${monthLabel}`,
      desc: "Consumer Price Index inflation release.",
      assets: ["SPY", "TLT", "GLD", "UUP"],
    });
    if (ppi) pushIfInRange(events, ppi, fromTs, toTs, {
      type: "macro",
      impact: "medium",
      title: `PPI Inflation Report — ${monthLabel}`,
      desc: "Producer Price Index inflation release.",
      assets: ["SPY", "TLT", "GLD"],
    });

    const confidence = lastWeekdayOfMonth(year, month, 2);
    pushIfInRange(events, confidence, fromTs, toTs, {
      type: "macro",
      impact: "medium",
      title: `Consumer Confidence — ${monthLabel}`,
      desc: "Conference Board consumer confidence survey.",
      assets: ["XLY", "SPY", "XRT"],
    });

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  events.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  return events;
}

async function handleCalendar(from: string, to: string) {
  const cacheKey = `calendar:${sanitizeCacheKeyPart(`${from}:${to}`)}`;
  return withMarketCache("calendar", cacheKey, { from, to }, async () => {
    const [earnings, economic] = await Promise.all([
      fetchEarningsCalendar(from, to),
      Promise.resolve(generateEconomicEvents(from, to)),
    ]);
    return { success: true, earnings, economic };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const payload = await req.json();
    const action = String(payload?.action || "").trim();
    const ip = getClientIp(req);
    const throttleResponse = await consumeRateLimit(action, `${ip}:${action}`).catch(async (error) => {
      const message = error instanceof Error ? error.message : "Rate limit check failed.";
      await logFunctionEvent("market-data", "error", ip, "rate_limit_check_failed", message, { action });
      throw error;
    });
    if (throttleResponse) {
      await logFunctionEvent("market-data", "warn", ip, "rate_limited", "Public market-data rate limit reached", { action });
      return throttleResponse;
    }

    if (action === "quotes") return await handleQuotes(payload?.tickers);
    if (action === "chart") return await handleChart(String(payload?.ticker || "").trim(), String(payload?.tf || "1M"));
    if (action === "article") return await handleArticle(String(payload?.url || "").trim());
    if (action === "news") return await handleNews();
    if (action === "calendar") {
      const from = String(payload?.from || new Date().toISOString().slice(0, 10));
      const to = String(payload?.to || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
      return await handleCalendar(from, to);
    }

    await logFunctionEvent("market-data", "warn", ip, "unknown_action", "Unknown market-data action requested", { action });
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    await logFunctionEvent("market-data", "error", getClientIp(req), "request_failed", message);
    return json({ error: message }, 500);
  }
});
