// ═══════════════════════════════════════════════════════════════════════════
// STATE — declared first to avoid temporal dead zone errors
// ═══════════════════════════════════════════════════════════════════════════

let currentUser   = null;          // {id, name, email, username, tier, finbot_credits} when logged in
let dbPortfolio   = [];            // [{ticker,name,shares,avg_cost}]
let watchlistSet  = new Set();     // Set of tickers on watchlist
let dbSavedReports = null;         // null = guest/fallback (localStorage), array = logged-in (DB)
let dbSavedReportsLoading = false; // true while fetch is in-flight
let alertsMap     = {};            // { ticker: [{id,target,direction,triggered}] }
let compareMode   = false;         // true when compare mode is active
let compareSet    = new Set();     // tickers selected for compare (max 3)
let compareTF     = '1M';          // active compare timeframe
let compareChart  = null;          // LW chart instance for compare overlay
let activeIndicators = new Set();  // 'rsi' | 'macd' | 'boll'
let indicatorCharts  = {};         // { rsi: chart, macd: chart }
let alertDirection = 'above';      // current alert modal direction
let portSort   = 'value';          // 'value' | 'pnl_pct' | 'ticker'
let portFilter = 'all';            // 'all' | 'gainers' | 'losers'
const TAB_PAGE_MAP = {
  news: 'index.html',
  markets: 'markets.html',
  finbot: 'finbot.html',
  portfolio: 'portfolio.html',
  saved: 'saved.html',
  learn: 'learn.html',
  calendar: 'calendar.html',
  settings: 'settings.html',
};

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

function genPrices(base, n, vol = 0.015, trend = 0.0002) {
  const out = []; let p = base * (0.82 + Math.random() * 0.12);
  for (let i = 0; i < n; i++) {
    p = Math.max(p + p * (trend + (Math.random() - 0.48) * vol), base * 0.5);
    out.push(parseFloat(p.toFixed(2)));
  }
  out[out.length - 1] = base;
  return out;
}

function dayLabels(n) {
  const o = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now); d.setMinutes(now.getMinutes() - i * 5);
    o.push(d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'));
  }
  return o;
}
function weekLabels(n) { const d = ['Mon','Tue','Wed','Thu','Fri']; return Array.from({length:n}, (_,i) => d[i%5]); }
function monthLabels(n) {
  const o = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    o.push((d.getMonth()+1) + '/' + d.getDate());
  }
  return o;
}
function yearLabels() { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; }

const RAW_MARKETS = [
  // ── Indices ──────────────────────────────────────────────────────────────
  { name:'S&P 500',      ticker:'SPX',  val:5204.34,  chg:+0.87,  mktcap:'—',      pe:'24.1', vol:'3.2B',  hi52:'5264.85', lo52:'4103.78', sector:'Index' },
  { name:'NASDAQ 100',   ticker:'NDX',  val:18265.11, chg:+1.23,  mktcap:'—',      pe:'31.4', vol:'2.8B',  hi52:'18465.20',lo52:'12543.86',sector:'Index' },
  { name:'Dow Jones',    ticker:'DJI',  val:38906.72, chg:-0.14,  mktcap:'—',      pe:'20.3', vol:'1.9B',  hi52:'39282.00',lo52:'32327.20',sector:'Index' },
  { name:'FTSE 100',     ticker:'UKX',  val:7952.62,  chg:+0.32,  mktcap:'—',      pe:'12.8', vol:'890M',  hi52:'8047.00', lo52:'7215.76', sector:'Index' },
  { name:'Nikkei 225',   ticker:'N225', val:38487.90, chg:+0.56,  mktcap:'—',      pe:'18.2', vol:'1.4B',  hi52:'41087.75',lo52:'30487.45',sector:'Index' },
  { name:'DAX',          ticker:'DAX',  val:17837.40, chg:+0.41,  mktcap:'—',      pe:'16.8', vol:'980M',  hi52:'18039.00',lo52:'14630.22',sector:'Index' },
  { name:'Hang Seng',    ticker:'HSI',  val:16512.92, chg:-0.68,  mktcap:'—',      pe:'9.1',  vol:'1.2B',  hi52:'22700.85',lo52:'14794.16',sector:'Index' },
  { name:'ASX 200',      ticker:'AXJO', val:7748.20,  chg:+0.28,  mktcap:'—',      pe:'17.4', vol:'740M',  hi52:'7910.50', lo52:'6904.90', sector:'Index' },
  // ── Tech ─────────────────────────────────────────────────────────────────
  { name:'Apple',        ticker:'AAPL', val:189.30,   chg:+0.92,  mktcap:'$2.93T', pe:'28.4', vol:'58M',   hi52:'199.62', lo52:'143.90',  sector:'Tech' },
  { name:'Microsoft',    ticker:'MSFT', val:415.80,   chg:+1.45,  mktcap:'$3.09T', pe:'36.2', vol:'22M',   hi52:'430.82', lo52:'309.45',  sector:'Tech' },
  { name:'NVIDIA',       ticker:'NVDA', val:880.50,   chg:+3.20,  mktcap:'$2.17T', pe:'72.1', vol:'45M',   hi52:'974.00', lo52:'222.97',  sector:'Tech' },
  { name:'Amazon',       ticker:'AMZN', val:182.70,   chg:+0.67,  mktcap:'$1.90T', pe:'58.7', vol:'48M',   hi52:'189.77', lo52:'118.35',  sector:'Tech' },
  { name:'Alphabet',     ticker:'GOOGL',val:178.10,   chg:+1.10,  mktcap:'$2.21T', pe:'26.3', vol:'25M',   hi52:'193.31', lo52:'115.83',  sector:'Tech' },
  { name:'Meta',         ticker:'META', val:490.30,   chg:+2.05,  mktcap:'$1.25T', pe:'32.8', vol:'18M',   hi52:'531.49', lo52:'274.38',  sector:'Tech' },
  { name:'Netflix',      ticker:'NFLX', val:627.80,   chg:+0.83,  mktcap:'$270B',  pe:'44.2', vol:'4.2M',  hi52:'700.06', lo52:'344.73',  sector:'Tech' },
  { name:'AMD',          ticker:'AMD',  val:178.40,   chg:+2.60,  mktcap:'$288B',  pe:'56.3', vol:'58M',   hi52:'227.30', lo52:'93.12',   sector:'Tech' },
  { name:'Broadcom',     ticker:'AVGO', val:1340.00,  chg:+1.40,  mktcap:'$620B',  pe:'28.1', vol:'3.1M',  hi52:'1438.17',lo52:'629.00',  sector:'Tech' },
  { name:'Salesforce',   ticker:'CRM',  val:302.40,   chg:-0.55,  mktcap:'$292B',  pe:'42.1', vol:'5.4M',  hi52:'326.38', lo52:'193.61',  sector:'Tech' },
  { name:'Adobe',        ticker:'ADBE', val:569.20,   chg:+0.78,  mktcap:'$256B',  pe:'28.7', vol:'3.3M',  hi52:'638.25', lo52:'411.07',  sector:'Tech' },
  { name:'Intel',        ticker:'INTC', val:43.10,    chg:-1.20,  mktcap:'$183B',  pe:'29.4', vol:'48M',   hi52:'51.28',  lo52:'29.30',   sector:'Tech' },
  { name:'Tesla',        ticker:'TSLA', val:178.20,   chg:-1.80,  mktcap:'$567B',  pe:'44.3', vol:'92M',   hi52:'299.29', lo52:'152.37',  sector:'Auto' },
  { name:'Toyota',       ticker:'TM',   val:212.60,   chg:+0.34,  mktcap:'$280B',  pe:'10.2', vol:'1.8M',  hi52:'232.04', lo52:'143.48',  sector:'Auto' },
  // ── Finance ──────────────────────────────────────────────────────────────
  { name:'JPMorgan',     ticker:'JPM',  val:195.40,   chg:+0.60,  mktcap:'$561B',  pe:'11.8', vol:'9.2M',  hi52:'205.88', lo52:'129.12',  sector:'Finance' },
  { name:'Goldman Sachs',ticker:'GS',   val:411.80,   chg:+0.43,  mktcap:'$137B',  pe:'14.2', vol:'2.4M',  hi52:'432.07', lo52:'287.28',  sector:'Finance' },
  { name:'Visa',         ticker:'V',    val:277.50,   chg:+0.55,  mktcap:'$570B',  pe:'30.1', vol:'6.0M',  hi52:'290.96', lo52:'224.76',  sector:'Finance' },
  { name:'Mastercard',   ticker:'MA',   val:458.20,   chg:+0.72,  mktcap:'$428B',  pe:'36.4', vol:'3.2M',  hi52:'476.60', lo52:'352.87',  sector:'Finance' },
  { name:'Berkshire B',  ticker:'BRK.B',val:368.10,   chg:+0.18,  mktcap:'$810B',  pe:'8.6',  vol:'3.8M',  hi52:'384.89', lo52:'302.46',  sector:'Finance' },
  // ── Healthcare ───────────────────────────────────────────────────────────
  { name:'UnitedHealth',  ticker:'UNH', val:497.30,   chg:+0.30,  mktcap:'$457B',  pe:'22.3', vol:'3.1M',  hi52:'554.42', lo52:'445.12',  sector:'Healthcare' },
  { name:'J&J',           ticker:'JNJ', val:152.60,   chg:-0.40,  mktcap:'$366B',  pe:'15.4', vol:'7.5M',  hi52:'175.92', lo52:'144.95',  sector:'Healthcare' },
  { name:'Pfizer',        ticker:'PFE', val:28.40,    chg:-0.70,  mktcap:'$160B',  pe:'13.2', vol:'29M',   hi52:'42.47',  lo52:'25.20',   sector:'Healthcare' },
  // ── Energy ───────────────────────────────────────────────────────────────
  { name:'ExxonMobil',   ticker:'XOM',  val:112.80,   chg:+0.45,  mktcap:'$449B',  pe:'12.8', vol:'16M',   hi52:'123.75', lo52:'95.77',   sector:'Energy' },
  { name:'Chevron',      ticker:'CVX',  val:152.30,   chg:-0.30,  mktcap:'$290B',  pe:'12.1', vol:'9.7M',  hi52:'176.09', lo52:'139.62',  sector:'Energy' },
  // ── Consumer ─────────────────────────────────────────────────────────────
  { name:'Walmart',      ticker:'WMT',  val:60.20,    chg:+0.55,  mktcap:'$483B',  pe:'28.4', vol:'18M',   hi52:'67.09',  lo52:'44.97',   sector:'Consumer' },
  { name:'Coca-Cola',    ticker:'KO',   val:59.40,    chg:-0.15,  mktcap:'$256B',  pe:'22.1', vol:'12M',   hi52:'64.99',  lo52:'51.98',   sector:'Consumer' },
  { name:"McDonald's",   ticker:'MCD',  val:295.60,   chg:+0.28,  mktcap:'$214B',  pe:'23.7', vol:'3.2M',  hi52:'317.90', lo52:'245.95',  sector:'Consumer' },
  { name:'Nike',         ticker:'NKE',  val:97.40,    chg:-0.82,  mktcap:'$149B',  pe:'26.5', vol:'9.8M',  hi52:'123.24', lo52:'88.66',   sector:'Consumer' },
  // ── Industrial ───────────────────────────────────────────────────────────
  { name:'Boeing',       ticker:'BA',   val:188.40,   chg:-1.40,  mktcap:'$116B',  pe:'—',    vol:'7.6M',  hi52:'267.54', lo52:'159.00',  sector:'Industrial' },
  { name:'Caterpillar',  ticker:'CAT',  val:348.80,   chg:+0.92,  mktcap:'$175B',  pe:'17.3', vol:'2.3M',  hi52:'386.60', lo52:'219.63',  sector:'Industrial' },
  // ── Commodities ──────────────────────────────────────────────────────────
  { name:'Gold',         ticker:'XAU',  val:2312.40,  chg:+0.55,  mktcap:'—',      pe:'—',    vol:'182K',  hi52:'2431.00',lo52:'1810.46', sector:'Commodity' },
  { name:'Silver',       ticker:'XAG',  val:27.14,    chg:+0.82,  mktcap:'—',      pe:'—',    vol:'380K',  hi52:'32.50',  lo52:'20.68',   sector:'Commodity' },
  { name:'Oil (WTI)',    ticker:'CL1',  val:82.14,    chg:-1.02,  mktcap:'—',      pe:'—',    vol:'1.1M',  hi52:'95.03',  lo52:'63.64',   sector:'Commodity' },
  { name:'Natural Gas',  ticker:'NG1',  val:1.82,     chg:-2.40,  mktcap:'—',      pe:'—',    vol:'2.4M',  hi52:'3.64',   lo52:'1.54',    sector:'Commodity' },
  { name:'Copper',       ticker:'HG1',  val:4.05,     chg:+1.10,  mktcap:'—',      pe:'—',    vol:'320K',  hi52:'4.35',   lo52:'3.52',    sector:'Commodity' },
  { name:'Platinum',     ticker:'PL1',  val:962.00,   chg:-0.55,  mktcap:'—',      pe:'—',    vol:'78K',   hi52:'1096.40',lo52:'838.80',  sector:'Commodity' },
  { name:'Wheat',        ticker:'ZW1',  val:559.50,   chg:-0.35,  mktcap:'—',      pe:'—',    vol:'210K',  hi52:'652.00', lo52:'490.25',  sector:'Commodity' },
  // ── Crypto ───────────────────────────────────────────────────────────────
  { name:'Bitcoin',      ticker:'BTC',  val:66752,    chg:-5.26,  mktcap:'$1.32T', pe:'—',    vol:'$38B',  hi52:'126198', lo52:'60074',   sector:'Crypto' },
  { name:'Ethereum',     ticker:'ETH',  val:1820.00,  chg:-4.80,  mktcap:'$219B',  pe:'—',    vol:'$12B',  hi52:'4720',   lo52:'1520',    sector:'Crypto' },
  { name:'Solana',       ticker:'SOL',  val:118.40,   chg:-6.20,  mktcap:'$55B',   pe:'—',    vol:'$3.8B', hi52:'294',    lo52:'58.00',   sector:'Crypto' },
  { name:'XRP',          ticker:'XRP',  val:2.1800,   chg:-4.10,  mktcap:'$125B',  pe:'—',    vol:'$4.2B', hi52:'3.84',   lo52:'0.42',    sector:'Crypto' },
  { name:'BNB',          ticker:'BNB',  val:568.40,   chg:-3.80,  mktcap:'$82B',   pe:'—',    vol:'$1.2B', hi52:'785.00', lo52:'242.00',  sector:'Crypto' },
  { name:'Cardano',      ticker:'ADA',  val:0.6840,   chg:-5.40,  mktcap:'$24B',   pe:'—',    vol:'$580M', hi52:'1.24',   lo52:'0.28',    sector:'Crypto' },
  { name:'Dogecoin',     ticker:'DOGE', val:0.1620,   chg:-5.80,  mktcap:'$24B',   pe:'—',    vol:'$1.8B', hi52:'0.48',   lo52:'0.065',   sector:'Crypto' },
  { name:'Avalanche',    ticker:'AVAX', val:19.80,    chg:-6.10,  mktcap:'$8.2B',  pe:'—',    vol:'$380M', hi52:'62.00',  lo52:'12.00',   sector:'Crypto' },
  { name:'Chainlink',    ticker:'LINK', val:12.40,    chg:-4.90,  mktcap:'$7.8B',  pe:'—',    vol:'$420M', hi52:'24.00',  lo52:'6.20',    sector:'Crypto' },
  { name:'Polygon (POL)', ticker:'MATIC',val:0.2840,   chg:-5.20,  mktcap:'$2.6B',  pe:'—',    vol:'$180M', hi52:'0.89',   lo52:'0.14',    sector:'Crypto' },

  // ── JSE (Johannesburg Stock Exchange) ─────────────────────────────────────
  { name:'Naspers',           ticker:'NPN',  val:3180.00, chg:-0.82, mktcap:'R1.2T',  pe:'—',    vol:'R1.4B',  hi52:'3490.00', lo52:'2650.00', sector:'Tech',      exchange:'JSE', currency:'ZAR' },
  { name:'Prosus',            ticker:'PRX',  val:1248.50, chg:-0.64, mktcap:'R980B',  pe:'—',    vol:'R890M',  hi52:'1380.00', lo52:'1020.00', sector:'Tech',      exchange:'JSE', currency:'ZAR' },
  { name:'BHP Group',         ticker:'BHG',  val:558.30,  chg:+1.24, mktcap:'R1.8T',  pe:'14.2', vol:'R620M',  hi52:'630.00',  lo52:'440.00',  sector:'Mining',    exchange:'JSE', currency:'ZAR' },
  { name:'Anglo American',    ticker:'AGL',  val:492.40,  chg:+2.10, mktcap:'R670B',  pe:'18.6', vol:'R540M',  hi52:'578.00',  lo52:'372.00',  sector:'Mining',    exchange:'JSE', currency:'ZAR' },
  { name:'Glencore',          ticker:'GLN',  val:118.50,  chg:+0.94, mktcap:'R820B',  pe:'9.8',  vol:'R480M',  hi52:'148.00',  lo52:'94.00',   sector:'Mining',    exchange:'JSE', currency:'ZAR' },
  { name:'Richemont',         ticker:'CFR',  val:1862.00, chg:+1.56, mktcap:'R1.1T',  pe:'21.4', vol:'R760M',  hi52:'2080.00', lo52:'1540.00', sector:'Consumer',  exchange:'JSE', currency:'ZAR' },
  { name:'FirstRand',         ticker:'FSR',  val:74.20,   chg:+0.54, mktcap:'R420B',  pe:'12.1', vol:'R390M',  hi52:'84.00',   lo52:'60.50',   sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Standard Bank',     ticker:'SBK',  val:214.60,  chg:+0.78, mktcap:'R350B',  pe:'10.8', vol:'R310M',  hi52:'238.00',  lo52:'176.00',  sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Capitec Bank',      ticker:'CPI',  val:2640.00, chg:+1.10, mktcap:'R310B',  pe:'24.6', vol:'R280M',  hi52:'2890.00', lo52:'2140.00', sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Absa Group',        ticker:'ABG',  val:192.80,  chg:+0.42, mktcap:'R230B',  pe:'9.2',  vol:'R245M',  hi52:'218.00',  lo52:'162.00',  sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Nedbank Group',     ticker:'NED',  val:282.50,  chg:+0.30, mktcap:'R185B',  pe:'9.6',  vol:'R190M',  hi52:'310.00',  lo52:'228.00',  sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Shoprite Holdings', ticker:'SHP',  val:284.20,  chg:-0.36, mktcap:'R170B',  pe:'22.4', vol:'R210M',  hi52:'316.00',  lo52:'218.00',  sector:'Consumer',  exchange:'JSE', currency:'ZAR' },
  { name:'MTN Group',         ticker:'MTN',  val:134.40,  chg:-1.20, mktcap:'R245B',  pe:'8.4',  vol:'R320M',  hi52:'178.00',  lo52:'112.00',  sector:'Telecom',   exchange:'JSE', currency:'ZAR' },
  { name:'Sanlam',            ticker:'SLM',  val:86.50,   chg:+0.64, mktcap:'R185B',  pe:'14.2', vol:'R175M',  hi52:'98.00',   lo52:'70.00',   sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Discovery',         ticker:'DSY',  val:178.30,  chg:+0.90, mktcap:'R92B',   pe:'18.8', vol:'R145M',  hi52:'198.00',  lo52:'142.00',  sector:'Healthcare',exchange:'JSE', currency:'ZAR' },
  { name:'Old Mutual',        ticker:'OMU',  val:14.20,   chg:-0.70, mktcap:'R68B',   pe:'11.6', vol:'R130M',  hi52:'16.80',   lo52:'11.40',   sector:'Finance',   exchange:'JSE', currency:'ZAR' },
  { name:'Sasol',             ticker:'SOLJ', val:142.80,  chg:+1.80, mktcap:'R90B',   pe:'7.2',  vol:'R160M',  hi52:'198.00',  lo52:'128.00',  sector:'Energy',    exchange:'JSE', currency:'ZAR' },
  { name:'AngloGold Ashanti', ticker:'ANG',  val:484.60,  chg:+3.40, mktcap:'R98B',   pe:'16.4', vol:'R185M',  hi52:'540.00',  lo52:'318.00',  sector:'Mining',    exchange:'JSE', currency:'ZAR' },
  { name:'Mondi',             ticker:'MNP',  val:324.50,  chg:+0.22, mktcap:'R58B',   pe:'13.8', vol:'R92M',   hi52:'368.00',  lo52:'264.00',  sector:'Industrial',exchange:'JSE', currency:'ZAR' },
  { name:'Impala Platinum',   ticker:'IMP',  val:96.40,   chg:+2.60, mktcap:'R74B',   pe:'8.6',  vol:'R148M',  hi52:'140.00',  lo52:'74.00',   sector:'Mining',    exchange:'JSE', currency:'ZAR' },
];

const TF_CONFIG = {
  '1D': { pts: 78,  lbl: dayLabels },
  '1W': { pts: 35,  lbl: weekLabels },
  '1M': { pts: 30,  lbl: monthLabels },
  '3M': { pts: 90,  lbl: monthLabels },
  '1Y': { pts: 12,  lbl: () => yearLabels() },
};
// Seconds between each generated data point per timeframe
const TF_STEP = { '1D': 300, '1W': 3600, '1M': 86400, '3M': 86400, '1Y': 2592000 };
const TIMEFRAMES = ['1D','1W','1M','3M','1Y'];

const MARKETS = RAW_MARKETS.map(m => {
  const charts = {};
  const nowSec = Math.floor(Date.now() / 1000);
  TIMEFRAMES.forEach(tf => {
    const c    = TF_CONFIG[tf];
    const step = TF_STEP[tf];
    const prices = genPrices(m.val, c.pts, tf === '1D' ? 0.003 : 0.015);
    // Use real Unix timestamps so the chart time axis shows correct dates
    charts[tf] = prices.map((v, i) => ({
      time:  nowSec - (c.pts - 1 - i) * step,
      value: v,
    }));
  });
  return { ...m, charts, _initVal: m.val };
});

// Fallback static news (shown while live data loads or on error)
let liveNews = [];
let newsLastFetched = 0;
let newsFetchedAt = null;
let newsFilter = 'All';
let newsSearch = '';
let newsTimeRange = '72h';          // '1h' | 'today' | 'week' | '72h'
let newsShowBookmarks = false;      // show only bookmarked articles
// Read/Unread tracking — persisted in localStorage
let readArticles = new Set(JSON.parse(localStorage.getItem('ie_read_articles') || '[]'));
// Bookmarked articles — {uuid: articleObject}
let bookmarkedArticles = JSON.parse(localStorage.getItem('ie_bookmarks') || '{}');
// News alerts — [{id, keyword, createdAt}]
let newsAlerts = JSON.parse(localStorage.getItem('ie_news_alerts') || '[]');
// UUIDs of articles that matched an alert (unacknowledged)
let newsAlertMatches = new Set(JSON.parse(localStorage.getItem('ie_alert_matches') || '[]'));

const HOLDINGS = [
  { ticker:'AAPL', name:'Apple Inc.', shares:12, cost:178.40, cur:189.30, alloc:28 },
  { ticker:'MSFT', name:'Microsoft Corp.', shares:5, cost:380.00, cur:415.80, alloc:26 },
  { ticker:'NVDA', name:'NVIDIA Corp.', shares:3, cost:750.00, cur:880.50, alloc:22 },
  { ticker:'TSLA', name:'Tesla Inc.', shares:8, cost:210.00, cur:178.20, alloc:13 },
  { ticker:'AMZN', name:'Amazon.com Inc.', shares:4, cost:168.00, cur:182.70, alloc:11 },
];

const PORT_HIST = [{t:'Jan',v:8200},{t:'Feb',v:8800},{t:'Mar',v:8400},{t:'Apr',v:9100},{t:'May',v:9600},{t:'Jun',v:9200},{t:'Jul',v:9900},{t:'Aug',v:10200},{t:'Sep',v:9800},{t:'Oct',v:10500},{t:'Nov',v:10900},{t:'Dec',v:11240}];
const ALLOC_COLORS = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444'];
const CAT_COLORS = {
  Markets:'#10b981', Economy:'#3b82f6', Tech:'#8b5cf6', Crypto:'#f59e0b',
  Earnings:'#ec4899', Commodities:'#d97706', Forex:'#06b6d4', 'Real Estate':'#84cc16'
};

const FINBOT_MODES = [
  { id:'screener', icon:'📊', title:'Stock Screener', sub:'Jake', col:'#10b981',
    desc:"I'm Jake — been hunting stocks for 15 years. Tell me your budget and risk appetite and I'll dig through thousands of companies to hand you a shortlist worth your time." },
  { id:'dcf', icon:'📈', title:'DCF Valuation', sub:'Emily', col:'#3b82f6',
    desc:"I'm Emily — I live in spreadsheets so you don't have to. Give me a ticker and I'll build the full cash flow model and tell you exactly what it's actually worth." },
  { id:'risk', icon:'🛡', title:'Risk Assessment', sub:'Marcus', col:'#f59e0b',
    desc:"I'm Marcus — I've seen every kind of portfolio blow up. Drop your holdings and I'll map every hidden risk before the market finds it for you." },
  { id:'earnings', icon:'📋', title:'Earnings Preview', sub:'Priya', col:'#8b5cf6',
    desc:"I'm Priya — earnings season is my favourite time of year. I'll break down the history, set the bar, and tell you exactly how to play the announcement." },
  { id:'builder', icon:'🏗', title:'Portfolio Builder', sub:'Leo', col:'#06b6d4',
    desc:"I'm Leo — I build portfolios people actually stick to. Share your goals and I'll put together a real plan with specific ETFs, a timeline, and a strategy that fits your life." },
  { id:'technical', icon:'📉', title:'Technical Analysis', sub:'Zoe', col:'#ec4899',
    desc:"I'm Zoe — I read charts the way others read books. Give me a ticker and I'll map the trend, the key levels, and tell you exactly where to get in and out." },
];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function fmtPrice(v) {
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

// Currency conversion — all market values stored in USD, converted on display
const CURRENCY_CONFIG = {
  USD: { symbol: '$',   rate: 1.00   },
  GBP: { symbol: '£',   rate: 0.79   },
  EUR: { symbol: '€',   rate: 0.92   },
  JPY: { symbol: '¥',   rate: 151.5  },
  CAD: { symbol: 'C$',  rate: 1.36   },
  AUD: { symbol: 'A$',  rate: 1.53   },
  ZAR: { symbol: 'R',   rate: 18.63  },
};
function curCfg() { return CURRENCY_CONFIG[loadSettings().currency] || CURRENCY_CONFIG.USD; }

function fmtMoney(v) {
  if (loadSettings().hideBalances) return '••••••';
  const cfg = curCfg();
  return cfg.symbol + (v * cfg.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Per-unit price with currency conversion (for avg cost / current price in portfolio)
function fmtUnitPrice(v) {
  if (loadSettings().hideBalances) return '••••';
  const cfg = curCfg();
  const c = v * cfg.rate;
  if (c >= 10000) return cfg.symbol + c.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return cfg.symbol + c.toFixed(2);
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function parseMd(text) {
  return text.split('\n').map(line => {
    if (line.startsWith('#### ')) return `<h4>${inlineMd(line.slice(5))}</h4>`;
    if (line.startsWith('# ')) return `<h1>${inlineMd(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${inlineMd(line.slice(3))}</h2>`;
    if (line.startsWith('### ')) return `<h3>${inlineMd(line.slice(4))}</h3>`;
    if (line.startsWith('- ') || line.startsWith('* ')) return `<div class="bullet"><span>${inlineMd(line.slice(2))}</span></div>`;
    if (/^\d+\. /.test(line)) return `<div class="bullet"><span>${inlineMd(line.replace(/^\d+\. /, ''))}</span></div>`;
    if (line.startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim());
      if (!cells.length || cells.every(c => /^[-: ]+$/.test(c))) return '';
      return `<div class="md-table" style="grid-template-columns:repeat(${cells.length},1fr)">${cells.map(c => `<div class="td">${inlineMd(c.trim())}</div>`).join('')}</div>`;
    }
    if (line.toLowerCase().includes('legal disclaimer') || line.toLowerCase().includes('informational and educational'))
      return `<p class="disclaimer">${inlineMd(line.replace(/^\*|\*$/g, ''))}</p>`;
    if (line.trim() === '' || line === '---') return '<div style="height:6px"></div>';
    return `<p>${inlineMd(line)}</p>`;
  }).join('');
}

function inlineMd(t) {
  return escHtml(t)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// ═══════════════════════════════════════════════════════════════════════════
// LIGHTWEIGHT CHARTS HELPER
// ═══════════════════════════════════════════════════════════════════════════

function createMiniChart(container, data, color, height = 32) {
  if (!container || !data.length) return null;
  container.innerHTML = '';
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 64, height,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'transparent' },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: { mode: 0 },
    rightPriceScale: { visible: false },
    timeScale: { visible: false },
    handleScroll: false, handleScale: false,
  });
  const series = chart.addAreaSeries({
    lineColor: color, lineWidth: 2,
    topColor: color + '40', bottomColor: color + '05',
    crosshairMarkerVisible: false, priceLineVisible: false,
    lastValueVisible: false,
  });
  series.setData(data.map((d, i) => ({ time: d.time ?? (i + 1), value: d.value })));
  chart.timeScale().fitContent();
  return chart;
}

function convertChartData(data) {
  const rate = curCfg().rate;
  if (rate === 1) return data;
  return data.map(d => ({ ...d, value: d.value * rate }));
}

function createFullChart(container, data, color, height = 300) {
  if (!container || !data.length) return null;
  container.innerHTML = '';
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth, height,
    layout: { background: { type: 'solid', color: '#0c1320' }, textColor: '#64748b', fontFamily: 'DM Mono, monospace' },
    grid: { vertLines: { color: '#ffffff08' }, horzLines: { color: '#ffffff08' } },
    crosshair: {
      mode: 1,
      vertLine: { color: color + '80', width: 1, style: 0, labelBackgroundColor: color },
      horzLine: { color: color + '80', width: 1, style: 0, labelBackgroundColor: color },
    },
    rightPriceScale: { borderVisible: false, textColor: '#475569', scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: {
      borderVisible: false, timeVisible: true, secondsVisible: false,
      tickMarkFormatter: (t) => {
        const d = new Date(t * 1000);
        const now = new Date();
        const diffDays = Math.round((now - d) / 86400000);
        if (diffDays < 1) return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
        if (diffDays < 60) return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        return d.toLocaleDateString('en-GB', { month:'short', year:'2-digit' });
      },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true },
    handleScale:  { mouseWheel: false, pinch: true },
  });
  const cfg = curCfg();
  const series = chart.addAreaSeries({
    lineColor: color, lineWidth: 2,
    topColor: color + '28', bottomColor: color + '00',
    priceLineVisible: true, lastValueVisible: true,
    priceLineColor: color, priceLineWidth: 1, priceLineStyle: 2,
    crosshairMarkerRadius: 5, crosshairMarkerBackgroundColor: color,
    crosshairMarkerBorderColor: '#0c1320',
    priceFormat: {
      type: 'custom',
      formatter: (v) => {
        const c = curCfg();
        if (v >= 100000) return c.symbol + (v / 1000).toFixed(1) + 'k';
        if (v >= 10000)  return c.symbol + Math.round(v).toLocaleString('en-US');
        if (v >= 1)      return c.symbol + v.toFixed(2);
        return c.symbol + v.toFixed(4);
      },
    },
  });
  const baseline = data[0].value;
  chart.addLineSeries({
    color: '#334155', lineWidth: 1, lineStyle: 3,
    priceLineVisible: false, lastValueVisible: false,
    crosshairMarkerVisible: false,
  }).setData(data.map((d, i) => ({ time: d.time ?? (i + 1), value: baseline })));
  series.setData(data.map((d, i) => ({ time: d.time ?? (i + 1), value: d.value })));
  chart.timeScale().fitContent();
  return chart;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

const navBtns = document.querySelectorAll('.nav button');
const tabPanels = document.querySelectorAll('.tab-content');

function switchTab(id) {
  if (id === 'settings' && !currentUser) {
    document.getElementById('auth-overlay').classList.remove('hidden');
    showAuthTab('login');
    return;
  }
  navBtns.forEach(b => {
    const isActive = b.dataset.tab === id;
    b.classList.toggle('active', isActive);
    b.querySelector('svg').setAttribute('stroke', isActive ? '#10b981' : '#94a3b8');
  });
  tabPanels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
  if (id === 'news') renderNews();
  if (id === 'markets') renderMarkets();
  if (id === 'learn') renderLearn();
  if (id === 'calendar') renderCalendar();
  if (id === 'portfolio') { renderPortfolio(); if (currentUser && !dbPortfolio.length) loadPortfolioFromDB().then(renderPortfolio); }
  if (id === 'settings') renderSettings();
  if (id === 'finbot') renderFinBot();
  if (id === 'saved') { savedFilter = 'all'; savedFolderFilter = ''; savedTagFilter = ''; renderSaved(); }
  const targetPage = TAB_PAGE_MAP[id];
  if (targetPage && window.location.pathname.split('/').pop() !== targetPage) {
    try { history.replaceState(null, '', targetPage); } catch (e) {}
  }
}

navBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ═══════════════════════════════════════════════════════════════════════════
// NEWS TAB
// ═══════════════════════════════════════════════════════════════════════════

// ── Client-side news helpers ──────────────────────────────────────────────────
function _newsCateg(title) {
  const t = title.toLowerCase();
  if (/bitcoin|ethereum|crypto|blockchain|defi|solana|nft|dogecoin|ripple|altcoin/.test(t)) return 'Crypto';
  if (/\bfed\b|federal reserve|inflation|cpi|ppi|gdp|interest rate|recession|unemployment|tariff|trade war|central bank/.test(t)) return 'Economy';
  if (/apple|microsoft|google|alphabet|amazon|meta|nvidia|tesla|openai|\bai\b|artificial intelligence|chip|semiconductor|software|cloud|cyber/.test(t)) return 'Tech';
  if (/\bearnings\b|quarterly results|revenue|eps|\bebit\b|net income|beat estimates|miss estimates|q[1-4] results|profit warning|guidance/.test(t)) return 'Earnings';
  if (/\boil\b|crude|brent|gold|silver|copper|wheat|corn|soybean|\bnatural gas\b|commodity|commodities|wti|opec/.test(t)) return 'Commodities';
  if (/\bforex\b|exchange rate|dollar index|\bdxy\b|currency|yen|euro|pound sterling|gbp|eur\/usd|usd\/jpy|fx market|devaluation/.test(t)) return 'Forex';
  if (/real estate|housing market|reit|mortgage rate|home price|property market|construction|homebuilder|rental market/.test(t)) return 'Real Estate';
  return 'Markets';
}
function _newsHot(title) {
  return /surge|soar|crash|record|rally|plunge|breaking|alert|spike|all.time.high|ath|collapse|explode/i.test(title);
}
function _newsTime(isoOrSql) {
  const pubTime = isoOrSql ? Math.floor(new Date(isoOrSql).getTime() / 1000) : 0;
  const age = Math.max(0, Date.now() / 1000 - pubTime);
  const timeStr = age < 3600 ? Math.max(1, Math.round(age / 60)) + 'm ago'
                : age < 86400 ? Math.round(age / 3600) + 'h ago'
                : Math.round(age / 86400) + 'd ago';
  return { pubTime, timeStr };
}

// Primary: The Guardian Open API — free "test" key, CORS-enabled, pure JSON
async function fetchGuardianNews() {
  const sections = ['business', 'money', 'technology'];
  const articles = [];
  await Promise.allSettled(sections.map(async section => {
    try {
      const url = `https://content.guardianapis.com/${section}?api-key=test&show-fields=headline,thumbnail,trailText&page-size=20&order-by=newest`;
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      if (d.response?.status !== 'ok') return;
      for (const item of (d.response.results || [])) {
        const headline = item.fields?.headline || item.webTitle;
        const { pubTime, timeStr } = _newsTime(item.webPublicationDate);
        articles.push({
          uuid: item.id.split('/').pop().slice(0, 20),
          title: headline,
          publisher: 'The Guardian',
          link: item.webUrl,
          description: (item.fields?.trailText || '').replace(/<[^>]+>/g, ''),
          time: timeStr,
          pubTime,
          tickers: [],
          thumbnail: item.fields?.thumbnail || null,
          cat: _newsCateg(headline),
          hot: _newsHot(headline),
        });
      }
    } catch(e) {}
  }));
  return articles;
}

// Fallback: rss2json.com — CORS proxy for financial RSS feeds
async function fetchRss2JsonNews() {
  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?count=20&rss_url=';
  const feeds = [
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', pub: 'CNBC' },
    { url: 'https://feeds.marketwatch.com/marketwatch/topstories/',  pub: 'MarketWatch' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', pub: 'New York Times' },
  ];
  const articles = [], seen = new Set();
  await Promise.allSettled(feeds.map(async ({ url, pub }) => {
    try {
      const r = await fetch(RSS2JSON + encodeURIComponent(url));
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== 'ok' || !Array.isArray(d.items)) return;
      for (const item of d.items) {
        if (!item.title) continue;
        const key = item.title.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const { pubTime, timeStr } = _newsTime(item.pubDate);
        articles.push({
          uuid: btoa(encodeURIComponent(item.title)).slice(0, 16),
          title: item.title,
          publisher: pub,
          link: item.link || '',
          description: (item.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 400),
          time: timeStr,
          pubTime,
          tickers: [],
          thumbnail: item.thumbnail || null,
          cat: _newsCateg(item.title),
          hot: _newsHot(item.title),
        });
      }
    } catch(e) {}
  }));
  return articles;
}

async function fetchNewsClientSide() {
  // Run both sources in parallel; Guardian is primary, rss2json is fallback
  const [guardianResult, rssResult] = await Promise.allSettled([
    fetchGuardianNews(),
    fetchRss2JsonNews(),
  ]);

  const seen = new Set();
  const all = [];
  for (const result of [guardianResult, rssResult]) {
    if (result.status !== 'fulfilled') continue;
    for (const a of result.value) {
      const key = a.title.trim().toLowerCase();
      if (!seen.has(key)) { seen.add(key); all.push(a); }
    }
  }
  const cutoff = Math.floor(Date.now() / 1000) - 72 * 60 * 60;
  all.sort((a, b) => b.pubTime - a.pubTime);
  return all.filter(a => a.pubTime >= cutoff).slice(0, 30);
}

async function fetchLiveNews(force = false) {
  const now = Date.now();
  if (!force && liveNews.length && (now - newsLastFetched) < 5 * 60 * 1000) return;

  // 1. Try server-side PHP (works when server has outbound internet access)
  try {
    const r = await fetch('prices.php?action=news&count=30');
    const d = await r.json();
    if (d.success && d.articles && d.articles.length) {
      const cutoff72h = Math.floor(Date.now() / 1000) - 72 * 60 * 60;
      liveNews = d.articles.filter(a => (a.pubTime || 0) >= cutoff72h).slice(0, 30);
      newsLastFetched = now;
      newsFetchedAt = new Date();
      checkNewsAlertsForArticles(liveNews);
      renderNewsContent();
      return;
    }
  } catch(e) {}

  // 2. Fall back to client-side RSS fetching (works regardless of server network)
  try {
    const articles = await fetchNewsClientSide();
    if (articles.length) {
      liveNews = articles;
      newsLastFetched = now;
      newsFetchedAt = new Date();
      checkNewsAlertsForArticles(liveNews);
    }
  } catch(e) {}

  renderNewsContent();
}

function renderNews(filter, search) {
  if (filter !== undefined) newsFilter = filter;
  if (search !== undefined) newsSearch = search;
  const cats = ['All','Markets','Economy','Tech','Crypto','Earnings','Commodities','Forex','Real Estate'];
  const el = document.getElementById('tab-news');
  const timeRanges = [
    { id:'1h',    label:'Last hour' },
    { id:'today', label:'Today' },
    { id:'week',  label:'This week' },
    { id:'72h',   label:'3 days' },
  ];

  // If only search changed and the structure is already built, just re-filter articles
  if (search !== undefined && filter === undefined && document.getElementById('news-search-input')) {
    renderNewsContent();
    return;
  }

  const myStocksActive = newsFilter === 'My Stocks';
  const bookmarksActive = newsShowBookmarks;
  const alertCount = newsAlertMatches.size;

  el.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h2>News Feed</h2><p>Live market insights & analysis</p></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <button onclick="openNewsAlertsModal()" title="Manage alerts"
          style="position:relative;display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--radius-xs);
                 background:${alertCount>0?'#ef444418':'var(--border)'};color:${alertCount>0?'var(--red)':'var(--muted)'};
                 font-size:11px;font-weight:600;border:none;cursor:pointer;transition:all .2s">
          🔔 Alerts${alertCount > 0 ? ` <span style="background:#ef4444;color:#fff;border-radius:8px;padding:1px 5px;font-size:9px;font-weight:800">${alertCount}</span>` : ''}
        </button>
        <button class="news-refresh-btn" id="refresh-btn" onclick="refreshNews()" title="Refresh news">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          Refresh
        </button>
      </div>
    </div>
    <div class="filter-row">
      ${cats.map(c => `<button class="news-filter-btn ${newsFilter===c&&!myStocksActive&&!bookmarksActive?'active':''}" onclick="setNewsFilter('${c}')">${c}</button>`).join('')}
      <button class="news-filter-btn ${myStocksActive?'mystocks-active':''}" onclick="setNewsFilter('My Stocks')" title="Articles mentioning your portfolio & watchlist tickers">⭐ My Stocks</button>
      <button class="news-filter-btn ${bookmarksActive?'bookmarks-active':''}" onclick="toggleNewsBookmarksView()">🔖 Bookmarks${Object.keys(bookmarkedArticles).length > 0 ? ' ('+Object.keys(bookmarkedArticles).length+')' : ''}</button>
    </div>
    <div class="time-range-row">
      <span style="font-size:11px;font-weight:700;color:var(--faint);flex-shrink:0">Time:</span>
      ${timeRanges.map(r => `<button class="time-filter-btn ${newsTimeRange===r.id?'active':''}" onclick="setNewsTimeRange('${r.id}')">${r.label}</button>`).join('')}
    </div>
    <input class="news-search" id="news-search-input" type="text" placeholder="Search news…" value="${escHtml(newsSearch)}"
      oninput="renderNews(undefined,this.value)">
    <div id="news-articles-container"></div>
  `;
  renderNewsContent();
  // Fetch live if needed
  if (!liveNews.length || (Date.now() - newsLastFetched) > 5 * 60 * 1000) {
    showNewsSkeletons();
    fetchLiveNews();
  }
}

function showNewsSkeletons() {
  const c = document.getElementById('news-articles-container');
  if (!c) return;
  c.innerHTML = Array(6).fill(0).map(() => `
    <div class="news-skeleton">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div class="skel-line skel-sm"></div><div class="skel-line" style="width:15%"></div>
      </div>
      <div class="skel-line skel-lg"></div>
      <div class="skel-line skel-md"></div>
    </div>
  `).join('');
}

function renderNewsContent() {
  const c = document.getElementById('news-articles-container');
  if (!c) return;
  if (!liveNews.length && !newsShowBookmarks) {
    c.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--faint);font-size:13px">Loading latest news…</div>';
    return;
  }

  // Time range cutoff
  const cutoff = getNewsTimeRangeCutoff();
  let source = liveNews.filter(n => (n.pubTime || 0) >= cutoff).slice(0, 60);

  // Bookmarks view — show saved articles regardless of time range
  if (newsShowBookmarks) {
    source = Object.values(bookmarkedArticles).sort((a, b) => (b.pubTime||0) - (a.pubTime||0));
  } else if (newsFilter === 'My Stocks') {
    // My Stocks: articles mentioning any portfolio or watchlist ticker
    const myTickers = new Set([
      ...(dbPortfolio.map(h => h.ticker.toUpperCase())),
      ...[...watchlistSet].map(t => t.toUpperCase()),
    ]);
    if (myTickers.size === 0) {
      c.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--faint);font-size:13px">Add stocks to your portfolio or watchlist to use this filter.</div>';
      return;
    }
    source = source.filter(n => {
      const text = (n.title + ' ' + (n.description||'')).toUpperCase();
      return [...myTickers].some(t => text.includes(t));
    });
  } else if (newsFilter !== 'All') {
    source = source.filter(n => n.cat === newsFilter);
  }

  if (newsSearch.trim()) {
    const q = newsSearch.toLowerCase();
    source = source.filter(n => n.title.toLowerCase().includes(q) || (n.publisher||'').toLowerCase().includes(q));
  }

  const lastUpdatedStr = newsFetchedAt
    ? `Updated ${newsFetchedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`
    : 'Fetching…';

  const list = source;

  c.innerHTML = `
    <div class="live-banner" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge">${newsShowBookmarks ? '🔖' : 'LIVE'}</span>
        <span style="font-weight:500;font-size:13px">${liveNews.length ? list.length + ' articles' : 'Loading…'}</span>
      </div>
      <span style="font-size:11px;color:rgba(255,255,255,0.7)">${lastUpdatedStr}</span>
    </div>
    ${list.length === 0 ? `<div style="text-align:center;padding:40px;color:var(--faint);font-size:13px">${newsShowBookmarks ? 'No bookmarked articles yet — click 🔖 on any card to save it.' : 'No articles found'}</div>` : ''}
    <div class="news-cols">
    ${list.map(n => {
      // Ensure article is accessible by index — add to liveNews if from bookmarks only
      let actualIdx = liveNews.indexOf(n);
      if (actualIdx === -1 && n.uuid) {
        // Try to find by UUID in liveNews
        actualIdx = liveNews.findIndex(a => a.uuid === n.uuid);
        if (actualIdx === -1) {
          liveNews.push(n);
          actualIdx = liveNews.length - 1;
        }
      }
      const isRead = readArticles.has(n.uuid);
      const isBookmarked = !!bookmarkedArticles[n.uuid];
      const isAlert = newsAlertMatches.has(n.uuid);
      const catColor = CAT_COLORS[n.cat] || '#10b981';
      return `
      <div class="card news-card${isRead?' read':''}" style="break-inside:avoid;margin-bottom:12px;${isAlert?'border:1.5px solid #ef444440;':''}" onclick="openNewsArticle(${actualIdx},true)">
        ${isAlert ? '<div style="font-size:10px;font-weight:800;color:#ef4444;margin-bottom:6px;letter-spacing:.04em">🔔 ALERT MATCH</div>' : ''}
        ${n.thumbnail ? `<img class="news-thumb" src="${escHtml(n.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="meta">
          <span class="cat" style="background:${catColor}18;color:${catColor}">${n.cat}</span>
          <div style="display:flex;align-items:center;gap:5px">
            ${n.hot ? '<span>🔥</span>' : ''}
            <span style="font-size:11px;color:var(--faint)">${n.time}</span>
            <button class="news-bookmark-btn${isBookmarked?' saved':''}" title="${isBookmarked?'Remove bookmark':'Bookmark'}"
              onclick="event.stopPropagation();toggleNewsBookmark('${escHtml(n.uuid)}',${actualIdx})">${isBookmarked?'🔖':'🏷️'}</button>
          </div>
        </div>
        <h3 style="${isRead?'color:var(--muted)':''}">${escHtml(n.title)}</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span class="news-source">${escHtml(n.publisher||'')}</span>
          <span style="font-size:11px;color:${isRead?'var(--faint)':'var(--green)'};font-weight:600">${isRead?'Read ✓':'Read more →'}</span>
        </div>
        <button onclick="event.stopPropagation();confirmAndAnalyzeNews(${actualIdx})"
          style="margin-top:8px;width:100%;padding:7px;border-radius:10px;background:#7c3aed14;color:#a78bfa;
                 font-size:11px;font-weight:700;border:1px solid #7c3aed30;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s"
          onmouseenter="this.style.background='#7c3aed22'" onmouseleave="this.style.background='#7c3aed14'">
          🤖 Analyze with FinBot <span style="font-size:10px;font-weight:600;opacity:.7">· 2 credits</span>
        </button>
      </div>`;
    }).join('')}
    </div>
  `;
}

function refreshNews() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');
  liveNews = [];
  newsLastFetched = 0;
  showNewsSkeletons();
  fetchLiveNews(true).then(() => {
    if (btn) btn.classList.remove('spinning');
  });
}

const articleCache = {};  // url → paragraphs[]

// ── News Feature Helpers ────────────────────────────────────────────────────

// Returns Unix timestamp cutoff based on selected time range
function getNewsTimeRangeCutoff() {
  const now = Math.floor(Date.now() / 1000);
  switch (newsTimeRange) {
    case '1h':    return now - 60 * 60;
    case 'today': {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }
    case 'week':  return now - 7 * 24 * 60 * 60;
    default:      return now - 72 * 60 * 60;
  }
}

function setNewsTimeRange(range) {
  newsTimeRange = range;
  renderNews();
}

function setNewsFilter(filter) {
  newsFilter = filter;
  newsShowBookmarks = false;
  renderNews();
}

function toggleNewsBookmarksView() {
  newsShowBookmarks = !newsShowBookmarks;
  if (newsShowBookmarks) newsFilter = 'All';
  renderNews(); // Rebuilds full UI with correct active state on the Bookmarks button
}

// Toggle bookmark for an article by UUID
function toggleNewsBookmark(uuid, idx) {
  if (!uuid) return;
  const n = liveNews[idx] || Object.values(bookmarkedArticles).find(a => a.uuid === uuid);
  if (!n) return;
  if (bookmarkedArticles[uuid]) {
    delete bookmarkedArticles[uuid];
    showToast('Bookmark removed.');
  } else {
    bookmarkedArticles[uuid] = n;
    showToast('Article bookmarked! View in Bookmarks.');
  }
  try { localStorage.setItem('ie_bookmarks', JSON.stringify(bookmarkedArticles)); } catch(e) {}
  // Re-render: if in bookmark view, full rebuild; otherwise just re-filter articles
  if (newsShowBookmarks) renderNews();
  else renderNewsContent();
}

// ── News Alerts ─────────────────────────────────────────────────────────────

function openNewsAlertsModal() {
  renderNewsAlertsList();
  document.getElementById('news-alerts-modal-bg').classList.remove('hidden');
  const inp = document.getElementById('news-alert-input');
  if (inp) inp.focus();
  // Clear the alert match badge since user is reviewing them
  if (newsAlertMatches.size > 0) clearNewsAlertMatches();
}

function closeNewsAlertsModal() {
  document.getElementById('news-alerts-modal-bg').classList.add('hidden');
}

function renderNewsAlertsList() {
  const el = document.getElementById('news-alerts-list');
  if (!el) return;
  if (!newsAlerts.length) {
    el.innerHTML = '<p style="font-size:12px;color:var(--faint);padding:8px 0">No alerts yet. Add a ticker or keyword below.</p>';
    return;
  }
  el.innerHTML = newsAlerts.map(a => {
    const isTicker = /^[A-Z]{1,5}$/.test(a.keyword.trim().toUpperCase());
    return `
    <div class="alert-item">
      <span class="kw">${escHtml(a.keyword)}</span>
      <span class="type-badge ${isTicker?'ticker':'keyword'}">${isTicker?'Ticker':'Keyword'}</span>
      <button class="alert-remove-btn" onclick="removeNewsAlert('${escHtml(a.id)}')" title="Remove alert">✕</button>
    </div>`;
  }).join('');
}

function addNewsAlert() {
  const inp = document.getElementById('news-alert-input');
  if (!inp) return;
  const kw = inp.value.trim();
  if (!kw) return;
  if (newsAlerts.some(a => a.keyword.toLowerCase() === kw.toLowerCase())) {
    showToast('Alert already exists for "' + kw + '"');
    return;
  }
  const alert = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,5), keyword: kw, createdAt: Date.now() };
  newsAlerts.push(alert);
  try { localStorage.setItem('ie_news_alerts', JSON.stringify(newsAlerts)); } catch(e) {}
  inp.value = '';
  renderNewsAlertsList();
  // Check existing articles against the new alert
  checkNewsAlertsForArticles(liveNews);
  showToast('Alert added for "' + kw + '"');
}

function removeNewsAlert(id) {
  newsAlerts = newsAlerts.filter(a => a.id !== id);
  try { localStorage.setItem('ie_news_alerts', JSON.stringify(newsAlerts)); } catch(e) {}
  renderNewsAlertsList();
  updateNewsAlertBadge();
}

// Check a batch of articles against all alerts; updates newsAlertMatches
function checkNewsAlertsForArticles(articles) {
  if (!newsAlerts.length || !articles.length) return;
  let changed = false;
  for (const article of articles) {
    if (!article.uuid) continue;
    const text = (article.title + ' ' + (article.description || '')).toLowerCase();
    for (const alert of newsAlerts) {
      if (text.includes(alert.keyword.toLowerCase())) {
        if (!newsAlertMatches.has(article.uuid)) {
          newsAlertMatches.add(article.uuid);
          changed = true;
        }
      }
    }
  }
  if (changed) {
    try { localStorage.setItem('ie_alert_matches', JSON.stringify([...newsAlertMatches])); } catch(e) {}
    updateNewsAlertBadge();
  }
}

function updateNewsAlertBadge() {
  const badge = document.getElementById('news-alert-badge');
  if (!badge) return;
  const count = newsAlertMatches.size;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
  // Update the alert count button in the news header if currently visible
  const alertBtn = document.querySelector('#tab-news button[onclick*="openNewsAlertsModal"]');
  if (alertBtn) {
    alertBtn.style.background = count > 0 ? '#ef444418' : 'var(--border)';
    alertBtn.style.color = count > 0 ? 'var(--red)' : 'var(--muted)';
    alertBtn.innerHTML = `🔔 Alerts${count > 0 ? ` <span style="background:#ef4444;color:#fff;border-radius:8px;padding:1px 5px;font-size:9px;font-weight:800">${count}</span>` : ''}`;
  }
}

// Clear alert matches when user clicks Alerts button (they've seen them)
function clearNewsAlertMatches() {
  newsAlertMatches.clear();
  try { localStorage.removeItem('ie_alert_matches'); } catch(e) {}
  updateNewsAlertBadge();
}

function openNewsArticle(idx, fromLive) {
  const source = liveNews;
  const n = source[idx];
  if (!n) return;

  // Mark as read
  if (n.uuid && !readArticles.has(n.uuid)) {
    readArticles.add(n.uuid);
    try {
      const arr = JSON.parse(localStorage.getItem('ie_read_articles') || '[]');
      arr.push(n.uuid);
      // Keep last 500 read articles
      localStorage.setItem('ie_read_articles', JSON.stringify(arr.slice(-500)));
    } catch(e) {}
    // Update the card in place to dim it without full re-render
    const cards = document.querySelectorAll('.news-card');
    cards.forEach(card => {
      if (card.querySelector('h3') && card.querySelector('h3').textContent === n.title) {
        card.classList.add('read');
      }
    });
  }

  const overlay = document.getElementById('news-overlay');
  const inner   = document.getElementById('news-sheet-inner');
  const cleanTickers = (n.tickers || []).filter(t => !t.startsWith('^'));
  const articleLink = n.link || `https://www.google.com/search?q=${encodeURIComponent(n.title)}&tbm=nws`;

  function renderSheet(bodyHtml) {
    const isBookmarked = n.uuid && !!bookmarkedArticles[n.uuid];
    inner.innerHTML = `
      <div class="news-sheet-meta">
        <span class="news-sheet-pub">${escHtml(n.publisher || '')}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="news-sheet-time">${escHtml(n.time)}</span>
          <button id="sheet-bookmark-btn" class="news-bookmark-btn${isBookmarked?' saved':''}"
            title="${isBookmarked?'Remove bookmark':'Bookmark this article'}"
            onclick="toggleNewsBookmark('${n.uuid ? escHtml(n.uuid) : ''}',${idx});document.getElementById('sheet-bookmark-btn').textContent=bookmarkedArticles['${n.uuid ? escHtml(n.uuid) : ''}']?'🔖':'🏷️';document.getElementById('sheet-bookmark-btn').classList.toggle('saved',!!bookmarkedArticles['${n.uuid ? escHtml(n.uuid) : ''}'])"
            style="font-size:18px">${isBookmarked?'🔖':'🏷️'}</button>
        </div>
      </div>
      ${n.thumbnail ? `<img class="news-sheet-img" src="${escHtml(n.thumbnail)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="news-sheet-title">${escHtml(n.title)}</div>
      ${cleanTickers.length ? `<div class="news-sheet-tickers">${cleanTickers.map(t=>`<span class="news-ticker-chip">${escHtml(t)}</span>`).join('')}</div>` : ''}
      <div id="news-body-box" style="margin:14px 0 16px">${bodyHtml}</div>
      <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">2 credits</strong></p>
      <button onclick="confirmAndAnalyzeNews(${idx})"
        style="width:100%;padding:14px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#7c3aed,#6d28d9);
               color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;margin-bottom:10px;
               display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s"
        onmouseenter="this.style.opacity='.9'" onmouseleave="this.style.opacity='1'">
        🤖 Analyze with FinBot
      </button>
      <a class="news-btn-primary" href="${escHtml(articleLink)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">
        Read Full Article on ${escHtml(n.publisher || 'Publisher')} ↗
      </a>
    `;
  }

  overlay.classList.remove('hidden');

  // 1. Use RSS description if available (instant, no fetch needed)
  if (n.description && n.description.length > 60) {
    renderSheet(`<p style="font-size:13px;color:var(--text2);line-height:1.75">${escHtml(n.description)}</p>`);
    return;
  }

  // 2. Use cached full-article scrape
  if (n.link && articleCache[n.link]) {
    renderSheet(buildArticleHtml(articleCache[n.link]));
    return;
  }

  // 3. No description and no cache — show spinner and scrape
  renderSheet(`<div style="display:flex;align-items:center;gap:8px;padding:8px 0;color:var(--faint);font-size:13px">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;flex-shrink:0"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
    Loading article…
  </div>`);

  if (!n.link) {
    document.getElementById('news-body-box').innerHTML = `<p style="font-size:13px;color:var(--faint)">Click the link below to read this article.</p>`;
    return;
  }

  fetch(`prices.php?action=article&url=${encodeURIComponent(n.link)}`)
    .then(r => r.json())
    .then(d => {
      const box = document.getElementById('news-body-box');
      if (!box) return;
      if (d.success && d.paragraphs && d.paragraphs.length) {
        articleCache[n.link] = d.paragraphs;
        box.innerHTML = buildArticleHtml(d.paragraphs);
      } else {
        box.innerHTML = `<p style="font-size:13px;color:var(--faint)">Preview unavailable — click the link below to read on the publisher's site.</p>`;
      }
    })
    .catch(() => {
      const box = document.getElementById('news-body-box');
      if (box) box.innerHTML = `<p style="font-size:13px;color:var(--faint)">Preview unavailable — click the link below to read on the publisher's site.</p>`;
    });
}

function buildArticleHtml(paragraphs) {
  return paragraphs.map(p => `<p style="font-size:13px;color:var(--text2);line-height:1.75;margin-bottom:12px">${escHtml(p)}</p>`).join('');
}

function closeNewsOverlay() {
  document.getElementById('news-overlay').classList.add('hidden');
}

// ── FinBot Article Analysis ────────────────────────────────────────────────
let finbotNewsState = { idx: null, result: null, savedId: null };

async function analyzeArticleWithFinBot(idx) {
  const n = liveNews[idx];
  if (!n) return;

  // Tier/credit guard
  if (!currentUser) {
    document.getElementById('auth-overlay').classList.remove('hidden');
    showAuthTab('login');
    return;
  }
  if ((currentUser.tier || 'free') === 'free') {
    switchTab('finbot');
    return;
  }
  if ((currentUser.finbot_credits ?? 0) <= 0) {
    switchTab('finbot');
    return;
  }

  // Reset state for new analysis
  finbotNewsState = { idx, result: null, savedId: null };

  const modal   = document.getElementById('finbot-news-modal');
  const content = document.getElementById('finbot-news-content');
  modal.classList.remove('hidden');

  const articleLink = n.link || `https://www.google.com/search?q=${encodeURIComponent(n.title)}&tbm=nws`;
  const body = articleCache[n.link]
    ? articleCache[n.link].join('\n\n')
    : (n.description || '');

  const prompt = `You are FinBot, an expert financial analyst AI. A user wants you to analyze the following news article and break it down clearly.

**Article Title:** ${n.title}
**Publisher:** ${n.publisher || 'Unknown'}
${body ? `\n**Article Content:**\n${body.slice(0, 4000)}` : ''}

Please provide a structured breakdown covering:
1. **Quick Summary** — 2-3 sentence plain-English overview of what happened and why it matters
2. **What happened** — Key facts and context
3. **Market impact** — Which assets, sectors, or indices are affected and how
4. **Investor takeaways** — What this means for investors (bullish/bearish signals)
5. **Risks & caveats** — What could make this more or less significant
6. **Relevant tickers** — Any stocks, ETFs, or assets worth watching

Keep the tone professional but accessible. Use Markdown formatting. End with exactly this legal disclaimer on its own line:

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`;

  // Loading state
  content.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;padding:48px 20px;gap:14px">
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#6d28d9);
                  display:flex;align-items:center;justify-content:center;font-size:24px">🤖</div>
      <p style="font-weight:800;font-size:16px;color:var(--text)">Analyzing article…</p>
      <p style="font-size:12px;color:var(--faint);text-align:center;line-height:1.6">FinBot is reading and breaking down<br>this article for you</p>
      <div class="loading-dots" style="margin-top:4px">
        ${[0,1,2].map(i=>`<span style="background:#7c3aed;animation:bd 1.4s ease-in-out ${i*0.2}s infinite"></span>`).join('')}
      </div>
    </div>`;

  try {
    const resp = await fetch('api.php', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, request_type: 'news' }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `Error ${resp.status}`);
    if (data.credits_remaining !== undefined && currentUser) {
      currentUser.finbot_credits = data.credits_remaining;
      updateHeaderUser();
    }
    const text = data.text ?? '';
    finbotNewsState.result = text;
    renderFinBotNewsResult(idx, text, articleLink, n);
  } catch (e) {
    content.innerHTML = `
      <div style="padding:20px">
        <div class="error-box">
          <p style="font-weight:700;font-size:14px;color:#dc2626">Analysis Failed</p>
          <p style="margin:6px 0 12px;font-size:13px;color:#b91c1c;line-height:1.5">${escHtml(e.message || 'Please try again.')}</p>
          <button onclick="analyzeArticleWithFinBot(${idx})"
            style="background:var(--dark);color:#fff;border-radius:10px;padding:10px 20px;font-weight:700;font-size:13px">
            Retry
          </button>
        </div>
      </div>`;
  }
}

function renderFinBotNewsResult(idx, text, articleLink, n) {
  const content = document.getElementById('finbot-news-content');
  const isSaved = !!finbotNewsState.savedId;
  content.innerHTML = `
    <div style="padding:20px 0 8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <span style="font-size:20px">🤖</span>
        <div>
          <p style="font-weight:800;font-size:14px;color:var(--text)">FinBot Analysis</p>
          <p style="font-size:11px;color:#a78bfa;font-weight:600">AI Financial Analyst</p>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:700;color:#10b981;background:#10b98115;padding:3px 10px;border-radius:20px">✓ Complete</span>
          <button id="finbot-news-save-btn" onclick="saveNewsAnalysis(${idx})"
            style="padding:5px 12px;border-radius:10px;${isSaved ? 'background:#10b98122;color:#10b981' : 'background:var(--border);color:var(--text)'};
                   font-size:12px;font-weight:700;border:none;cursor:pointer;white-space:nowrap">
            ${isSaved ? '🔖 Saved' : '🔖 Save'}
          </button>
        </div>
      </div>
      <div class="result-content" style="font-size:13.5px;line-height:1.75">${parseMd(text)}</div>
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px">
        <button onclick="saveNewsAnalysis(${idx})" id="finbot-news-save-btn-big"
          style="width:100%;padding:13px;border-radius:12px;${isSaved ? 'background:#10b98122;color:#10b981;border:1.5px solid #10b981' : 'background:#7c3aed18;color:#a78bfa;border:1.5px solid #7c3aed40'};
                 font-size:13px;font-weight:700;cursor:pointer;transition:all .2s">
          ${isSaved ? '🔖 View in Saved Reports →' : '🔖 Save Report'}
        </button>
        <a href="${escHtml(articleLink)}" target="_blank" rel="noopener"
          style="width:100%;padding:13px;border-radius:12px;background:var(--green);color:#fff;
                 font-size:13px;font-weight:700;text-align:center;text-decoration:none;display:block;box-sizing:border-box">
          Read Full Article on ${escHtml(n.publisher || 'Publisher')} ↗
        </a>
      </div>
    </div>`;
}

async function saveNewsAnalysis(idx) {
  if (finbotNewsState.savedId) { closeFinBotNewsModal(); switchTab('saved'); return; }
  if (!finbotNewsState.result) return;
  const n = liveNews[idx];
  if (!n) return;
  const articleLink = n.link || `https://www.google.com/search?q=${encodeURIComponent(n.title)}&tbm=nws`;
  const report = {
    id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    modeId:       'news',
    modeTitle:    n.title,
    modeSub:      n.publisher || 'News',
    modeCol:      '#7c3aed',
    modeIcon:     '📰',
    content:      finbotNewsState.result,
    articleLink,
    savedAt:      Date.now(),
  };
  await persistReport(report);
  finbotNewsState.savedId = report.id;
  showToast('Analysis saved! View it in the Saved tab.');
  // Re-render to flip buttons to "Saved" state
  renderFinBotNewsResult(idx, finbotNewsState.result, articleLink, n);
}

function closeFinBotNewsModal() {
  document.getElementById('finbot-news-modal').classList.add('hidden');
}

// ── Credit Confirmation Popup ──────────────────────────────────────────────
function showCreditConfirm(credits, label, onConfirm) {
  const remaining = currentUser ? (currentUser.finbot_credits ?? 0) : 0;
  document.getElementById('credit-confirm-title').textContent =
    `Use ${credits} Credit${credits !== 1 ? 's' : ''}?`;
  document.getElementById('credit-confirm-msg').textContent =
    `${label} will use ${credits} of your ${remaining} remaining credit${remaining !== 1 ? 's' : ''}.`;
  document.getElementById('credit-confirm-ok').onclick = () => {
    closeCreditConfirm();
    onConfirm();
  };
  document.getElementById('credit-confirm-modal').classList.remove('hidden');
}

function closeCreditConfirm() {
  document.getElementById('credit-confirm-modal').classList.add('hidden');
}

function confirmAndRunFinBot(modeId) {
  showCreditConfirm(5, 'This analysis', () => runFinBot(modeId));
}

function confirmAndAnalyzeNews(idx) {
  showCreditConfirm(2, 'This news analysis', () => analyzeArticleWithFinBot(idx));
}

function analyseNewsWithFinBot(headline) {
  closeNewsOverlay();
  switchTab('finbot');
  setTimeout(() => {
    const promptArea = document.querySelector('#finbot-form textarea, #finbot-custom-input');
    if (promptArea) {
      promptArea.value = 'Analyse the investment implications of this news headline: "' + headline + '"';
      promptArea.dispatchEvent(new Event('input'));
    }
  }, 300);
}

// Auto-refresh news every 5 minutes (retry even if previous fetch failed)
setInterval(() => {
  const newsTab = document.getElementById('tab-news');
  if (newsTab && newsTab.classList.contains('active')) {
    fetchLiveNews();
  }
}, 5 * 60 * 1000);

// Auto-refresh live prices every 60 seconds
setInterval(() => {
  fetchLivePrices();
}, 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// MARKETS TAB
// ═══════════════════════════════════════════════════════════════════════════

let marketsFilter = 'All';
let currentMarketsFilter = 'All';
let miniCharts = [];

function renderMarkets(filter) {
  if (filter !== undefined) { marketsFilter = filter; currentMarketsFilter = filter; }
  miniCharts.forEach(c => c.remove());
  miniCharts = [];

  const fmap = {
    All:         () => true,
    Indices:     m => m.sector === 'Index',
    Stocks:      m => !['Index','Crypto','Commodity'].includes(m.sector) && !m.exchange,
    Tech:        m => m.sector === 'Tech',
    Finance:     m => m.sector === 'Finance',
    Healthcare:  m => m.sector === 'Healthcare',
    Crypto:      m => m.sector === 'Crypto',
    Commodities: m => m.sector === 'Commodity',
    JSE:         m => m.exchange === 'JSE',
    Watchlist:   m => watchlistSet.has(m.ticker),
  };
  const shown  = MARKETS.filter(fmap[marketsFilter] || (() => true));
  const hero   = MARKETS[0];
  const heroUp = hero.chg >= 0;
  const filters = ['All','Indices','Stocks','Tech','Finance','Healthcare','Crypto','Commodities','JSE'];
  if (currentUser) filters.push('Watchlist');

  // Top movers: 3 biggest gainers + 3 biggest losers
  const sorted    = [...MARKETS].sort((a,b) => b.chg - a.chg);
  const topGain   = sorted.slice(0, 4);
  const topLoss   = sorted.slice(-4).reverse();

  // Featured assets (always show these 6 regardless of filter)
  const FEATURED_TICKERS = ['SPX','NDX','BTC','XAU','NVDA','ETH'];
  const featuredAssets = FEATURED_TICKERS.map(t => MARKETS.find(m => m.ticker === t)).filter(Boolean);

  // ── Sector Performance Bar ─────────────────────────────────────────────────
  const sectorGroups = {};
  MARKETS.forEach(m => {
    const s = m.sector || 'Other';
    if (!sectorGroups[s]) sectorGroups[s] = [];
    sectorGroups[s].push(m.chg);
  });
  const sectorPerf = Object.entries(sectorGroups).map(([s, chgs]) => ({
    sector: s,
    avg: chgs.reduce((a,b) => a+b, 0) / chgs.length,
  })).sort((a,b) => b.avg - a.avg);

  // ── Portfolio overlap map ──────────────────────────────────────────────────
  const portfolioMap = {};
  if (currentUser && dbPortfolio.length) {
    const totalValue = dbPortfolio.reduce((s, h) => {
      const mkt = MARKETS.find(x => x.ticker === h.ticker);
      return s + (mkt ? mkt.val * h.shares : h.avg_cost * h.shares);
    }, 0);
    dbPortfolio.forEach(h => {
      const mkt = MARKETS.find(x => x.ticker === h.ticker);
      const val = mkt ? mkt.val * h.shares : h.avg_cost * h.shares;
      portfolioMap[h.ticker] = totalValue > 0 ? (val / totalValue * 100).toFixed(1) : '0.0';
    });
  }

  document.getElementById('tab-markets').innerHTML = `
    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
      <div><h2>Markets</h2><p>Tap any asset for detailed charts & stats</p></div>
      <button class="compare-toggle-btn ${compareMode?'on':'off'}" onclick="toggleCompareMode()">
        ${compareMode ? '✕ Exit Compare' : '⇄ Compare'}
      </button>
    </div>

    <!-- Sector Performance Bar -->
    <div class="sector-bar">
      ${sectorPerf.map(({sector, avg}) => {
        const pos = avg >= 0;
        return `<span class="sector-chip ${pos?'pos':'neg'}">${sector} ${pos?'+':''}${avg.toFixed(2)}%</span>`;
      }).join('')}
    </div>

    ${compareMode ? `
    <!-- Compare Mode bar -->
    <div class="compare-bar">
      <p>Select up to 3:</p>
      <div class="compare-chips">
        ${compareSet.size === 0 ? '<span style="font-size:11px;color:#64748b">None selected yet</span>' :
          [...compareSet].map(t => `<span class="compare-chip">${t}
            <button onclick="event.stopPropagation();toggleCompareAsset('${t}')" title="Remove">✕</button>
          </span>`).join('')}
      </div>
      ${compareSet.size >= 2 ? `<button class="compare-run-btn" onclick="openCompareMode()">▶ Compare</button>` : ''}
    </div>` : ''}

    <!-- Featured multi-chart grid -->
    <p style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Featured</p>
    <div class="featured-grid">
      ${featuredAssets.map(m => {
        const up  = m.chg >= 0;
        const col = up ? '#10b981' : '#ef4444';
        const bgCol = up ? '#10b98120' : '#ef444420';
        const idx = MARKETS.indexOf(m);
        const lo = parseFloat(m.lo52); const hi = parseFloat(m.hi52);
        const pct52 = lo && hi && hi > lo ? Math.max(0, Math.min(100, ((m.val - lo) / (hi - lo)) * 100)).toFixed(1) : 50;
        const fmtShort = v => v >= 1000 ? v.toLocaleString(undefined,{maximumFractionDigits:0}) : v.toFixed(v < 10 ? 3 : 2);
        const inCompare = compareSet.has(m.ticker);
        return `
        <div class="featured-card${inCompare?' compare-selected':''}" onclick="${compareMode?`toggleCompareAsset('${m.ticker}')`:`openStockDetail(${idx})`}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <p style="font-size:10px;font-weight:700;color:#94a3b8;font-family:var(--mono);letter-spacing:.08em">${m.ticker}</p>
              <p style="font-size:12px;font-weight:700;color:#e2e8f0;margin-top:3px;white-space:nowrap;overflow:hidden;max-width:100px;text-overflow:ellipsis">${m.name}</p>
            </div>
            <div style="text-align:right">
              <p style="font-size:16px;font-weight:800;color:#f1f5f9;font-family:var(--mono);letter-spacing:-.02em">${fmtShort(m.val)}</p>
              <span style="display:inline-block;margin-top:4px;font-size:11px;font-weight:700;color:${col};background:${bgCol};padding:2px 7px;border-radius:20px">${up?'▲':'▼'} ${Math.abs(m.chg)}%</span>
            </div>
          </div>
          <div style="margin-top:auto">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;font-family:var(--mono);margin-bottom:4px">
              <span>${lo ? lo.toLocaleString() : '—'}</span>
              <span style="color:#94a3b8;font-size:9px">52W RANGE</span>
              <span>${hi ? hi.toLocaleString() : '—'}</span>
            </div>
            <div style="height:4px;background:#ffffff0f;border-radius:4px;position:relative">
              <div style="position:absolute;left:0;top:0;height:4px;width:${pct52}%;background:linear-gradient(90deg,${col}80,${col});border-radius:4px;transition:width .4s"></div>
              <div style="position:absolute;top:-3px;width:10px;height:10px;border-radius:50%;background:${col};border:2px solid #1e293b;left:calc(${pct52}% - 5px);box-shadow:0 0 6px ${col}80"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:10px">
              <div style="font-size:10px;color:#64748b">Vol <span style="color:#94a3b8;font-weight:600">${m.vol}</span></div>
              ${m.pe !== '—' ? `<div style="font-size:10px;color:#64748b">P/E <span style="color:#94a3b8;font-weight:600">${m.pe}</span></div>` : `<div style="font-size:10px;color:#64748b">Mkt Cap <span style="color:#94a3b8;font-weight:600">${m.mktcap}</span></div>`}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <!-- Top Movers strip -->
    <div style="margin-bottom:16px">
      <p style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">🔥 Top Movers</p>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none">
        ${topGain.map(m => `
          <div onclick="${compareMode?`toggleCompareAsset('${m.ticker}')`:`openStockDetail(${MARKETS.indexOf(m)})`}" style="flex-shrink:0;background:var(--card);border:1px solid #10b98130;border-radius:12px;padding:8px 12px;cursor:pointer;min-width:90px${compareSet.has(m.ticker)?';border-color:#3b82f6':''}">
            <p style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${m.ticker}</p>
            <p style="font-size:12px;font-weight:800;color:#10b981;margin-top:2px">▲ ${m.chg}%</p>
          </div>`).join('')}
        ${topLoss.map(m => `
          <div onclick="${compareMode?`toggleCompareAsset('${m.ticker}')`:`openStockDetail(${MARKETS.indexOf(m)})`}" style="flex-shrink:0;background:var(--card);border:1px solid #ef444430;border-radius:12px;padding:8px 12px;cursor:pointer;min-width:90px${compareSet.has(m.ticker)?';border-color:#3b82f6':''}">
            <p style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${m.ticker}</p>
            <p style="font-size:12px;font-weight:800;color:#ef4444;margin-top:2px">▼ ${Math.abs(m.chg)}%</p>
          </div>`).join('')}
      </div>
    </div>
    <div class="filter-row" style="overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none">
      ${filters.map(f => `<button class="filter-btn ${marketsFilter===f?'active':''}" style="white-space:nowrap;flex-shrink:0" onclick="renderMarkets('${f}')">${f}</button>`).join('')}
    </div>
    ${shown.length === 0 && marketsFilter === 'Watchlist' ? `
      <div style="text-align:center;padding:40px 20px">
        <p style="font-size:32px;margin-bottom:12px">⭐</p>
        <p style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:6px">No watchlist items</p>
        <p style="font-size:12px;color:var(--faint)">Tap the ☆ star on any asset tile to add it to your watchlist.</p>
      </div>
    ` : ''}
    <div class="market-grid">
      ${shown.map((m, idx) => {
        const up = m.chg >= 0;
        const globalIdx = MARKETS.indexOf(m);
        const starred = watchlistSet.has(m.ticker);
        const inCompare = compareSet.has(m.ticker);
        const hasAlert = currentUser && alertsMap[m.ticker] && alertsMap[m.ticker].length > 0;
        const overlapPct = portfolioMap[m.ticker];

        const starBtn = currentUser && !compareMode
          ? `<button onclick="event.stopPropagation();toggleWatchlist('${m.ticker}','${m.name.replace(/'/g,"\\'")}')"
               style="position:absolute;top:8px;right:8px;background:none;font-size:15px;line-height:1;padding:2px"
               title="${starred?'Remove from watchlist':'Add to watchlist'}">${starred?'⭐':'☆'}</button>`
          : '';
        const bellBtn = currentUser && !compareMode
          ? `<button class="alert-bell${hasAlert?' active':''}" onclick="event.stopPropagation();openAlertModal('${m.ticker}','${m.name.replace(/'/g,"\\'")}',${m.val})"
               style="position:absolute;top:8px;right:${currentUser?'30px':'8px'};background:none;border:none;cursor:pointer;font-size:13px;padding:2px"
               title="${hasAlert?'Manage alerts':'Set price alert'}">${hasAlert?'🔔':'🔕'}</button>`
          : '';
        const overlapBadge = overlapPct
          ? `<div class="overlap-badge">In Portfolio · ${overlapPct}%</div>`
          : '';

        return `
          <div class="market-tile${inCompare?' compare-selected':''}" onclick="${compareMode?`toggleCompareAsset('${m.ticker}')`:`openStockDetail(${globalIdx})`}" style="position:relative">
            ${starBtn}${bellBtn}${overlapBadge}
            <p class="ticker" style="margin-top:${overlapPct?'18px':'0'}">${m.ticker}</p>
            <p class="name">${m.name}</p>
            <p class="price">${fmtUnitPrice(m.val)}</p>
            <div class="bottom">
              <span class="mono ${up?'up':'dn'}" style="font-size:12px;font-weight:700">${up?'▲':'▼'} ${Math.abs(m.chg)}%</span>
              <div class="mini-chart" id="mini-${m.ticker}"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Render charts after DOM update
  requestAnimationFrame(() => {
    // Drag-to-scroll on sector bar
    const sb = document.querySelector('.sector-bar');
    if (sb) {
      let isDown = false, startX, scrollLeft;
      sb.addEventListener('mousedown', e => { isDown = true; sb.style.cursor = 'grabbing'; startX = e.pageX - sb.offsetLeft; scrollLeft = sb.scrollLeft; });
      sb.addEventListener('mouseleave', () => { isDown = false; sb.style.cursor = 'grab'; });
      sb.addEventListener('mouseup', () => { isDown = false; sb.style.cursor = 'grab'; });
      sb.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); const x = e.pageX - sb.offsetLeft; sb.scrollLeft = scrollLeft - (x - startX); });
    }
    // Market grid mini-charts
    shown.forEach(m => {
      const el = document.getElementById('mini-' + m.ticker);
      if (el) {
        const color = m.chg >= 0 ? '#10b981' : '#ef4444';
        const c = createMiniChart(el, m.charts['1D'].slice(-20), color, 32);
        if (c) miniCharts.push(c);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK DETAIL
// ═══════════════════════════════════════════════════════════════════════════

let detailChart = null;
let currentDetailIdx = null;

// ── Live data helpers ─────────────────────────────────────────────────────────
async function fetchLivePrices() {
  const tickers = MARKETS.map(m => m.ticker).join(',');
  try {
    const r = await fetch('prices.php?action=quotes&tickers=' + tickers);
    const d = await r.json();
    if (!d.success) return;
    let updated = false;
    MARKETS.forEach(m => {
      const q = d.quotes[m.ticker];
      if (q && q.price) {
        // Reject if live price is implausible vs. the known initial value.
        // Catches Yahoo Finance data cross-contamination (e.g. ETH-USD returning
        // Ethan Allen ~$22 instead of Ethereum ~$3892 — a 99.4% deviation).
        const ratio = q.price / m._initVal;
        if (ratio < 0.02 || ratio > 50) return; // more than 98% off → discard
        m.val = q.price; m.chg = q.chg ?? m.chg;
        if (q.hi52) m.hi52 = String(q.hi52);
        if (q.lo52) m.lo52 = String(q.lo52);
        updated = true;
      }
    });
    if (updated) {
      const tab = document.getElementById('tab-markets');
      if (tab && tab.classList.contains('active')) renderMarkets();
      checkAlerts();
    }
    renderNavPulse();
  } catch(e) { /* keep generated data on error */ }
}

async function fetchLiveChart(ticker, tf, callback) {
  try {
    const r = await fetch(`prices.php?action=chart&ticker=${encodeURIComponent(ticker)}&tf=${tf}`);
    const d = await r.json();
    if (d.success && d.points && d.points.length > 1) callback(d.points);
  } catch(e) { /* silent fallback */ }
}

function renderNavPulse() {
  const statusEl   = document.getElementById('pulse-status');
  const tickersEl  = document.getElementById('pulse-tickers');
  if (!statusEl || !tickersEl) return;

  // Market open/closed: NYSE Mon-Fri 09:30-16:00 ET
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun,6=Sat
  const mins = et.getHours() * 60 + et.getMinutes();
  const isOpen = day >= 1 && day <= 5 && mins >= 570 && mins < 960;
  statusEl.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${isOpen ? '#10b981' : '#ef4444'};display:inline-block"></span>
    <span style="color:${isOpen ? '#10b981' : '#94a3b8'}">${isOpen ? 'Open' : 'Closed'}</span>`;

  // Show SPX, NDX, BTC, XAU
  const tickers = ['SPX', 'NDX', 'BTC', 'XAU'];
  const labels  = { SPX: 'S&P 500', NDX: 'Nasdaq', BTC: 'Bitcoin', XAU: 'Gold' };
  tickersEl.innerHTML = tickers.map(t => {
    const m = MARKETS.find(x => x.ticker === t);
    if (!m) return '';
    const pos  = m.chg >= 0;
    const disp = fmtPrice(m.val);
    return `<div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer"
                 onclick="switchTab('markets');setTimeout(()=>openStockDetail(MARKETS.findIndex(x=>x.ticker==='${t}')),80)">
      <span style="font-size:11px;font-weight:600;color:var(--text)">${labels[t]}</span>
      <div style="text-align:right">
        <div style="font-size:11px;font-weight:700;font-family:var(--mono);color:var(--text)">${disp}</div>
        <div style="font-size:10px;font-weight:600;color:${pos ? '#10b981' : '#ef4444'}">${pos ? '+' : ''}${m.chg.toFixed(2)}%</div>
      </div>
    </div>`;
  }).join('');
}

function openStockDetail(idx) {
  currentDetailIdx = idx;
  const stock = MARKETS[idx];
  const up    = stock.chg >= 0;
  const color = up ? '#10b981' : '#ef4444';
  const overlay = document.getElementById('stock-detail');
  overlay.classList.remove('hidden');

  // Compute simulated timeframe returns from generated chart data
  function tfReturn(tf) {
    const pts = stock.charts[tf];
    if (!pts || pts.length < 2) return null;
    const ret = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value * 100);
    return ret.toFixed(2);
  }
  const returns = TIMEFRAMES.map(tf => ({ tf, r: tfReturn(tf) }));

  // 52-week range position (0–100%)
  const hi52n = parseFloat(stock.hi52);
  const lo52n = parseFloat(stock.lo52);
  const rangePct = hi52n > lo52n ? Math.round((stock.val - lo52n) / (hi52n - lo52n) * 100) : 50;

  // Sector-specific label
  const assetLabel = { Crypto:'Cryptocurrency', Commodity:'Commodity', Index:'Market Index',
    Tech:'Technology', Finance:'Financial', Healthcare:'Healthcare', Energy:'Energy',
    Consumer:'Consumer', Industrial:'Industrial', Auto:'Automotive' }[stock.sector] || stock.sector;

  overlay.innerHTML = `
    <div class="sd-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="sd-back" onclick="closeStockDetail()">←</button>
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="mono" style="font-weight:800;font-size:18px;color:#fff">${stock.ticker}</span>
            <span style="background:${color}20;color:${color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px">${assetLabel}</span>
          </div>
          <p style="font-size:12px;color:var(--muted);margin-top:2px">${stock.name}</p>
        </div>
      </div>
      <div style="text-align:right">
        <p class="mono" style="font-size:24px;font-weight:700;color:#fff">${fmtUnitPrice(stock.val)}</p>
        <span style="font-size:13px;font-weight:700;color:${color}">${up?'▲':'▼'} ${Math.abs(stock.chg).toFixed(2)}% today</span>
      </div>
    </div>

    <div class="sd-chart" id="sd-chart-canvas"></div>
    <div class="sd-timeframes">
      ${TIMEFRAMES.map(tf => `<button class="tf-btn ${tf==='1D'?(up?'active-up':'active-dn'):''}" onclick="switchDetailTF(${idx},'${tf}')">${tf}</button>`).join('')}
    </div>

    <!-- 52-week range bar -->
    <div style="padding:16px 20px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">52-Week Range</span>
        <span style="font-size:10px;font-weight:700;color:#94a3b8;font-family:var(--mono)">${rangePct}% of range</span>
      </div>
      <div style="height:5px;background:#1e293b;border-radius:4px;position:relative">
        <div style="position:absolute;left:0;width:${rangePct}%;height:100%;background:linear-gradient(90deg,${color}50,${color});border-radius:4px"></div>
        <div style="position:absolute;left:${rangePct}%;transform:translateX(-50%);top:-4px;width:12px;height:12px;background:${color};border-radius:50%;border:2px solid #0c1320;box-shadow:0 0 6px ${color}80"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:11px;color:#64748b;font-family:var(--mono)">${fmtUnitPrice(parseFloat(stock.lo52))}</span>
        <span style="font-size:11px;color:#64748b;font-family:var(--mono)">${fmtUnitPrice(parseFloat(stock.hi52))}</span>
      </div>
    </div>

    <!-- Key stats grid -->
    <div class="sd-stats">
      ${[
        {l:'Market Cap',  v:stock.mktcap || '—', c:''},
        {l:'P/E Ratio',   v:stock.pe     || '—', c:''},
        {l:'Volume',      v:stock.vol    || '—', c:''},
        {l:'52W High',    v:fmtUnitPrice(parseFloat(stock.hi52)), c:'#10b981'},
        {l:'52W Low',     v:fmtUnitPrice(parseFloat(stock.lo52)), c:'#ef4444'},
        {l:'Day Change',  v:(stock.chg>0?'+':'')+stock.chg+'%', c:color},
      ].map(s => `<div class="stat-box">
        <p class="label">${s.l}</p>
        <p class="val" style="${s.c?'color:'+s.c:''}">${s.v}</p>
      </div>`).join('')}
    </div>

    <!-- Timeframe performance -->
    <div style="padding:10px 20px 16px">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Performance</p>
      <div style="display:flex;gap:8px">
        ${returns.map(({tf, r}) => {
          if (r === null) return '';
          const pos = parseFloat(r) >= 0;
          return `<div style="flex:1;background:#1e293b;border:1px solid #ffffff0a;border-radius:10px;padding:10px 6px;text-align:center">
            <p style="font-size:10px;color:#64748b;margin-bottom:4px;font-weight:600">${tf}</p>
            <p style="font-size:12px;font-weight:800;font-family:var(--mono);color:${pos?'#10b981':'#ef4444'}">${pos?'+':''}${r}%</p>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- What-If Simulator -->
    <div class="whatif-box">
      <p class="wi-label">💰 What-If Simulator — 1 Year Return</p>
      <div class="whatif-row">
        <input class="whatif-input" id="whatif-amount-${stock.ticker}" type="number" placeholder="e.g. 1000" min="1" step="any">
        <button class="whatif-btn" onclick="runWhatIf('${stock.ticker}')">Calculate</button>
      </div>
      <div class="whatif-result" id="whatif-result-${stock.ticker}"></div>
    </div>

    <!-- Add to watchlist + portfolio + alert -->
    <div style="padding:0 20px 28px;display:flex;flex-direction:column;gap:10px">
      ${stock.exchange === 'JSE' ? `<div style="padding:8px 12px;border-radius:10px;background:#f59e0b14;border:1px solid #f59e0b30;text-align:center">
        <p style="font-size:11px;color:#f59e0b;font-weight:700">🇿🇦 JSE Listed · Prices in ZAR (R)</p>
      </div>` : ''}
      ${currentUser ? `<div style="display:flex;gap:10px">
        <button onclick="toggleWatchlist('${stock.ticker}','${stock.name.replace(/'/g,"\\'")}')"
          style="flex:1;padding:13px;border-radius:13px;background:${watchlistSet.has(stock.ticker)?'#10b98118':'#1e293b'};border:1.5px solid ${watchlistSet.has(stock.ticker)?'#10b981':'#ffffff0a'};font-size:13px;font-weight:700;color:${watchlistSet.has(stock.ticker)?'#10b981':'#64748b'};cursor:pointer;transition:all .2s">
          ${watchlistSet.has(stock.ticker) ? '★ Watchlist' : '☆ Watchlist'}
        </button>
        <button onclick="openAddHoldingModal('${stock.ticker}','${stock.name.replace(/'/g,"\\'")}')"
          style="flex:1;padding:13px;border-radius:13px;background:var(--green);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all .2s">
          + Portfolio
        </button>
        <button onclick="openAlertModal('${stock.ticker}','${stock.name.replace(/'/g,"\\'")}',${stock.val})"
          style="padding:13px 16px;border-radius:13px;background:${(alertsMap[stock.ticker]||[]).filter(a=>!a.triggered).length?'#f59e0b18':'#1e293b'};border:1.5px solid ${(alertsMap[stock.ticker]||[]).filter(a=>!a.triggered).length?'#f59e0b':'#ffffff0a'};font-size:16px;cursor:pointer;transition:all .2s" title="Set price alert">
          ${(alertsMap[stock.ticker]||[]).filter(a=>!a.triggered).length?'🔔':'🔕'}
        </button>
      </div>` : `<button onclick="document.getElementById('auth-overlay').classList.remove('hidden');showAuthTab('login')"
        style="width:100%;padding:13px;border-radius:13px;background:var(--green);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none">
        Log in to track & set alerts
      </button>`}
    </div>
  `;

  requestAnimationFrame(() => {
    const el = document.getElementById('sd-chart-canvas');
    if (el) {
      if (detailChart) detailChart.remove();
      detailChart = createFullChart(el, convertChartData(stock.charts['1D']), color, 300);
    }
    // Replace with live data as soon as it arrives
    fetchLiveChart(stock.ticker, '1D', points => {
      // Sanity-check against the known initial price (not stock.val which may itself be wrong).
      const last = points[points.length - 1]?.value;
      const ratio = last / stock._initVal;
      if (!last || !stock._initVal || ratio < 0.02 || ratio > 50) return;
      stock.charts['1D'] = points;
      const el2 = document.getElementById('sd-chart-canvas');
      if (el2) { if (detailChart) detailChart.remove(); detailChart = createFullChart(el2, convertChartData(points), color, 300); }
    });
  });
}

function switchDetailTF(idx, tf) {
  const stock = MARKETS[idx];
  const up = stock.chg >= 0;
  const color = up ? '#10b981' : '#ef4444';

  document.querySelectorAll('.tf-btn').forEach(b => {
    b.className = 'tf-btn' + (b.textContent === tf ? (up ? ' active-up' : ' active-dn') : '');
  });

  requestAnimationFrame(() => {
    const el = document.getElementById('sd-chart-canvas');
    if (el) {
      if (detailChart) detailChart.remove();
      detailChart = createFullChart(el, convertChartData(stock.charts[tf]), color, 300);
    }
    fetchLiveChart(stock.ticker, tf, points => {
      const last = points[points.length - 1]?.value;
      const ratio = last / stock._initVal;
      if (!last || !stock._initVal || ratio < 0.02 || ratio > 50) return;
      stock.charts[tf] = points;
      const el2 = document.getElementById('sd-chart-canvas');
      if (el2) { if (detailChart) detailChart.remove(); detailChart = createFullChart(el2, convertChartData(points), color, 300); }
    });
  });
}

function closeStockDetail() {
  document.getElementById('stock-detail').classList.add('hidden');
  if (detailChart) { detailChart.remove(); detailChart = null; }
  Object.values(indicatorCharts).forEach(c => c && c.remove());
  indicatorCharts = {};
  activeIndicators.clear();
  currentDetailIdx = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICE ALERTS
// ═══════════════════════════════════════════════════════════════════════════

async function loadAlertsFromDB() {
  if (!currentUser) return;
  try {
    const d = await apiCall('data.php?action=price_alerts');
    if (d.success) {
      alertsMap = {};
      d.alerts.forEach(a => {
        if (!alertsMap[a.ticker]) alertsMap[a.ticker] = [];
        alertsMap[a.ticker].push(a);
      });
    }
  } catch(e) {}
}

function openAlertModal(ticker, name, currentPrice) {
  if (!currentUser) { document.getElementById('auth-overlay').classList.remove('hidden'); showAuthTab('login'); return; }
  document.getElementById('alert-ticker').value = ticker;
  document.getElementById('alert-ticker-name').value = name;
  document.getElementById('alert-modal-title').textContent = '🔔 Alert — ' + ticker;
  document.getElementById('alert-modal-sub').textContent = 'Current price: ' + fmtUnitPrice(currentPrice);
  document.getElementById('alert-target').value = '';
  alertDirection = 'above';
  document.getElementById('alert-dir-above').classList.add('selected');
  document.getElementById('alert-dir-below').classList.remove('selected');
  renderAlertList(ticker);
  document.getElementById('alert-modal-bg').classList.remove('hidden');
}

function closeAlertModal() {
  document.getElementById('alert-modal-bg').classList.add('hidden');
}

function selectAlertDir(dir) {
  alertDirection = dir;
  document.getElementById('alert-dir-above').className = 'alert-dir-btn' + (dir === 'above' ? ' selected' : '');
  document.getElementById('alert-dir-below').className = 'alert-dir-btn' + (dir === 'below' ? ' selected red' : '');
}

function renderAlertList(ticker) {
  const list = document.getElementById('alert-list');
  const alerts = alertsMap[ticker] || [];
  if (!alerts.length) { list.innerHTML = ''; return; }
  list.innerHTML = alerts.map(a => `
    <div class="alert-item">
      <span class="alert-txt">${a.direction === 'above' ? '📈 Above' : '📉 Below'} ${fmtUnitPrice(a.target)}${a.triggered ? ' ✓' : ''}</span>
      <button class="alert-del" onclick="deleteAlert(${a.id},'${ticker}')" title="Delete">✕</button>
    </div>`).join('');
}

async function saveAlert() {
  const ticker = document.getElementById('alert-ticker').value;
  const name   = document.getElementById('alert-ticker-name').value;
  const target = parseFloat(document.getElementById('alert-target').value);
  if (!ticker || !target || isNaN(target)) { showToast('Enter a valid target price'); return; }
  try {
    const d = await apiCall('data.php?action=price_alerts', 'POST', { ticker, name, target, direction: alertDirection });
    if (d.success) {
      if (!alertsMap[ticker]) alertsMap[ticker] = [];
      alertsMap[ticker].push({ id: d.id, ticker, name, target, direction: alertDirection, triggered: false });
      renderAlertList(ticker);
      document.getElementById('alert-target').value = '';
      showToast('🔔 Alert set!');
    }
  } catch(e) { showToast('Error saving alert'); }
}

async function deleteAlert(id, ticker) {
  try {
    await apiCall('data.php?action=price_alerts', 'DELETE', { id });
    if (alertsMap[ticker]) alertsMap[ticker] = alertsMap[ticker].filter(a => a.id !== id);
    renderAlertList(ticker);
    showToast('Alert removed');
  } catch(e) {}
}

function checkAlerts() {
  if (!currentUser || !Object.keys(alertsMap).length) return;
  MARKETS.forEach(m => {
    const alerts = alertsMap[m.ticker];
    if (!alerts) return;
    alerts.forEach(a => {
      if (a.triggered) return;
      const hit = (a.direction === 'above' && m.val >= a.target) || (a.direction === 'below' && m.val <= a.target);
      if (hit) {
        a.triggered = true;
        showToast(`🔔 ${m.ticker} ${a.direction === 'above' ? 'crossed above' : 'dropped below'} ${fmtUnitPrice(a.target)}!`, 5000);
        apiCall('data.php?action=price_alerts', 'PUT', { id: a.id }).catch(() => {});
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARE MODE
// ═══════════════════════════════════════════════════════════════════════════

function toggleCompareMode() {
  compareMode = !compareMode;
  if (!compareMode) { compareSet.clear(); }
  renderMarkets();
}

function toggleCompareAsset(ticker) {
  if (compareSet.has(ticker)) {
    compareSet.delete(ticker);
  } else if (compareSet.size < 3) {
    compareSet.add(ticker);
  } else {
    showToast('Max 3 assets to compare');
    return;
  }
  renderMarkets();
}

function openCompareMode() {
  if (compareSet.size < 2) { showToast('Select at least 2 assets first'); return; }
  document.getElementById('compare-overlay').classList.remove('hidden');
  renderCompareChart(compareTF);
}

function closeCompareMode() {
  document.getElementById('compare-overlay').classList.add('hidden');
  if (compareChart) { compareChart.remove(); compareChart = null; }
}

const COMPARE_COLORS = ['#10b981','#3b82f6','#f59e0b','#ec4899','#8b5cf6'];

function renderCompareChart(tf) {
  compareTF = tf;
  // Update TF buttons
  document.querySelectorAll('#compare-tf-row .tf-btn').forEach(b => {
    b.className = 'tf-btn' + (b.textContent === tf ? ' active-up' : '');
  });

  const tickers = [...compareSet];
  const assets  = tickers.map(t => MARKETS.find(m => m.ticker === t)).filter(Boolean);
  if (!assets.length) return;

  // Legend
  const legend = document.getElementById('compare-legend');
  legend.innerHTML = assets.map((a, i) => `
    <div class="compare-leg-item">
      <div class="compare-leg-dot" style="background:${COMPARE_COLORS[i]}"></div>
      ${a.ticker} — ${a.name}
    </div>`).join('');

  // Build normalised series
  const container = document.getElementById('compare-chart');
  if (!container) return;
  container.innerHTML = '';
  if (compareChart) { compareChart.remove(); compareChart = null; }

  compareChart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 600, height: 320,
    layout: { background: { type: 'solid', color: '#0c1320' }, textColor: '#64748b', fontFamily: 'DM Mono, monospace' },
    grid: { vertLines: { color: '#ffffff08' }, horzLines: { color: '#ffffff08' } },
    crosshair: { mode: 1 },
    rightPriceScale: { borderVisible: false, textColor: '#475569',
      formatFn: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    handleScroll: { mouseWheel: false, pressedMouseMove: true },
    handleScale: { mouseWheel: false, pinch: true },
  });

  assets.forEach((a, i) => {
    const pts = a.charts[tf];
    if (!pts || pts.length < 2) return;
    const base = pts[0].value;
    const normData = pts.map(p => ({ time: p.time, value: ((p.value - base) / base * 100) }));
    const s = compareChart.addLineSeries({
      color: COMPARE_COLORS[i], lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: { type: 'custom', formatter: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' },
    });
    s.setData(normData);
  });
  compareChart.timeScale().fitContent();

  // Stats table
  const stats = document.getElementById('compare-stats');
  stats.innerHTML = assets.map((a, i) => {
    const pts = a.charts[tf];
    if (!pts || pts.length < 2) return '';
    const ret = ((pts[pts.length-1].value - pts[0].value) / pts[0].value * 100);
    const pos = ret >= 0;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:#1e293b">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:${COMPARE_COLORS[i]}"></div>
        <span style="font-size:13px;font-weight:700;color:#e2e8f0;font-family:var(--mono)">${a.ticker}</span>
        <span style="font-size:11px;color:#64748b">${a.name}</span>
      </div>
      <span style="font-size:14px;font-weight:800;font-family:var(--mono);color:${pos?'#10b981':'#ef4444'}">${pos?'+':''}${ret.toFixed(2)}%</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATORS (RSI, MACD, Bollinger Bands)
// ═══════════════════════════════════════════════════════════════════════════

function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return [];
  const result = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i].value - prices[i-1].value;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period; i < prices.length; i++) {
    if (i > period) {
      const diff = prices[i].value - prices[i-1].value;
      avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: prices[i].time, value: 100 - (100 / (1 + rs)) });
  }
  return result;
}

function computeMACD(prices) {
  if (prices.length < 35) return { macd: [], signal: [], hist: [] };
  function ema(data, period) {
    const k = 2 / (period + 1);
    const result = [];
    let val = data[0].value;
    for (let i = 0; i < data.length; i++) {
      val = i === 0 ? data[i].value : data[i].value * k + val * (1 - k);
      if (i >= period - 1) result.push({ time: data[i].time, value: val });
    }
    return result;
  }
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macdLine = ema26.map((p, i) => {
    const e12 = ema12.find(x => x.time === p.time);
    return e12 ? { time: p.time, value: e12.value - p.value } : null;
  }).filter(Boolean);
  const signalLine = ema(macdLine, 9);
  const hist = signalLine.map((p, i) => {
    const m = macdLine.find(x => x.time === p.time);
    return m ? { time: p.time, value: m.value - p.value } : null;
  }).filter(Boolean);
  return { macd: macdLine, signal: signalLine, hist };
}

function computeBollinger(prices, period = 20, stdMult = 2) {
  if (prices.length < period) return { upper: [], mid: [], lower: [] };
  const upper = [], mid = [], lower = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1).map(p => p.value);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    mid.push({ time: prices[i].time, value: mean });
    upper.push({ time: prices[i].time, value: mean + stdMult * std });
    lower.push({ time: prices[i].time, value: mean - stdMult * std });
  }
  return { upper, mid, lower };
}

function toggleIndicator(indicator) {
  if (activeIndicators.has(indicator)) {
    activeIndicators.delete(indicator);
  } else {
    activeIndicators.add(indicator);
  }
  const btn = document.getElementById('ind-btn-' + indicator);
  if (btn) {
    btn.classList.toggle('active', activeIndicators.has(indicator));
    if (indicator === 'macd') btn.classList.toggle('macd', activeIndicators.has(indicator));
    if (indicator === 'boll') btn.classList.toggle('boll', activeIndicators.has(indicator));
  }
  renderIndicators(currentDetailIdx);
}

function renderIndicators(idx) {
  if (idx === null || idx === undefined) return;
  const stock = MARKETS[idx];
  const tf = (() => {
    const active = document.querySelector('.tf-btn.active-up, .tf-btn.active-dn');
    return active ? active.textContent : '1D';
  })();
  const prices = stock.charts[tf];
  if (!prices || prices.length < 2) return;

  // Clean up old indicator charts
  Object.values(indicatorCharts).forEach(c => c && c.remove());
  indicatorCharts = {};

  // Remove old indicator containers
  document.querySelectorAll('.ind-chart').forEach(el => el.remove());

  const detailEl = document.getElementById('stock-detail');
  const insertBefore = detailEl.querySelector('.sd-stats');
  if (!insertBefore) return;

  // Bollinger — overlaid on main chart (re-render it)
  const col = stock.chg >= 0 ? '#10b981' : '#ef4444';
  if (activeIndicators.has('boll')) {
    const el = document.getElementById('sd-chart-canvas');
    if (el && detailChart) {
      const boll = computeBollinger(prices);
      const fmt = { type:'custom', formatter: v => fmtUnitPrice(v) };
      [{ d: boll.upper, c: '#f59e0b60' }, { d: boll.mid, c: '#f59e0b' }, { d: boll.lower, c: '#f59e0b60' }].forEach(({d,c}) => {
        const s = detailChart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt });
        s.setData(convertChartData(d));
      });
    }
  }

  // RSI chart
  if (activeIndicators.has('rsi')) {
    const rsiData = computeRSI(prices);
    if (rsiData.length > 1) {
      const rsiEl = document.createElement('div');
      rsiEl.className = 'ind-chart';
      rsiEl.style.height = '100px';
      insertBefore.parentNode.insertBefore(rsiEl, insertBefore);
      const rsiLbl = document.createElement('p');
      rsiLbl.style.cssText = 'font-size:9px;font-weight:700;color:#8b5cf6;text-transform:uppercase;letter-spacing:.06em;padding:4px 20px 0;background:#0c1320';
      rsiLbl.textContent = 'RSI (14)';
      insertBefore.parentNode.insertBefore(rsiLbl, rsiEl);
      indicatorCharts.rsi = LightweightCharts.createChart(rsiEl, {
        width: rsiEl.clientWidth || 600, height: 100,
        layout: { background: { type:'solid', color:'#0c1320' }, textColor:'#64748b' },
        grid: { vertLines:{visible:false}, horzLines:{color:'#ffffff08'} },
        rightPriceScale: { borderVisible:false, textColor:'#475569', scaleMargins:{top:0.1,bottom:0.1} },
        timeScale: { visible:false }, crosshair:{mode:1}, handleScroll:{mouseWheel:false}, handleScale:{mouseWheel:false},
      });
      const rsiS = indicatorCharts.rsi.addLineSeries({ color:'#8b5cf6', lineWidth:2, priceLineVisible:false, lastValueVisible:true });
      rsiS.setData(rsiData);
      // Overbought/oversold lines
      const refData = rsiData.map(p => ({ time: p.time, value: 70 }));
      const refData2 = rsiData.map(p => ({ time: p.time, value: 30 }));
      indicatorCharts.rsi.addLineSeries({ color:'#ef444450', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false }).setData(refData);
      indicatorCharts.rsi.addLineSeries({ color:'#10b98150', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false }).setData(refData2);
      indicatorCharts.rsi.timeScale().fitContent();
    }
  }

  // MACD chart
  if (activeIndicators.has('macd')) {
    const { macd, signal, hist } = computeMACD(prices);
    if (macd.length > 1) {
      const macdEl = document.createElement('div');
      macdEl.className = 'ind-chart';
      macdEl.style.height = '100px';
      insertBefore.parentNode.insertBefore(macdEl, insertBefore);
      const macdLbl = document.createElement('p');
      macdLbl.style.cssText = 'font-size:9px;font-weight:700;color:#06b6d4;text-transform:uppercase;letter-spacing:.06em;padding:4px 20px 0;background:#0c1320';
      macdLbl.textContent = 'MACD (12,26,9)';
      insertBefore.parentNode.insertBefore(macdLbl, macdEl);
      indicatorCharts.macd = LightweightCharts.createChart(macdEl, {
        width: macdEl.clientWidth || 600, height: 100,
        layout: { background: { type:'solid', color:'#0c1320' }, textColor:'#64748b' },
        grid: { vertLines:{visible:false}, horzLines:{color:'#ffffff08'} },
        rightPriceScale: { borderVisible:false, textColor:'#475569', scaleMargins:{top:0.1,bottom:0.1} },
        timeScale: { visible:false }, crosshair:{mode:1}, handleScroll:{mouseWheel:false}, handleScale:{mouseWheel:false},
      });
      indicatorCharts.macd.addLineSeries({ color:'#06b6d4', lineWidth:2, priceLineVisible:false, lastValueVisible:true }).setData(macd);
      indicatorCharts.macd.addLineSeries({ color:'#f59e0b', lineWidth:1, priceLineVisible:false, lastValueVisible:false }).setData(signal);
      const histS = indicatorCharts.macd.addHistogramSeries({ color:'#06b6d440', priceLineVisible:false, lastValueVisible:false });
      histS.setData(hist.map(p => ({ ...p, color: p.value >= 0 ? '#10b98160' : '#ef444460' })));
      indicatorCharts.macd.timeScale().fitContent();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IF SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════

function runWhatIf(ticker) {
  const inputEl = document.getElementById('whatif-amount-' + ticker);
  const resultEl = document.getElementById('whatif-result-' + ticker);
  if (!inputEl || !resultEl) return;
  const amount = parseFloat(inputEl.value);
  if (!amount || isNaN(amount) || amount <= 0) { showToast('Enter a valid investment amount'); return; }
  const stock = MARKETS.find(m => m.ticker === ticker);
  if (!stock) return;
  const pts1Y = stock.charts['1Y'];
  if (!pts1Y || pts1Y.length < 2) return;
  const startPrice = pts1Y[0].value;
  const endPrice   = pts1Y[pts1Y.length - 1].value;
  const returnPct  = ((endPrice - startPrice) / startPrice * 100);
  const endValue   = amount * (1 + returnPct / 100);
  const gain       = endValue - amount;
  const pos        = gain >= 0;
  const fmt = v => v >= 1000 ? '$' + v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '$' + v.toFixed(2);
  resultEl.classList.add('show');
  resultEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <p style="font-size:10px;color:#64748b;font-weight:600">WOULD BE WORTH</p>
        <p style="font-size:20px;font-weight:800;color:#e2e8f0;font-family:var(--mono)">${fmt(endValue)}</p>
      </div>
      <div style="text-align:right">
        <p style="font-size:12px;font-weight:800;color:${pos?'#10b981':'#ef4444'}">${pos?'+':''}${fmt(gain)}</p>
        <p style="font-size:11px;color:${pos?'#10b981':'#ef4444'}">${pos?'+':''}${returnPct.toFixed(2)}% in 1 year</p>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FINBOT TAB
// ═══════════════════════════════════════════════════════════════════════════

let finbotState = { mode: null, loading: false, result: null, error: null, savedId: null };
let finbotForm = {
  risk: 'moderate', amount: '', horizon: 'medium', sectors: '',
  ticker: '', portfolio: 'AAPL 28%, MSFT 26%, NVDA 22%, TSLA 13%, AMZN 11%', portVal: '',
  company: '', earnDate: '', ePos: 'none',
  age: '', income: '', savings: '', goal: 'wealth', bRisk: 'moderate', acct: 'taxable',
  techTicker: '', techPos: 'none', techLivePrice: null, techLiveChg: null, techHi52: null, techLo52: null, builderHoldings: '',
  currency: 'USD',
};

const CURRENCIES = [
  { code: 'USD', label: 'USD – US Dollar ($)' },
  { code: 'EUR', label: 'EUR – Euro (€)' },
  { code: 'GBP', label: 'GBP – British Pound (£)' },
  { code: 'JPY', label: 'JPY – Japanese Yen (¥)' },
  { code: 'CNY', label: 'CNY – Chinese Yuan (¥)' },
  { code: 'INR', label: 'INR – Indian Rupee (₹)' },
  { code: 'CAD', label: 'CAD – Canadian Dollar (C$)' },
  { code: 'AUD', label: 'AUD – Australian Dollar (A$)' },
  { code: 'CHF', label: 'CHF – Swiss Franc (Fr)' },
  { code: 'HKD', label: 'HKD – Hong Kong Dollar (HK$)' },
  { code: 'SGD', label: 'SGD – Singapore Dollar (S$)' },
  { code: 'KRW', label: 'KRW – South Korean Won (₩)' },
  { code: 'BRL', label: 'BRL – Brazilian Real (R$)' },
  { code: 'MXN', label: 'MXN – Mexican Peso ($)' },
  { code: 'ZAR', label: 'ZAR – South African Rand (R)' },
  { code: 'SEK', label: 'SEK – Swedish Krona (kr)' },
  { code: 'NOK', label: 'NOK – Norwegian Krone (kr)' },
  { code: 'DKK', label: 'DKK – Danish Krone (kr)' },
  { code: 'NZD', label: 'NZD – New Zealand Dollar (NZ$)' },
  { code: 'AED', label: 'AED – UAE Dirham (د.إ)' },
  { code: 'SAR', label: 'SAR – Saudi Riyal (﷼)' },
  { code: 'TRY', label: 'TRY – Turkish Lira (₺)' },
  { code: 'ILS', label: 'ILS – Israeli Shekel (₪)' },
  { code: 'PLN', label: 'PLN – Polish Złoty (zł)' },
  { code: 'TWD', label: 'TWD – New Taiwan Dollar (NT$)' },
  { code: 'THB', label: 'THB – Thai Baht (฿)' },
  { code: 'MYR', label: 'MYR – Malaysian Ringgit (RM)' },
  { code: 'IDR', label: 'IDR – Indonesian Rupiah (Rp)' },
  { code: 'PHP', label: 'PHP – Philippine Peso (₱)' },
  { code: 'VND', label: 'VND – Vietnamese Dong (₫)' },
  { code: 'PKR', label: 'PKR – Pakistani Rupee (₨)' },
  { code: 'BDT', label: 'BDT – Bangladeshi Taka (৳)' },
  { code: 'EGP', label: 'EGP – Egyptian Pound (£)' },
  { code: 'NGN', label: 'NGN – Nigerian Naira (₦)' },
  { code: 'KES', label: 'KES – Kenyan Shilling (KSh)' },
  { code: 'GHS', label: 'GHS – Ghanaian Cedi (₵)' },
];

function currencySelectHtml() {
  return `<div>
    <label class="form-label">Currency</label>
    <select class="form-input" onchange="finbotForm.currency=this.value">
      ${CURRENCIES.map(c => `<option value="${c.code}"${finbotForm.currency === c.code ? ' selected' : ''}>${c.label}</option>`).join('')}
    </select>
  </div>`;
}

// Prompt builders
const prompts = {
  screener: () => `You are Jake, a veteran stock analyst with 15 years of experience hunting high-conviction opportunities.\nProvide a complete stock screening framework:\n- Top 10 stocks with ticker symbols\n- P/E ratio vs sector averages\n- Revenue growth trends over 5 years\n- Debt-to-equity health check\n- Competitive moat rating (weak/moderate/strong)\n- Bull and bear price targets for 12 months\n- Risk rating 1-10 with reasoning\n- Entry price zones and stop-loss suggestions\nFormat as a professional equity research report with a summary table.\nInvestment profile: Risk: ${finbotForm.risk}. Amount: ${finbotForm.amount ? finbotForm.amount + ' ' + finbotForm.currency : 'flexible'}. Currency: ${finbotForm.currency}. Horizon: ${finbotForm.horizon}. Sectors: ${finbotForm.sectors||'any'}.\nExpress all monetary values (price targets, entry zones, stop-losses) in ${finbotForm.currency}.\nUse markdown with headers and tables. Close with a legal disclaimer.`,
  dcf: () => `You are Emily, a financial analyst who specialises in company valuations and discounted cash flow modelling.\nBuild a full DCF analysis for: ${finbotForm.ticker}\nInclude:\n- 5-year revenue projection\n- Free cash flow year by year\n- WACC estimate\n- Terminal value\n- Sensitivity table\n- DCF value vs current price\n- Verdict: undervalued / fairly valued / overvalued\nFormat as a valuation memo with tables.\nUse markdown. Close with a legal disclaimer.`,
  risk: () => `You are Marcus, a risk analyst who has spent his career stress-testing portfolios against every kind of market shock.\nComplete risk assessment:\n- Correlation analysis\n- Sector concentration risk\n- Recession stress test\n- Tail risk scenarios\n- Hedging strategies\n- Rebalancing suggestions\nPortfolio (total value: ${finbotForm.portVal ? finbotForm.portVal + ' ' + finbotForm.currency : 'not specified'}, currency: ${finbotForm.currency}): ${finbotForm.portfolio}\nExpress all monetary values in ${finbotForm.currency}.\nUse markdown with headers and tables. Close with a legal disclaimer.`,
  earnings: () => `You are Priya, an equity research analyst who lives for earnings season and knows how to read the market reaction before it happens.\nEarnings analysis for: ${finbotForm.company}${finbotForm.earnDate?' (Earnings date: '+finbotForm.earnDate+')':''}${finbotForm.ePos!=='none'?'. My position: '+finbotForm.ePos:''}\nDeliver:\n- Last 4 quarters beat/miss history\n- Revenue and EPS consensus estimates\n- Key metrics\n- Options implied move\n- Recommended play\nUse markdown. Close with a legal disclaimer.`,
  builder: () => `You are Leo, a portfolio strategist who builds long-term investment plans that people actually stick to.\nBuild a custom investment portfolio:\n- Asset allocation percentages\n- Specific ETF recommendations\n- Expected return range\n- Max drawdown estimate\n- Rebalancing schedule\n- Regular investment plan with contribution amounts\nDetails: Age: ${finbotForm.age||'unspecified'}. Income: ${finbotForm.income ? finbotForm.income + ' ' + finbotForm.currency + '/mo' : 'unspecified'}. Amount to invest: ${finbotForm.savings ? finbotForm.savings + ' (' + finbotForm.currency + ')' : 'unspecified'}. Goal: ${finbotForm.goal}. Risk: ${finbotForm.bRisk}. Account: ${finbotForm.acct}. Currency: ${finbotForm.currency}.\nExpress all monetary values, contribution amounts, and projections in ${finbotForm.currency}.\nUse markdown. Close with a legal disclaimer.`,
  technical: () => `You are Zoe, a technical analyst who reads charts the way others read books — spotting patterns and levels before most traders even notice them.\nFull technical analysis for: ${finbotForm.techTicker}${finbotForm.techPos!=='none'?'. My position: '+finbotForm.techPos:''}\nAnalyze:\n- Trend on daily, weekly, monthly\n- Support/resistance levels\n- RSI, MACD, Bollinger Bands\n- Chart patterns\n- Entry, stop-loss, profit target\n- Confidence rating\nUse markdown. Close with a legal disclaimer.`,
};

const MOCK_RESPONSES = {
  screener: () => `# Jake's Stock Screener Report
*Prepared by: Jake — Senior Stock Analyst*

---

## Executive Summary
Based on your investment profile — **Risk: ${finbotForm.risk}**, **Amount: ${finbotForm.amount||'Flexible'}**, **Horizon: ${finbotForm.horizon}**, **Sectors: ${finbotForm.sectors||'Diversified'}** — I've identified the following top opportunities.

---

## Top 10 Stock Picks

| # | Ticker | Name | P/E | Rev Growth | D/E | Moat | Bull Target | Bear Target | Risk |
|---|--------|------|-----|-----------|-----|------|------------|------------|------|
| 1 | **NVDA** | NVIDIA Corp | 42.1 | +122% YoY | 0.41 | Strong | $1,450 | $920 | 6/10 |
| 2 | **MSFT** | Microsoft | 31.4 | +17% YoY | 0.37 | Strong | $540 | $380 | 4/10 |
| 3 | **AMZN** | Amazon | 44.8 | +14% YoY | 0.52 | Strong | $280 | $170 | 5/10 |
| 4 | **GOOGL** | Alphabet | 22.3 | +15% YoY | 0.08 | Strong | $240 | $150 | 4/10 |
| 5 | **META** | Meta Platforms | 24.1 | +25% YoY | 0.14 | Strong | $780 | $490 | 5/10 |
| 6 | **LLY** | Eli Lilly | 58.2 | +36% YoY | 1.82 | Strong | $1,100 | $780 | 5/10 |
| 7 | **V** | Visa Inc | 28.6 | +10% YoY | 1.67 | Strong | $360 | $260 | 3/10 |
| 8 | **BRK.B** | Berkshire Hathaway | 23.4 | +8% YoY | 0.26 | Strong | $510 | $380 | 3/10 |
| 9 | **AAPL** | Apple Inc | 28.1 | +5% YoY | 1.95 | Strong | $280 | $185 | 4/10 |
| 10 | **PANW** | Palo Alto Networks | 52.7 | +19% YoY | 0.89 | Moderate | $440 | $290 | 6/10 |

---

## Entry Zones & Stop-Loss Suggestions

| Ticker | Current Price | Entry Zone | Stop-Loss | Upside to Bull |
|--------|--------------|------------|-----------|----------------|
| NVDA | $1,180 | $1,100–$1,150 | $980 | +22.9% |
| MSFT | $432 | $420–$435 | $390 | +25.0% |
| AMZN | $214 | $205–$215 | $185 | +30.8% |
| GOOGL | $183 | $175–$185 | $160 | +31.1% |
| META | $598 | $570–$600 | $510 | +30.4% |

---

## Key Themes
1. **AI Infrastructure** — NVDA, MSFT, GOOGL benefit from multi-year capex supercycle
2. **Healthcare Innovation** — LLY GLP-1 drugs represent a $100B+ market opportunity
3. **Digital Payments** — V maintains pricing power with low credit risk exposure
4. **Cybersecurity** — PANW transitioning to high-margin platformization model

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,

  dcf: () => `# Emily's DCF Valuation Report
**Subject:** ${finbotForm.ticker || 'AAPL'} — Discounted Cash Flow Analysis
*Prepared by: Emily — Financial Analyst*

---

## Company Overview
**${finbotForm.ticker || 'AAPL'}** is a globally recognized business with durable competitive advantages and consistent free cash flow generation. This analysis applies a rigorous DCF framework to determine intrinsic value.

---

## 5-Year Revenue Projection

| Year | Revenue ($B) | Growth % | EBITDA Margin | FCF ($B) |
|------|-------------|----------|--------------|----------|
| 2025E | 412.5 | +7.2% | 31.4% | 118.3 |
| 2026E | 445.8 | +8.1% | 32.1% | 131.7 |
| 2027E | 482.4 | +8.2% | 32.8% | 146.2 |
| 2028E | 518.9 | +7.6% | 33.2% | 159.8 |
| 2029E | 553.4 | +6.6% | 33.5% | 171.4 |

---

## WACC Estimation

| Component | Value |
|-----------|-------|
| Risk-Free Rate | 4.35% |
| Equity Risk Premium | 5.50% |
| Beta | 1.18 |
| Cost of Equity | 10.84% |
| After-Tax Cost of Debt | 2.95% |
| Capital Structure (E/D) | 78% / 22% |
| **WACC** | **9.12%** |

---

## Terminal Value Calculation
- Terminal Growth Rate: **3.0%**
- Terminal FCF: $176.5B
- Terminal Value: **$2,861B**
- PV of Terminal Value: **$1,843B**

---

## DCF Summary

| Component | Value ($B) |
|-----------|-----------|
| PV of FCFs (5-Year) | 524.6 |
| PV of Terminal Value | 1,843.2 |
| Enterprise Value | 2,367.8 |
| Less: Net Debt | (51.3) |
| **Equity Value** | **2,419.1** |
| Shares Outstanding (B) | 15.4 |
| **Intrinsic Value Per Share** | **$157.09** |
| Current Price | $178.20 |

---

## Sensitivity Analysis (Intrinsic Value per Share)

| WACC ↓ / Terminal Growth → | 2.0% | 2.5% | 3.0% | 3.5% | 4.0% |
|---------------------------|------|------|------|------|------|
| 7.5% | $198 | $214 | $234 | $259 | $292 |
| 8.5% | $171 | $182 | $196 | $213 | $235 |
| **9.12%** | **$151** | **$161** | **$157** | **$187** | **$205** |
| 10.0% | $132 | $139 | $148 | $160 | $174 |
| 11.0% | $115 | $120 | $127 | $136 | $147 |

---

## Verdict

> **FAIRLY VALUED** — Current price of ~$178 is within a reasonable range of our base-case DCF of $157. The stock appears slightly premium-priced, suggesting limited near-term upside. We recommend **HOLD** with a price target of **$195** based on a blended DCF/comps methodology.

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,

  risk: () => `# Marcus's Portfolio Risk Report
*Prepared by: Marcus — Risk Analyst*

---

## Portfolio Under Analysis
${finbotForm.portfolio || 'AAPL 30%, MSFT 25%, NVDA 20%, AMZN 15%, Cash 10%'}
${finbotForm.portVal ? `**Total Value:** ${finbotForm.portVal}` : ''}

---

## Correlation Matrix

| Asset | AAPL | MSFT | NVDA | AMZN | Cash |
|-------|------|------|------|------|------|
| AAPL | 1.00 | 0.78 | 0.71 | 0.65 | 0.00 |
| MSFT | 0.78 | 1.00 | 0.74 | 0.69 | 0.00 |
| NVDA | 0.71 | 0.74 | 1.00 | 0.59 | 0.00 |
| AMZN | 0.65 | 0.69 | 0.59 | 1.00 | 0.00 |
| Cash | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 |

**Insight:** High correlations across tech holdings — diversification benefit is limited in a risk-off environment.

---

## Sector Concentration Risk

| Sector | Allocation | Benchmark (S&P 500) | Over/Under |
|--------|-----------|---------------------|-----------|
| Technology | 75% | 29.3% | **+45.7% overweight** |
| Consumer Discretionary | 15% | 10.4% | +4.6% |
| Cash / Fixed Income | 10% | — | — |

⚠️ **Critical:** Extreme concentration in Technology creates single-factor risk.

---

## Recession Stress Test

| Scenario | Est. Portfolio Drawdown | Recovery Period |
|----------|------------------------|----------------|
| Mild Recession (2001-style) | -22% | 14 months |
| Severe Recession (2008-style) | -48% | 36 months |
| Tech Crash (2000-style) | -61% | 54+ months |
| COVID-style Shock | -33% | 8 months |
| Stagflation | -28% | 24 months |

---

## Tail Risk Scenarios

1. **Fed pivot reversal** — Rates rise 150bps: Est. -18% impact
2. **AI regulation/antitrust** — Tech multiples compress 30%: Est. -22% impact
3. **China-Taiwan conflict** — Supply chain shock: Est. -25% impact

---

## Hedging Strategies

| Strategy | Instrument | Cost | Protection |
|----------|-----------|------|-----------|
| Downside protection | SPY put options (3-month, -10% strike) | ~1.2% annual | Partial |
| Sector hedge | Short SMH ETF (5-10% portfolio) | Borrowing cost | Tech-specific |
| Safe haven | Add GLD or TLT (10-15%) | Opportunity cost | Macro tail risk |
| Volatility hedge | VIX calls | ~0.5% annual | Spike protection |

---

## Rebalancing Suggestions

- **Reduce** Tech exposure from 75% → 50%
- **Add** Healthcare (LLY, UNH): +10%
- **Add** Financials (JPM, V): +8%
- **Add** International developed markets (EFA ETF): +7%
- **Increase** Cash buffer to 15% given elevated valuations

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,

  earnings: () => `# Priya's Earnings Preview
**Company:** ${finbotForm.company || 'NVIDIA Corporation (NVDA)'}
${finbotForm.earnDate ? `**Earnings Date:** ${finbotForm.earnDate}` : ''}
${finbotForm.ePos && finbotForm.ePos !== 'none' ? `**Your Position:** ${finbotForm.ePos}` : ''}
*Prepared by: Priya — Equity Research Analyst*

---

## Beat/Miss History (Last 4 Quarters)

| Quarter | EPS Estimate | EPS Actual | Beat/Miss | Revenue Est | Revenue Actual | Beat/Miss |
|---------|------------|-----------|-----------|------------|---------------|-----------|
| Q3 FY25 | $0.71 | **$0.81** | ✅ +14.1% | $32.5B | **$35.1B** | ✅ +8.0% |
| Q2 FY25 | $0.64 | **$0.68** | ✅ +6.3% | $28.2B | **$30.0B** | ✅ +6.4% |
| Q1 FY25 | $0.52 | **$0.61** | ✅ +17.3% | $24.6B | **$26.0B** | ✅ +5.7% |
| Q4 FY24 | $0.41 | **$0.49** | ✅ +19.5% | $20.0B | **$22.1B** | ✅ +10.5% |

**4-Quarter Track Record:** 4/4 beats on both EPS and Revenue

---

## Consensus Estimates (Current Quarter)

| Metric | Bear Case | Consensus | Bull Case |
|--------|-----------|-----------|-----------|
| Revenue | $36.8B | $38.2B | $41.5B |
| EPS (adj.) | $0.84 | $0.89 | $0.98 |
| Gross Margin | 73.5% | 74.8% | 76.2% |
| Data Center Rev | $32.0B | $33.5B | $36.2B |

---

## Key Metrics to Watch

1. **Data Center revenue** — Key growth driver; analyst bar is $33.5B+
2. **Blackwell chip ramp** — Supply commentary will set tone
3. **Gross margin guidance** — Any compression signals demand risk
4. **FY26 guidance** — Forward outlook more important than actuals
5. **China sales impact** — Export restrictions remain a risk factor

---

## Options Market Implied Move

| Expiry | Implied Move | ATM Straddle Cost |
|--------|-------------|------------------|
| Weekly (post-earnings) | ±8.4% | $89.20 |
| Monthly | ±12.1% | $127.50 |

**Historical post-earnings move (avg):** ±7.8% (last 8 quarters)

---

## Recommended Trade Play
${finbotForm.ePos === 'Long' ? `
**You are LONG — consider protecting gains:**
- Buy ATM put (weekly) to hedge downside
- Or sell OTM call to finance the put (collar strategy)
- If high conviction: hold through earnings, set mental stop at -10%
` : finbotForm.ePos === 'Short' ? `
**You are SHORT — elevated risk into print:**
- Cover at least 50% before the event
- Strong beat/raise cycle makes short side dangerous
- Consider buying calls as a hedge
` : `
**No position — speculative options play:**
- Directional bias: **Bullish** based on beat history
- Consider OTM call spread: Buy $+5% / Sell $+15% call spread
- Risk defined, captures upside if stock moves on strong guidance
`}

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,

  builder: () => `# Leo's Custom Portfolio Blueprint
*Prepared by: Leo — Portfolio Strategist*

---

## Client Profile
- **Age:** ${finbotForm.age || 'Not specified'}
- **Income:** ${finbotForm.income || 'Not specified'}
- **Available to Invest:** ${finbotForm.savings || 'Not specified'}
- **Goal:** ${finbotForm.goal || 'Wealth Growth'}
- **Risk Tolerance:** ${finbotForm.bRisk || 'Moderate'}
- **Account Type:** ${finbotForm.acct || 'Taxable Brokerage'}

---

## Recommended Asset Allocation

| Asset Class | Allocation | ETF Pick | Expense Ratio |
|-------------|-----------|----------|--------------|
| US Large Cap Equity | 35% | **VTI** (Vanguard Total Market) | 0.03% |
| International Equity | 15% | **VXUS** (Vanguard Intl Total) | 0.07% |
| US Growth / Tech | 15% | **QQQ** (Invesco Nasdaq-100) | 0.20% |
| US Bonds (Intermediate) | 15% | **BND** (Vanguard Total Bond) | 0.03% |
| Real Estate (REITs) | 8% | **VNQ** (Vanguard Real Estate) | 0.12% |
| Commodities / Inflation Hedge | 7% | **PDBC** (Invesco Commodity) | 0.59% |
| Cash / Money Market | 5% | **SGOV** (iShares T-Bill) | 0.09% |

**Blended Expense Ratio:** ~0.12% annually

---

## Expected Portfolio Metrics

| Metric | Estimate |
|--------|---------|
| Expected Annual Return | 7.2% – 9.8% |
| Standard Deviation (Risk) | 11.4% |
| Sharpe Ratio (est.) | 0.68 |
| Max Historical Drawdown | -32% (worst case, 2008-style) |
| Best-Year Return | +38% (bull market scenario) |

---

## Dollar Cost Averaging Plan

| Contribution Frequency | Suggested Amount | Annual Total |
|-----------------------|-----------------|-------------|
| Monthly (recommended) | Based on 15% of income | Variable |
| Bi-weekly | Align with paycheck | Variable |
| Annual lump sum | Tax-loss harvest opportunity | Variable |

**Suggested DCA Allocation per Contribution:**
- VTI: 35% → core holding
- QQQ: 15% → growth tilt
- VXUS: 15% → diversification
- BND: 15% → stability
- VNQ + PDBC + SGOV: 20% → alternatives

---

## Rebalancing Schedule

| Trigger | Action |
|---------|--------|
| Any asset drifts >5% from target | Rebalance to target |
| Annual (every January) | Full portfolio rebalance |
| Major life event | Reassess entire allocation |
| Bear market -20%+ | Consider adding to equity positions |

---

## Tax Optimization Tips
- Use **Roth IRA** for highest-growth assets (QQQ, individual stocks)
- Use **Traditional IRA/401k** for bond funds (tax-deferred income)
- Use **Taxable account** for VTI/VXUS (qualified dividends, tax-loss harvesting)
- Avoid frequent trading in taxable accounts to minimize capital gains

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,

  technical: () => `# Zoe's Technical Analysis
**Asset:** ${finbotForm.techTicker || 'NVDA'}
${finbotForm.techPos && finbotForm.techPos !== 'none' ? `**Position:** ${finbotForm.techPos}` : '**Position:** None (observing)'}
*Prepared by: Zoe — Technical Analyst*

---

## Trend Analysis

| Timeframe | Trend | Momentum | Signal |
|-----------|-------|----------|--------|
| Daily | ↗ Uptrend | Strong | **Bullish** |
| Weekly | ↗ Uptrend | Moderate | **Bullish** |
| Monthly | ↗ Uptrend | Building | **Neutral-Bullish** |

**Overall Trend Bias:** BULLISH — Price is making higher highs and higher lows across all timeframes.

---

## Support & Resistance Levels

| Level | Type | Strength | Notes |
|-------|------|----------|-------|
| $1,245 | Resistance | Strong | Recent all-time high zone |
| $1,198 | Resistance | Moderate | Prior breakout level |
| **$1,155** | **Key Support** | **Strong** | 50-day EMA confluence |
| $1,090 | Support | Moderate | Prior consolidation zone |
| $1,020 | Major Support | Very Strong | 200-day EMA + volume shelf |

---

## Technical Indicators

### RSI (14-period)
- **Current:** 61.4
- **Interpretation:** Bullish momentum, not yet overbought
- **Signal:** Room to run; watch for divergence above 70

### MACD (12/26/9)
- **MACD Line:** +14.82
- **Signal Line:** +11.47
- **Histogram:** +3.35 (expanding)
- **Signal:** Bullish crossover intact, momentum building

### Bollinger Bands (20-period, 2σ)
- **Upper Band:** $1,289
- **Middle Band (20MA):** $1,162
- **Lower Band:** $1,035
- **Price Position:** Mid-to-upper band — controlled uptrend
- **Band Width:** Expanding slightly — increasing volatility ahead

### Volume Analysis
- 20-day avg volume: 42.3M shares
- Recent volume trend: +15% above average on up days
- **Signal:** Institutional accumulation pattern detected

---

## Chart Patterns

| Pattern | Status | Implication |
|---------|--------|-------------|
| Bull Flag | ✅ Confirmed | Continuation → target $1,280–$1,320 |
| Ascending Triangle | Forming | Breakout above $1,245 confirms |
| No Distribution | ✅ Clean | No head-and-shoulders or topping pattern |

---

## Trade Setup

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Entry Zone** | $1,155 – $1,175 | Buy pullback to 50-day EMA |
| **Stop-Loss** | $1,080 | Below 200-day EMA + structure |
| **Target 1** | $1,280 | Bull flag measured move |
| **Target 2** | $1,350 | ATH breakout extension |
| **Risk/Reward** | 1 : 2.8 | Favorable setup |

---

## Confidence Rating

**7.5 / 10** — Strong multi-timeframe alignment with bullish technicals. Primary risk is broader market correction or negative sector news. Position sizing recommended at 3-5% of portfolio.

---

> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.`,
};

function buildFinBotPrompt(modeId) {
  const f = finbotForm;
  const system = 'You are FinBot, an expert financial analyst AI. Respond in clean Markdown with headers, bullet points, and tables where useful. End every response with exactly this legal disclaimer on its own line:\n\n> ⚖️ **Legal Disclaimer:** This analysis is generated by FinBot, an AI financial assistant, and is intended for informational and educational purposes only. It does not constitute personalized financial, investment, tax, or legal advice. All figures, correlations, stress test results, and risk metrics are estimates based on historical data and models — past performance is not indicative of future results. Before making any investment decisions, please consult a licensed financial advisor or registered investment professional who can assess your complete financial situation, risk tolerance, and goals. FinBot assumes no liability for investment outcomes based on this analysis.';
  let user;
  switch (modeId) {
    case 'screener':
      user = `Run a stock screener and recommend 6–8 specific stocks or ETFs for an investor with:
- Risk tolerance: ${f.risk || 'moderate'}
- Investment amount: ${f.amount || 'not specified'}
- Time horizon: ${f.horizon || 'medium (1–5 years)'}
- Preferred sectors: ${f.sectors || 'no preference'}

For each pick include: ticker, company name, why it fits the profile, key valuation metrics, and main risk factors. Use a summary table.`;
      break;

    case 'dcf':
      user = `Run a full DCF (Discounted Cash Flow) valuation for **${f.ticker}**.
Include:
1. Company snapshot and current share price context
2. Revenue & free cash flow projections (5-year)
3. WACC assumptions and calculation
4. Terminal value
5. Intrinsic value with bull / base / bear scenarios
6. Margin of safety
7. Clear Buy / Hold / Sell verdict with price target`;
      break;

    case 'risk':
      user = `Perform a comprehensive portfolio risk assessment.
Holdings: ${f.portfolio || 'not provided'}
Total value: ${f.portVal || 'not specified'}

Include:
1. Asset allocation breakdown & diversification score (0–100)
2. Concentration and correlation risks
3. Stress tests: 2008 GFC, COVID crash, 2022 rate-spike scenario
4. Key risk metrics: estimated Beta, Sharpe ratio, max drawdown
5. Specific rebalancing recommendations`;
      break;

    case 'earnings':
      user = `Prepare a pre-earnings briefing for **${f.company}**${f.earnDate ? ` reporting on ${f.earnDate}` : ''}.
Investor position: ${f.ePos || 'none / watching'}

If live market data has been provided in the context above, use it as the primary source for consensus estimates and historical beat/miss figures. For any data not supplied, draw on your training knowledge and clearly flag it as estimated.

Include:
1. Analyst consensus (EPS & revenue expectations)
2. Key metrics and guidance investors are watching
3. Recent business developments and catalysts
4. Historical earnings beat/miss track record
5. Options-implied move (if estimable)
6. Bull case / Bear case scenarios
7. Pre-earnings strategy considerations`;
      break;

    case 'builder':
      user = `Build a personalised investment portfolio blueprint for:
- Age: ${f.age || 'not specified'}
- Monthly income: ${f.income || 'not specified'}
- Amount to invest: ${f.savings || 'not specified'}
- Goal: ${f.goal || 'build wealth'}
- Risk tolerance: ${f.bRisk || 'moderate'}
- Account type: ${f.acct || 'taxable'}
- Currency: ${f.currency}
${f.builderHoldings ? `- Existing holdings: ${f.builderHoldings}` : ''}

Express all monetary values, contribution amounts, and projections in ${f.currency}.
Provide a full allocation table with specific ETFs/stocks, expected return range, expense ratios, a DCA schedule, and rebalancing triggers.`;
      break;

    case 'technical': {
      const liveCtx = f.techLivePrice
        ? `\nLive market data: Current price: $${Number(f.techLivePrice).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}${f.techLiveChg != null ? `, Day change: ${f.techLiveChg > 0 ? '+' : ''}${f.techLiveChg}%` : ''}${f.techHi52 != null ? `, 52-week high: $${Number(f.techHi52).toLocaleString()}` : ''}${f.techLo52 != null ? `, 52-week low: $${Number(f.techLo52).toLocaleString()}` : ''}`
        : '';
      user = `Provide a detailed technical analysis for **${f.techTicker || 'NVDA'}**.
Current position: ${f.techPos || 'none (observing)'}${liveCtx}

Include:
1. Trend analysis across daily, weekly, and monthly timeframes
2. Key support and resistance levels (with approximate price zones)
3. Moving averages: 20, 50, 200-day
4. RSI, MACD, and volume analysis
5. Notable chart patterns
6. Suggested entry/exit levels and stop-loss
7. Price targets (bull and bear)
8. Overall signal: Strong Buy / Buy / Neutral / Sell / Strong Sell`;
      break;
    }

    default:
      user = `Provide a professional financial analysis for the "${modeId}" mode.`;
  }
  return { system, user };
}

async function runFinBot(modeId) {
  finbotState.loading = true;
  finbotState.result = null;
  finbotState.error = null;
  renderFinBot();

  // Fetch live price for technical analysis before building the prompt
  if (modeId === 'technical' && finbotForm.techTicker) {
    try {
      const priceResp = await fetch(`prices.php?action=quotes&tickers=${encodeURIComponent(finbotForm.techTicker)}`);
      const priceData = await priceResp.json();
      const q = priceData?.quotes?.[finbotForm.techTicker];
      finbotForm.techLivePrice = q?.price ?? null;
      finbotForm.techLiveChg   = q?.chg   ?? null;
      finbotForm.techHi52      = q?.hi52  ?? null;
      finbotForm.techLo52      = q?.lo52  ?? null;
    } catch (_) {
      finbotForm.techLivePrice = null;
    }
  }

  try {
    const resp = await fetch('api.php', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...buildFinBotPrompt(modeId), mode: modeId, request_type: 'finbot' }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      if (data.code === 'upgrade_required') { finbotState.error = 'upgrade_required'; finbotState.loading = false; renderFinBot(); return; }
      if (data.code === 'no_credits')       { if (currentUser) currentUser.finbot_credits = 0; finbotState.error = 'no_credits'; finbotState.loading = false; renderFinBot(); return; }
      throw new Error(data.error || `Server error (${resp.status})`);
    }
    if (data.credits_remaining !== undefined && currentUser) {
      currentUser.finbot_credits = data.credits_remaining;
      updateHeaderUser();
    }
    finbotState.result = data.text ?? '';
  } catch (e) {
    finbotState.error = e.message || 'Analysis failed. Please try again.';
  }

  finbotState.loading = false;
  renderFinBot();
}

function setFinbotMode(id) { finbotState.mode = id; renderFinBot(); }
function resetFinBot() { finbotState = { mode: null, loading: false, result: null, error: null, savedId: null }; renderFinBot(); }
function backFromFinBotResult() {
  if (finbotState.fromSaved) {
    finbotState.result = null; finbotState.error = null; finbotState.fromSaved = false;
    switchTab('saved');
  } else {
    finbotState.result = null; finbotState.error = null;
    renderFinBot();
  }
}

function updateFormField(field, value) { finbotForm[field] = value; renderFinBot(); }

function renderFinBot() {
  const el = document.getElementById('tab-finbot');
  const mode = finbotState.mode;
  const modeObj = FINBOT_MODES.find(m => m.id === mode);

  // ── Guest wall ──
  if (!currentUser) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 24px">
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#7c3aed,#6d28d9);
                    display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">🤖</div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Meet FinBot</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:300px;margin-bottom:24px">
          Your personal AI financial analyst. Run deep analysis on stocks, portfolios, news, and more — all in seconds.
        </p>
        <button onclick="document.getElementById('auth-overlay').classList.remove('hidden');showAuthTab('login')"
          style="padding:14px 32px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;
                 font-size:14px;font-weight:800;border:none;cursor:pointer;margin-bottom:32px;width:100%;max-width:320px">
          Sign In to Use FinBot
        </button>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;padding:0 4px">6 Analysis Modes</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" style="opacity:.6;cursor:default;border-color:var(--border);pointer-events:none">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${m.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <p style="font-weight:800;font-size:14px;color:var(--text)">${m.title}</p>
                <span class="mode-sub" style="color:${m.col};background:${m.col}14">${m.sub}</span>
              </div>
              <p style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:4px">${m.desc}</p>
            </div>
          </div>
        </div>
      `).join('')}
      <div style="margin-top:20px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border)">
        <p style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
          🔒 <strong style="color:var(--text)">Sign in required</strong> — create an account, then upgrade to Pro or Enterprise
        </p>
      </div>
    `;
    return;
  }

  // ── Free-tier wall ──
  const userTier = currentUser.tier || 'free';
  if (userTier === 'free') {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 24px">
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#7c3aed,#6d28d9);
                    display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">🤖</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:#64748b22;margin-bottom:12px">
          <span style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">Free Plan</span>
        </div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Upgrade to Unlock FinBot</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:320px;margin-bottom:24px">
          FinBot is available on <strong style="color:#7c3aed">Pro</strong> and <strong style="color:#d97706">Enterprise</strong> plans. Get AI-powered stock analysis, portfolio review, earnings breakdowns, and more.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;max-width:360px;margin-bottom:28px">
          <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#7c3aed18,#6d28d918);border:1px solid #7c3aed44">
            <div style="font-size:20px;margin-bottom:6px">⚡</div>
            <p style="font-weight:800;font-size:13px;color:#a78bfa;margin-bottom:4px">Pro</p>
            <p style="font-size:11.5px;color:var(--faint);line-height:1.5">50 credits<br>News AI: 2 credits<br>Analysis: 5 credits</p>
          </div>
          <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#d9770618,#b4530918);border:1px solid #d9770644">
            <div style="font-size:20px;margin-bottom:6px">🏆</div>
            <p style="font-weight:800;font-size:13px;color:#fbbf24;margin-bottom:4px">Enterprise</p>
            <p style="font-size:11.5px;color:var(--faint);line-height:1.5">200 credits<br>News AI: 2 credits<br>Analysis: 5 credits</p>
          </div>
        </div>
        <div style="width:100%;max-width:360px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border);margin-bottom:8px">
          <p style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
            Contact your administrator to upgrade your plan, or reach out at <strong style="color:var(--text)">support@investeasy.app</strong>
          </p>
        </div>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;padding:0 4px">6 Analysis Modes — Pro & Enterprise</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" style="opacity:.5;cursor:default;border-color:var(--border);pointer-events:none">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${m.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <p style="font-weight:800;font-size:14px;color:var(--text)">${m.title}</p>
                <span class="mode-sub" style="color:${m.col};background:${m.col}14">${m.sub}</span>
              </div>
              <p style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:4px">${m.desc}</p>
            </div>
          </div>
        </div>
      `).join('')}
    `;
    return;
  }

  // ── No credits wall ──
  if ((currentUser.finbot_credits ?? 0) <= 0) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 24px">
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#dc2626,#991b1b);
                    display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">⚡</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:#dc262622;margin-bottom:12px">
          <span style="font-size:11px;font-weight:800;color:#f87171;text-transform:uppercase;letter-spacing:0.06em">0 Credits Remaining</span>
        </div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Out of FinBot Credits</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:320px;margin-bottom:20px">
          You've used all your FinBot credits. Contact support to top up your account and continue using AI analysis.
        </p>
        <div style="width:100%;max-width:360px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border)">
          <p style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
            Contact <strong style="color:var(--text)">support@investeasy.app</strong> to top up your credits
          </p>
        </div>
      </div>
    `;
    return;
  }

  // ── Mode Select ──
  if (!mode) {
    el.innerHTML = `
      <div class="section-title">
        <div class="finbot-header">
          <div class="finbot-icon">🤖</div>
          <div style="flex:1">
            <h2>FinBot</h2>
            <p style="font-size:11px;color:var(--faint)">6 elite analysis modes</p>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:0.05em;background:${currentUser.tier==='enterprise'?'#d9770622':'#7c3aed22'};color:${currentUser.tier==='enterprise'?'#fbbf24':'#a78bfa'}">${currentUser.tier==='enterprise'?'Enterprise':'Pro'}</span>
            <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:#10b98122;color:#10b981">⚡ ${currentUser.finbot_credits??0} credits</span>
          </div>
        </div>
      </div>
      <div class="disclaimer-box">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px;flex-shrink:0">⚖️</span>
          <div>
            <p style="font-weight:800;font-size:12px;color:var(--border);margin-bottom:4px">Educational Tool Only</p>
            <p style="font-size:11.5px;color:var(--faint);line-height:1.65">
              FinScope FinBot is an <strong style="color:#e2e8f0">educational tool</strong>. It does not constitute financial advice. Always consult a licensed professional before making investment decisions.
            </p>
          </div>
        </div>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px">Choose Analysis Mode</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" onclick="setFinbotMode('${m.id}')" style="border-color:var(--border)"
          onmouseenter="this.style.borderColor='${m.col}'" onmouseleave="this.style.borderColor='var(--border)'">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${m.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <p style="font-weight:800;font-size:14px;color:var(--text)">${m.title}</p>
                <span class="mode-sub" style="color:${m.col};background:${m.col}14">${m.sub}</span>
              </div>
              <p style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:4px">${m.desc}</p>
            </div>
          </div>
        </div>
      `).join('')}
    `;
    return;
  }

  // ── Loading ──
  if (finbotState.loading) {
    el.innerHTML = `
      <div class="loading-screen">
        <div class="loading-icon" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)">${modeObj.icon}</div>
        <p style="font-weight:800;font-size:18px;color:var(--text);margin-top:20px">Analyzing…</p>
        <p style="font-size:13px;color:var(--faint);margin-top:8px;text-align:center;line-height:1.6">
          Generating your <strong>${modeObj.title}</strong><br>
          <span style="font-size:11px;color:var(--border)">This may take 15–30 seconds</span>
        </p>
        <div class="loading-dots">
          ${[0,1,2].map(i => `<span style="background:${modeObj.col};animation:bd 1.4s ease-in-out ${i*0.2}s infinite"></span>`).join('')}
        </div>
      </div>
    `;
    return;
  }

  // ── Result / Error ──
  if (finbotState.result || finbotState.error) {
    const isSaved = !!finbotState.savedId;
    el.innerHTML = `
      <div class="result-header">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="back-btn" onclick="resetFinBot()">←</button>
          <div>
            <p style="font-weight:800;font-size:15px;color:var(--text)">${modeObj.title}</p>
            <p style="font-size:11px;color:${modeObj.col};font-weight:600">by ${modeObj.sub}</p>
          </div>
        </div>
        ${finbotState.result ? `<div style="display:flex;align-items:center;gap:8px">
          <span class="chip chip-green">✓ Complete</span>
          <button id="finbot-save-btn-top" onclick="saveFinBotReport()"
            style="padding:5px 11px;border-radius:10px;${isSaved ? 'background:#10b98122;color:#10b981' : 'background:var(--border);color:var(--text)'};font-size:12px;font-weight:700;border:none;cursor:pointer;white-space:nowrap">
            ${isSaved ? '🔖 Saved' : '🔖 Save'}
          </button>
        </div>` : ''}
      </div>
      ${finbotState.error === 'upgrade_required' ? `
        <div class="error-box" style="background:#7c3aed14;border-color:#7c3aed44">
          <p style="font-weight:700;font-size:14px;color:#a78bfa">Upgrade Required</p>
          <p style="margin:6px 0 10px;font-size:13px;color:#c4b5fd;line-height:1.5">FinBot is only available on Pro and Enterprise plans.</p>
          <button onclick="resetFinBot();switchTab('finbot')" style="background:#7c3aed;color:#fff;border-radius:10px;padding:10px 20px;font-weight:700;font-size:13px">View Plans</button>
        </div>
      ` : finbotState.error === 'no_credits' ? `
        <div class="error-box" style="background:#dc262614;border-color:#dc262644">
          <p style="font-weight:700;font-size:14px;color:#f87171">Out of Credits</p>
          <p style="margin:6px 0 10px;font-size:13px;color:#fca5a5;line-height:1.5">You have no FinBot credits remaining. Contact support to top up.</p>
        </div>
      ` : finbotState.error ? `
        <div class="error-box">
          <p style="font-weight:700;font-size:14px;color:#dc2626">Analysis Failed</p>
          <p style="margin:6px 0 10px;font-size:13px;color:#b91c1c;line-height:1.5">${escHtml(finbotState.error)}</p>
          <button onclick="runFinBot('${mode}')" style="background:var(--dark);color:#fff;border-radius:10px;padding:10px 20px;font-weight:700;font-size:13px">Retry Analysis</button>
        </div>
      ` : ''}
      ${finbotState.result ? `<div class="result-content">${parseMd(finbotState.result)}</div>` : ''}
      <div class="finbot-save-row">
        ${finbotState.result ? `
          <button onclick="saveFinBotReport()" class="finbot-save-btn-big"
            style="${isSaved ? 'background:#10b98122;color:#10b981;border:1.5px solid #10b981' : 'background:var(--green-bg);color:var(--green);border:1.5px solid var(--green)'}">
            ${isSaved ? '🔖 View in Saved →' : '🔖 Save Report'}
          </button>
        ` : ''}
        <button onclick="backFromFinBotResult()"
          class="finbot-save-btn-big" style="background:var(--border);color:var(--muted);border:none">← ${finbotState.fromSaved ? 'Back to All Reports' : 'Back to ' + modeObj.title}</button>
      </div>
    `;
    return;
  }

  // ── Forms ──
  const backBtn = `
    <div class="back-btn-row">
      <button class="back-btn" onclick="resetFinBot()">←</button>
      <div>
        <p style="font-weight:800;font-size:17px;color:var(--text)">${modeObj.title}</p>
        <p style="font-size:11px;color:${modeObj.col};font-weight:600">with ${modeObj.sub}</p>
      </div>
    </div>
  `;

  function pillsHtml(field, options, cols = 3, col = modeObj.col) {
    return `<div class="pills cols-${cols}">
      ${options.map(o => {
        const k = o.k || o;
        const sel = finbotForm[field] === k;
        return `<button class="pill ${sel?'selected':''}" style="${sel?`border-color:${col};background:${col}14;color:${col}`:''}"
          onclick="updateFormField('${field}','${k}')">
          ${o.e ? `<div class="emoji">${o.e}</div>` : ''}
          <div>${o.l || o}</div>
          ${o.s ? `<div class="sub">${o.s}</div>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }

  if (mode === 'screener') {
    el.innerHTML = `${backBtn}
      <div style="display:flex;flex-direction:column;gap:18px">
        <div><label class="form-label">Risk Tolerance</label>
          ${pillsHtml('risk', [{k:'conservative',e:'🛡',l:'Conservative'},{k:'moderate',e:'⚖️',l:'Moderate'},{k:'aggressive',e:'🚀',l:'Aggressive'}])}</div>
        ${currencySelectHtml()}
        <div><label class="form-label">Investment Amount (optional)</label>
          <input class="form-input mono" placeholder="e.g. 10,000" value="${finbotForm.amount}" oninput="finbotForm.amount=this.value"></div>
        <div><label class="form-label">Time Horizon</label>
          ${pillsHtml('horizon', [{k:'short',l:'Short',s:'< 1 year'},{k:'medium',l:'Medium',s:'1–5 years'},{k:'long',l:'Long',s:'5+ years'}])}</div>
        <div><label class="form-label">Preferred Sectors (optional)</label>
          <input class="form-input" placeholder="e.g. Tech, Healthcare, Energy" value="${finbotForm.sectors}" oninput="finbotForm.sectors=this.value"></div>
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" onclick="confirmAndRunFinBot('screener')">Run Stock Screener →</button>
      </div>`;
  } else if (mode === 'dcf') {
    el.innerHTML = `${backBtn}
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:14px;margin-bottom:16px">
        <p style="font-size:13px;color:#1e40af;line-height:1.6">Enter a stock ticker to get a full DCF valuation model with 5-year projections, WACC analysis, and a clear buy/hold/sell verdict.</p>
      </div>
      <div><label class="form-label">Stock Ticker — one at a time</label>
        <input class="form-input mono" placeholder="e.g. AAPL, HSBA, SAP" value="${finbotForm.ticker}" oninput="finbotForm.ticker=this.value.replace(/[^a-zA-Z]/g,'').toUpperCase()"></div>
      <div style="margin-top:20px">
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" ${!finbotForm.ticker.trim()?'disabled':''} onclick="confirmAndRunFinBot('dcf')">Run DCF Valuation →</button>
      </div>`;
  } else if (mode === 'risk') {
    const riskCanImport = currentUser && dbPortfolio.length > 0;
    el.innerHTML = `${backBtn}
      <div style="display:flex;flex-direction:column;gap:16px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="form-label" style="margin-bottom:0">Your Holdings</label>
            ${riskCanImport ? `<button class="import-port-btn" data-import="portfolio"
              onclick="importPortfolioToFinBot('portfolio','risk-holdings-ta')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M7 13l5 5 5-5"/><path d="M5 20h14"/></svg>
              Import my portfolio
            </button>` : ''}
          </div>
          <textarea id="risk-holdings-ta" class="form-textarea" rows="3"
            placeholder="e.g. AAPL 20%, NESN 15%, BTC 10%, GLD 5%"
            oninput="finbotForm.portfolio=this.value">${finbotForm.portfolio}</textarea>
          <p class="form-hint">Stocks, ETFs, crypto, commodities — any mix works</p>
        </div>
        ${currencySelectHtml()}
        <div><label class="form-label">Total Portfolio Value (optional)</label>
          <input class="form-input mono" placeholder="e.g. 50,000" value="${finbotForm.portVal}" oninput="finbotForm.portVal=this.value"></div>
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" onclick="confirmAndRunFinBot('risk')">Run Risk Assessment →</button>
      </div>`;
  } else if (mode === 'earnings') {
    el.innerHTML = `${backBtn}
      <div style="display:flex;flex-direction:column;gap:16px">
        <div><label class="form-label">Company Name or Ticker</label>
          <input class="form-input" placeholder="e.g. Apple, AAPL, Nestlé, NESN" value="${finbotForm.company}" oninput="finbotForm.company=this.value"></div>
        <div><label class="form-label">Earnings Date (optional)</label>
          <input class="form-input" placeholder="e.g. Jan 25, 2025" value="${finbotForm.earnDate}" oninput="finbotForm.earnDate=this.value"></div>
        <div><label class="form-label">Your Position</label>
          ${pillsHtml('ePos', [{k:'none',l:'None'},{k:'Long',e:'📈',l:'Long'},{k:'Short',e:'📉',l:'Short'}])}</div>
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" ${!finbotForm.company.trim()?'disabled':''} onclick="confirmAndRunFinBot('earnings')">Run Earnings Preview →</button>
      </div>`;
  } else if (mode === 'builder') {
    const bldrCanImport = currentUser && dbPortfolio.length > 0;
    el.innerHTML = `${backBtn}
      <div style="display:flex;flex-direction:column;gap:16px">
        ${currencySelectHtml()}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label class="form-label">Age</label><input class="form-input" placeholder="e.g. 23" value="${finbotForm.age}" oninput="finbotForm.age=this.value"></div>
          <div><label class="form-label">Monthly Income</label><input class="form-input" placeholder="e.g. 5,000" value="${finbotForm.income}" oninput="finbotForm.income=this.value"></div>
        </div>
        <div><label class="form-label">Amount to Invest</label>
          <input class="form-input" placeholder="e.g. 20,000 lump + 500/mo" value="${finbotForm.savings}" oninput="finbotForm.savings=this.value"></div>
        <div><label class="form-label">Investment Goal</label>
          ${pillsHtml('goal', [{k:'wealth',l:'Build Wealth'},{k:'retirement',l:'Retirement'},{k:'income',l:'Passive Income'}])}</div>
        <div><label class="form-label">Risk Tolerance</label>
          ${pillsHtml('bRisk', [{k:'conservative',l:'Conservative'},{k:'moderate',l:'Moderate'},{k:'aggressive',l:'Aggressive'}])}</div>
        <div><label class="form-label">Account Type</label>
          ${pillsHtml('acct', [{k:'taxable',l:'Taxable'},{k:'isa',l:'Tax-Exempt (ISA/Roth)'},{k:'pension',l:'Workplace Pension'}])}</div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="form-label" style="margin-bottom:0">Existing Holdings <span style="font-weight:400;color:var(--faint)">(optional)</span></label>
            ${bldrCanImport ? `<button class="import-port-btn" data-import="builderHoldings"
              onclick="importPortfolioToFinBot('builderHoldings','builder-holdings-ta')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M7 13l5 5 5-5"/><path d="M5 20h14"/></svg>
              Import portfolio
            </button>` : ''}
          </div>
          <textarea id="builder-holdings-ta" class="form-textarea" rows="2"
            placeholder="e.g. AAPL 20%, TSMC 10%, BTC 5% — leave blank if starting from scratch"
            oninput="finbotForm.builderHoldings=this.value">${finbotForm.builderHoldings}</textarea>
          <p class="form-hint">Leo will build around what you already own</p>
        </div>
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" onclick="confirmAndRunFinBot('builder')">Build My Portfolio →</button>
      </div>`;
  } else if (mode === 'technical') {
    el.innerHTML = `${backBtn}
      <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:14px;padding:14px;margin-bottom:16px">
        <p style="font-size:13px;color:#6b21a8;line-height:1.6">Get a full technical analysis with support/resistance levels, RSI/MACD readings, chart patterns, and a clear trade plan.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div><label class="form-label">Stock Ticker</label>
          <input class="form-input mono" placeholder="e.g. TSLA, BABA, VOW3" value="${finbotForm.techTicker}" oninput="finbotForm.techTicker=this.value.replace(/[^a-zA-Z]/g,'').toUpperCase()"></div>
        <div><label class="form-label">Current Position</label>
          ${pillsHtml('techPos', [{k:'none',l:'No Position'},{k:'Long',e:'📈',l:'Currently Long'},{k:'Short',e:'📉',l:'Currently Short'}])}</div>
        <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">⚡ This analysis uses <strong style="color:var(--text)">5 credits</strong></p>
        <button class="run-btn" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)" ${!finbotForm.techTicker.trim()?'disabled':''} onclick="confirmAndRunFinBot('technical')">Run Technical Analysis →</button>
      </div>`;
  }
}
renderFinBot();

// ═══════════════════════════════════════════════════════════════════════════
// SAVED REPORTS
// ═══════════════════════════════════════════════════════════════════════════

const SAVED_KEY = 'ie_saved_reports';

function getSavedReports() {
  return dbSavedReports ?? JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
}

async function loadSavedReportsFromDB() {
  dbSavedReportsLoading = true;
  try {
    const d = await apiCall('data.php?action=saved_reports');
    if (d.success && Array.isArray(d.reports)) {
      dbSavedReports = d.reports;
      updateSavedBadge();
    } else {
      dbSavedReports = null; // DB unavailable — fall back to localStorage
    }
  } catch(e) {
    dbSavedReports = null; // DB unavailable — fall back to localStorage
  }
  dbSavedReportsLoading = false;
  if (document.getElementById('tab-saved')?.classList.contains('active')) renderSaved();
}

// Save a report object — DB when logged in, localStorage for guests.
async function persistReport(report) {
  if (currentUser) {
    try {
      const d = await apiCall('data.php?action=saved_reports', 'POST', {
        id:          report.id,
        modeId:      report.modeId,
        modeTitle:   report.modeTitle,
        modeSub:     report.modeSub     || '',
        modeCol:     report.modeCol     || '#10b981',
        modeIcon:    report.modeIcon    || '🤖',
        content:     report.content,
        articleLink: report.articleLink || '',
        savedAt:     report.savedAt,
        tags:        report.tags        || [],
        folder:      report.folder      || '',
        starred:     report.starred     || false,
        note:        report.note        || '',
      });
      if (!d.success) throw new Error(d.error || 'Server rejected save.');
      if (!dbSavedReports) dbSavedReports = [];
      dbSavedReports.unshift(report);
    } catch(e) {
      showToast('Could not save to server — stored locally.');
      localPersistReport(report);
      // Keep report visible in current session even though it only went to localStorage
      if (dbSavedReports !== null) dbSavedReports.unshift(report);
    }
  } else {
    localPersistReport(report);
  }
  updateSavedBadge();
}

function localPersistReport(report) {
  const reports = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
  reports.unshift(report);
  localStorage.setItem(SAVED_KEY, JSON.stringify(reports));
}

// Delete a report — DB when logged in, localStorage for guests.
async function deletePersistedReport(id) {
  if (currentUser) {
    try {
      const d = await apiCall('data.php?action=saved_reports', 'DELETE', { id });
      if (!d.success) throw new Error(d.error || 'Delete failed.');
      if (dbSavedReports) dbSavedReports = dbSavedReports.filter(r => r.id !== id);
    } catch(e) { showToast('Could not delete from server. Please try again.'); return false; }
  } else {
    const reports = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]').filter(r => r.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(reports));
  }
  updateSavedBadge();
  return true;
}

async function saveFinBotReport() {
  if (finbotState.savedId) { switchTab('saved'); return; }
  if (!finbotState.result) return;
  const modeObj = FINBOT_MODES.find(m => m.id === finbotState.mode);
  const report  = {
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    modeId:    modeObj.id,
    modeTitle: modeObj.title,
    modeSub:   modeObj.sub,
    modeCol:   modeObj.col,
    modeIcon:  modeObj.icon,
    content:   finbotState.result,
    savedAt:   Date.now(),
  };
  await persistReport(report);
  finbotState.savedId = report.id;
  renderFinBot();
  showToast('Report saved! View it in the Saved tab.');
}

async function deleteSavedReport(id) {
  const ok = await deletePersistedReport(id);
  if (ok) renderSaved();
}

async function clearAllSavedReports() {
  const confirmed = await showConfirmModal(
    'Clear all reports?',
    'This will permanently delete all your saved reports. This action cannot be undone.'
  );
  if (!confirmed) return;
  if (currentUser) {
    // Delete each from DB
    const ids = getSavedReports().map(r => r.id);
    await Promise.all(ids.map(id => apiCall('data.php?action=saved_reports', 'DELETE', { id }).catch(() => {})));
    dbSavedReports = [];
  } else {
    localStorage.removeItem(SAVED_KEY);
  }
  savedFilter = 'all'; savedSearch = ''; savedSort = 'newest'; savedFolderFilter = ''; savedTagFilter = ''; savedSelected.clear(); // reset all filters
  updateSavedBadge();
  renderSaved();
}

function downloadReport(id) {
  const r = getSavedReports().find(r => r.id === id);
  if (!r) return;
  const date    = new Date(r.savedAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const htmlBody = parseMd(r.content);
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${r.modeTitle}</title>
    <style>
      body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#111;line-height:1.7;font-size:14px}
      h1,h2,h3,h4{font-family:Arial,sans-serif;margin-top:1.4em;margin-bottom:.3em;color:#000}
      h1{font-size:22px}h2{font-size:18px}h3{font-size:15px}h4{font-size:14px}
      p{margin:.4em 0}.bullet{margin:.2em 0 .2em 1.2em}
      .md-table{display:grid;gap:1px;margin:8px 0;border:1px solid #ccc}
      .td,.th{padding:6px 8px;font-size:12px;border:1px solid #ddd}
      .th{font-weight:700;background:#f5f5f5}
      .disclaimer{font-size:11px;color:#666;border-top:1px solid #ddd;margin-top:20px;padding-top:10px}
      .report-header{border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:24px}
      .report-meta{font-size:12px;color:#555;margin-top:4px}
      @media print{body{margin:20px}}
    </style>
  </head><body>
    <div class="report-header">
      <h1>${r.modeTitle}</h1>
      <div class="report-meta">${r.modeId === 'news' ? 'News Analysis' : r.modeSub} &nbsp;·&nbsp; ${date}</div>
    </div>
    <div class="result-content">${htmlBody}</div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

async function shareReport(id) {
  const r = getSavedReports().find(r => r.id === id);
  if (!r) return;
  const text = `${r.modeTitle} by ${r.modeSub}\n\n${r.content}`;
  if (navigator.share) {
    try { await navigator.share({ title: r.modeTitle, text }); return; } catch(e) { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch(e) { showToast('Could not copy — try downloading instead.'); }
}

function viewSavedReport(id) {
  const r = getSavedReports().find(r => r.id === id);
  if (!r) return;
  if (r.modeId === 'news') {
    // Show in the finbot-news-modal
    finbotNewsState = { idx: null, result: r.content, savedId: r.id };
    document.getElementById('finbot-news-modal').classList.remove('hidden');
    const articleLink = r.articleLink || '';
    const fakeN = { title: r.modeTitle, publisher: r.modeSub, link: articleLink };
    renderFinBotNewsResult(null, r.content, articleLink, fakeN);
    return;
  }
  finbotState.mode      = r.modeId;
  finbotState.result    = r.content;
  finbotState.loading   = false;
  finbotState.error     = null;
  finbotState.savedId   = r.id;
  finbotState.fromSaved = true;
  switchTab('finbot');
}

function updateSavedBadge() {
  const badge = document.getElementById('saved-badge');
  if (badge) badge.style.display = getSavedReports().length > 0 ? 'block' : 'none';
}

let savedFilter = 'all';
let savedSearch = '';
let savedSort = 'newest';
let savedFolderFilter = '';
let savedTagFilter = '';
let savedSelected = new Set();

// Tag/folder filter helpers — safe to call from onclick with arbitrary values
function _srTag(t) { savedTagFilter = (savedTagFilter === t ? '' : t); renderSaved(); }
function _srFolder(f) { savedFolderFilter = (savedFolderFilter === f ? '' : f); renderSaved(); }

function renderSaved(filter) {
  if (filter !== undefined) savedFilter = filter;
  const el = document.getElementById('tab-saved');

  // ── Loading state (logged-in, DB fetch still in-flight) ──
  if (currentUser && dbSavedReportsLoading) {
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px 20px;color:var(--faint);font-size:13px">Loading saved reports…</div>`;
    return;
  }

  // ── Guest wall ──
  if (!currentUser) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 24px">
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#0d9488,#10b981);
                    display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">🔖</div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Saved Reports</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:300px;margin-bottom:24px">
          Save any FinBot analysis or news breakdown and access it from any device. Reports are stored securely with your account.
        </p>
        <button onclick="document.getElementById('auth-overlay').classList.remove('hidden');showAuthTab('login')"
          style="padding:14px 32px;border-radius:14px;background:var(--green);color:#fff;
                 font-size:14px;font-weight:800;border:none;cursor:pointer;margin-bottom:32px;width:100%;max-width:320px">
          Sign In to View Saved Reports
        </button>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;padding:0 4px">What gets saved</p>
      ${[
        { icon:'🤖', col:'#6366f1', title:'FinBot Analyses', desc:'Stock screeners, DCF valuations, risk assessments, earnings previews, portfolio blueprints and technical analyses' },
        { icon:'📰', col:'#7c3aed', title:'News Breakdowns', desc:'AI-powered article summaries with market impact, investor takeaways, and relevant tickers — one tap to re-read' },
      ].map(f => `
        <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:14px;
                    background:var(--card);border:1px solid var(--border);margin-bottom:10px;opacity:.7">
          <div style="width:40px;height:40px;border-radius:12px;background:${f.col}18;flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;font-size:18px">${f.icon}</div>
          <div>
            <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:3px">${f.title}</p>
            <p style="font-size:12px;color:var(--faint);line-height:1.55">${f.desc}</p>
          </div>
        </div>
      `).join('')}
      <div style="margin-top:12px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border)">
        <p style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
          🔒 <strong style="color:var(--text)">Free account required</strong> — sign up in seconds, no credit card needed
        </p>
      </div>
    `;
    return;
  }

  const allReports = getSavedReports();

  if (!allReports.length) {
    el.innerHTML = `
      <div class="section-title"><h2>Saved Reports</h2></div>
      <div class="saved-empty">
        <div class="saved-empty-icon">🔖</div>
        <p style="font-size:15px;font-weight:700;color:var(--text)">No saved reports yet</p>
        <p style="font-size:13px;color:var(--faint);line-height:1.6;max-width:280px">
          Run any analysis in FinBot or analyze a news article and tap <strong style="color:var(--text)">🔖 Save</strong> to keep it here.
        </p>
      </div>`;
    return;
  }

  // ── Apply filters ──
  let reports = allReports;
  if (savedFilter === 'finbot')  reports = reports.filter(r => r.modeId !== 'news');
  else if (savedFilter === 'news')    reports = reports.filter(r => r.modeId === 'news');
  else if (savedFilter === 'starred') reports = reports.filter(r => r.starred);
  if (savedFolderFilter) reports = reports.filter(r => (r.folder || '') === savedFolderFilter);
  if (savedTagFilter)    reports = reports.filter(r => Array.isArray(r.tags) && r.tags.includes(savedTagFilter));
  if (savedSearch.trim()) {
    const q = savedSearch.trim().toLowerCase();
    reports = reports.filter(r =>
      r.modeTitle.toLowerCase().includes(q) ||
      r.content.toLowerCase().includes(q) ||
      (r.note || '').toLowerCase().includes(q) ||
      (Array.isArray(r.tags) && r.tags.some(t => t.toLowerCase().includes(q))) ||
      (r.folder || '').toLowerCase().includes(q)
    );
  }
  if (savedSort === 'oldest') reports = [...reports].sort((a, b) => a.savedAt - b.savedAt);
  else if (savedSort === 'starred') reports = [...reports].sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));

  // ── UI metadata ──
  const finbotCount = allReports.filter(r => r.modeId !== 'news').length;
  const newsCount   = allReports.filter(r => r.modeId === 'news').length;
  const starCount   = allReports.filter(r => r.starred).length;
  const folders     = [...new Set(allReports.map(r => r.folder || '').filter(Boolean))].sort();
  const allTags     = [...new Set(allReports.flatMap(r => Array.isArray(r.tags) ? r.tags : []))].sort();

  const filterBtn = (id, label, count, col) => {
    const active = savedFilter === id;
    return `<button onclick="renderSaved('${id}')"
      style="flex:1;min-width:0;padding:8px 6px;border-radius:10px;font-size:12px;font-weight:700;border:none;cursor:pointer;
             background:${active ? 'var(--card)' : 'transparent'};
             color:${active ? col : 'var(--muted)'};
             box-shadow:${active ? '0 1px 4px rgba(0,0,0,.12)' : 'none'};
             transition:all .15s;white-space:nowrap;text-align:center">
      ${label} <span style="font-size:10px;font-weight:800;opacity:${active ? '.85' : '.45'}">${count}</span>
    </button>`;
  };

  const _srSearchFocused = document.activeElement && document.activeElement.id === 'saved-search-input';
  const _srSel = _srSearchFocused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  el.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h2>Saved Reports</h2>
        <p style="font-size:12px;color:var(--faint);margin-top:4px">${allReports.length} report${allReports.length !== 1 ? 's' : ''} saved to your account</p>
      </div>
      <button onclick="clearAllSavedReports()"
        style="font-size:12px;font-weight:600;color:#fff;background:#ef4444;border:none;cursor:pointer;padding:7px 14px;border-radius:8px;display:flex;align-items:center;gap:6px;transition:background .15s" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        Clear all
      </button>
    </div>

    <!-- Search + Sort row -->
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
      <div style="flex:1;position:relative">
        <svg style="position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.35" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="saved-search-input" class="saved-search" style="margin-bottom:0;padding-left:32px" placeholder="Search reports…"
          value="${escHtml(savedSearch)}" oninput="savedSearch=this.value;renderSaved()">
      </div>
      <select class="saved-sort-select" onchange="savedSort=this.value;renderSaved()">
        <option value="newest"  ${savedSort==='newest' ?'selected':''}>↓ Newest</option>
        <option value="oldest"  ${savedSort==='oldest' ?'selected':''}>↑ Oldest</option>
        <option value="starred" ${savedSort==='starred'?'selected':''}>⭐ First</option>
      </select>
    </div>

    <!-- Segmented type filter -->
    <div style="background:var(--border);border-radius:13px;padding:4px;display:flex;gap:2px;margin-bottom:12px">
      ${filterBtn('all',    'All',       allReports.length, 'var(--green)')}
      ${filterBtn('finbot', '🤖 FinBot', finbotCount,       '#6366f1')}
      ${filterBtn('news',   '📰 News',   newsCount,         '#7c3aed')}
      ${starCount ? filterBtn('starred', '⭐ Starred', starCount, '#f59e0b') : ''}
    </div>

    <!-- Folders + Tags panel -->
    ${(folders.length || allTags.length) ? `
    <div style="margin-bottom:14px;border-radius:12px;border:1.5px solid var(--border);overflow:hidden">
      ${folders.length ? `
      <div style="display:flex;align-items:center;gap:2px;padding:6px 8px;overflow-x:auto;scrollbar-width:none">
        <span style="font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;padding:0 6px">📁 Folder</span>
        <div style="width:1px;height:14px;background:var(--border);flex-shrink:0;margin:0 4px"></div>
        <button class="saved-folder-tab ${!savedFolderFilter?'active':''}" onclick="savedFolderFilter='';renderSaved()">All</button>
        ${folders.map(f => `<button class="saved-folder-tab ${savedFolderFilter===f?'active':''}" onclick="_srFolder(${JSON.stringify(f).replace(/&/g,'&amp;').replace(/"/g,'&quot;')})">${escHtml(f)}</button>`).join('')}
      </div>` : ''}
      ${folders.length && allTags.length ? `<div style="height:1px;background:var(--border)"></div>` : ''}
      ${allTags.length ? `
      <div style="display:flex;align-items:center;gap:2px;padding:6px 8px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;padding:0 6px">🏷 Tags</span>
        <div style="width:1px;height:14px;background:var(--border);flex-shrink:0;margin:0 4px"></div>
        ${allTags.map(t => `<button class="saved-tag-chip ${savedTagFilter===t?'active':''}" onclick="_srTag(${JSON.stringify(t).replace(/&/g,'&amp;').replace(/"/g,'&quot;')})">${escHtml(t)}</button>`).join('')}
      </div>` : ''}
    </div>` : ''}

    <!-- Bulk bar / Export all -->
    ${savedSelected.size ? `
    <div class="saved-bulk-bar">
      <span style="font-size:13px;font-weight:700">${savedSelected.size} selected</span>
      <button onclick="bulkDeleteReports()" style="padding:6px 14px;border-radius:8px;background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700">🗑 Delete</button>
      <button onclick="exportReportsZip([...savedSelected])" style="padding:6px 14px;border-radius:8px;background:var(--blue);color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700">↓ Export .zip</button>
      <button onclick="savedSelected.clear();renderSaved()" style="padding:6px 14px;border-radius:8px;background:var(--border);color:var(--muted);border:none;cursor:pointer;font-size:12px;font-weight:700;margin-left:auto">✕ Deselect</button>
    </div>` : allReports.length >= 2 ? `
    <div style="margin-bottom:12px;text-align:right">
      <button onclick="exportReportsZip()" style="font-size:11px;font-weight:700;color:var(--muted);background:var(--border);border:none;cursor:pointer;padding:6px 12px;border-radius:8px">↓ Export all (.zip)</button>
    </div>` : ''}

    ${reports.length === 0 ? `<div style="text-align:center;padding:40px 20px;color:var(--faint);font-size:13px">No reports match your filters</div>` : ''}
    ${reports.map(r => {
      const date    = new Date(r.savedAt);
      const dateStr = date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
      const timeStr = date.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      const preview = r.content.replace(/[#*_`>~\[\]]/g, '').replace(/\n+/g, ' ').trim().slice(0, 180);
      const tags    = Array.isArray(r.tags) ? r.tags : [];
      const checked = savedSelected.has(r.id);
      return `
        <div class="saved-card">
          <div class="saved-card-header">
            <div class="saved-card-check ${checked?'checked':''}" onclick="toggleSavedSelect('${r.id}')" title="Select">
              ${checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </div>
            <div class="saved-card-meta">
              <div class="saved-card-icon" style="background:${r.modeCol}22">${r.modeIcon}</div>
              <div>
                <div class="saved-card-title">${escHtml(r.modeTitle)}</div>
                <div class="saved-card-sub">${r.modeId === 'news' ? '📰 News Analysis' : 'by ' + escHtml(r.modeSub)} &nbsp;·&nbsp; ${dateStr}, ${timeStr}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button class="saved-card-star ${r.starred?'starred':''}" onclick="toggleReportStar('${r.id}')" title="${r.starred?'Unstar':'Star'}">⭐</button>
              <button onclick="deleteSavedReport('${r.id}')"
                style="background:#ef4444;border:none;cursor:pointer;color:#fff;padding:6px 8px;border-radius:8px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </div>
          ${r.folder ? `<div class="saved-card-folder">📁 ${escHtml(r.folder)}</div>` : ''}
          ${tags.length ? `<div class="saved-card-tags">${tags.map(t => `<span class="saved-tag-chip" onclick="_srTag(${JSON.stringify(t).replace(/&/g,'&amp;').replace(/"/g,'&quot;')})" title="Filter by tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
          <div class="saved-preview">${escHtml(preview)}</div>
          ${r.note ? `<div class="saved-card-note-preview" onclick="openReportEditModal('${r.id}')">📝 ${escHtml(r.note.slice(0,120))}${r.note.length>120?'…':''}</div>` : ''}
          <div class="saved-card-actions">
            <button class="saved-action-btn" style="background:${r.modeCol}18;color:${r.modeCol}"
              onclick="viewSavedReport('${r.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View Report
            </button>
            ${r.modeId === 'news' && r.articleLink ? `
            <a class="saved-action-btn" href="${escHtml(r.articleLink)}" target="_blank" rel="noopener"
              style="background:var(--border);color:var(--text);text-decoration:none">
              ↗ Article
            </a>` : ''}
            <button class="saved-action-btn" style="background:var(--border);color:var(--text)"
              onclick="downloadReport('${r.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M7 12l5 5 5-5"/><path d="M5 20h14"/></svg>
              Download PDF
            </button>
            <button class="saved-action-btn" style="background:var(--border);color:var(--text)"
              onclick="shareReport('${r.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share / Copy
            </button>
            <button class="saved-action-btn" style="background:var(--border);color:var(--text)"
              onclick="openReportEditModal('${r.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Details
            </button>
          </div>
        </div>
      `;
    }).join('')}
  `;

  if (_srSearchFocused) {
    const inp = document.getElementById('saved-search-input');
    if (inp) { inp.focus(); if (_srSel) inp.setSelectionRange(_srSel[0], _srSel[1]); }
  }
}

// ── Update mutable fields on an existing saved report via PUT ──
async function updateReport(id, fields) {
  if (currentUser && dbSavedReports !== null) {
    try {
      const d = await apiCall('data.php?action=saved_reports', 'POST', { id, ...fields });
      if (!d.success) throw new Error(d.error || 'Update failed.');
      const r = dbSavedReports.find(r => r.id === id);
      if (r) Object.assign(r, fields);
    } catch(e) { showToast('Could not update report.'); return false; }
  } else {
    const reports = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    const r = reports.find(r => r.id === id);
    if (!r) { showToast('Report not found.'); return false; }
    Object.assign(r, fields);
    localStorage.setItem(SAVED_KEY, JSON.stringify(reports));
  }
  return true;
}

async function toggleReportStar(id) {
  const r = getSavedReports().find(r => r.id === id);
  if (!r) return;
  const ok = await updateReport(id, { starred: !r.starred });
  if (ok) renderSaved();
}

function toggleSavedSelect(id) {
  if (savedSelected.has(id)) savedSelected.delete(id); else savedSelected.add(id);
  renderSaved();
}

async function bulkDeleteReports() {
  const ids = [...savedSelected];
  if (!ids.length) return;
  const confirmed = await showConfirmModal(
    `Delete ${ids.length} report${ids.length !== 1 ? 's' : ''}?`,
    'This will permanently delete the selected reports. This action cannot be undone.'
  );
  if (!confirmed) return;
  if (currentUser) {
    await Promise.all(ids.map(id => apiCall('data.php?action=saved_reports', 'DELETE', { id }).catch(() => {})));
    if (dbSavedReports) dbSavedReports = dbSavedReports.filter(r => !ids.includes(r.id));
  } else {
    const reports = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]').filter(r => !ids.includes(r.id));
    localStorage.setItem(SAVED_KEY, JSON.stringify(reports));
  }
  savedSelected.clear();
  updateSavedBadge();
  renderSaved();
}

async function exportReportsZip(ids) {
  if (!window.JSZip) { showToast('JSZip not loaded.'); return; }
  const all = getSavedReports();
  const subset = ids ? all.filter(r => ids.includes(r.id)) : all;
  if (!subset.length) return;
  const zip = new JSZip();
  subset.forEach(r => {
    const date = new Date(r.savedAt).toISOString().slice(0, 10);
    const name = `${r.modeTitle.replace(/[^a-z0-9]/gi, '-').slice(0,40)}_${date}_${r.id.slice(-4)}.md`;
    zip.file(name, r.content);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `investeasy-reports-${new Date().toISOString().slice(0,10)}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Exported ${subset.length} report${subset.length !== 1 ? 's' : ''}`);
}

function openReportEditModal(id) {
  const r = getSavedReports().find(r => r.id === id);
  if (!r) return;
  document.getElementById('saved-edit-modal-bd')?.remove();
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const bd = document.createElement('div');
  bd.id = 'saved-edit-modal-bd';
  bd.className = 'saved-modal-backdrop';
  bd.innerHTML = `
    <div class="saved-modal" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-size:16px;font-weight:800;color:var(--text)">Edit Report Details</div>
        <button onclick="document.getElementById('saved-edit-modal-bd').remove()"
          style="background:var(--border);border:none;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:18px;color:var(--muted);display:flex;align-items:center;justify-content:center;line-height:1">×</button>
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:6px">Report Name</label>
        <input id="edit-name" type="text" value="${escHtml(r.modeTitle||'')}" maxlength="255" placeholder="Report name" class="saved-search" style="margin-bottom:0">
      </div>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:16px;cursor:pointer">
        <input type="checkbox" id="edit-starred" ${r.starred?'checked':''} style="width:16px;height:16px;accent-color:var(--amber)">
        <span style="font-size:13px;font-weight:600;color:var(--text)">⭐ Starred</span>
      </label>
      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:6px">Folder</label>
        <input id="edit-folder" type="text" value="${escHtml(r.folder||'')}" maxlength="100" placeholder="e.g. Tech Stocks" class="saved-search" style="margin-bottom:0">
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:6px">Tags</label>
        <div id="edit-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${tags.map(t => `<span class="saved-tag-chip active" data-tag="${escHtml(t)}">${escHtml(t)}<button onclick="this.closest('[data-tag]').remove()" style="background:none;border:none;cursor:pointer;color:inherit;padding:0;margin-left:3px;font-size:12px;line-height:1">×</button></span>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input id="edit-tag-input" type="text" placeholder="Add tag…" maxlength="30" class="saved-search" style="margin-bottom:0;flex:1"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addEditTag()}">
          <button onclick="addEditTag()" style="padding:8px 14px;border-radius:10px;background:var(--amber);color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap">+ Add</button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:6px">Private Note</label>
        <textarea id="edit-note" rows="3" maxlength="10000" placeholder="Your private notes about this report…"
          style="width:100%;padding:10px 14px;border-radius:12px;background:var(--border);font-size:13px;color:var(--text);border:1.5px solid transparent;resize:vertical;font-family:inherit;transition:all .2s;box-sizing:border-box"
          onfocus="this.style.borderColor='var(--green)'" onblur="this.style.borderColor='transparent'">${escHtml(r.note||'')}</textarea>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('saved-edit-modal-bd').remove()"
          style="flex:1;padding:11px;border-radius:12px;border:1.5px solid var(--border);background:transparent;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer">Cancel</button>
        <button onclick="saveReportEdits('${id}')"
          style="flex:2;padding:11px;border-radius:12px;border:none;background:var(--green);font-size:13px;font-weight:700;color:#fff;cursor:pointer">Save Changes</button>
      </div>
    </div>`;
  bd.onclick = () => bd.remove();
  document.body.appendChild(bd);
}

function addEditTag() {
  const input = document.getElementById('edit-tag-input');
  const val = input.value.trim();
  if (!val) return;
  const list = document.getElementById('edit-tags-list');
  const existing = [...list.querySelectorAll('[data-tag]')].map(el => el.dataset.tag);
  if (existing.includes(val) || existing.length >= 20) return;
  const chip = document.createElement('span');
  chip.className = 'saved-tag-chip active';
  chip.dataset.tag = val;
  chip.innerHTML = `${escHtml(val)}<button onclick="this.closest('[data-tag]').remove()" style="background:none;border:none;cursor:pointer;color:inherit;padding:0;margin-left:3px;font-size:12px;line-height:1">×</button>`;
  list.appendChild(chip);
  input.value = '';
  input.focus();
}

async function saveReportEdits(id) {
  const modeTitle = document.getElementById('edit-name').value.trim();
  const starred   = document.getElementById('edit-starred').checked;
  const folder    = document.getElementById('edit-folder').value.trim();
  const note      = document.getElementById('edit-note').value.trim();
  const tags      = [...document.querySelectorAll('#edit-tags-list [data-tag]')].map(el => el.dataset.tag);
  document.getElementById('saved-edit-modal-bd').remove();
  const ok = await updateReport(id, { modeTitle, starred, folder, note, tags });
  if (ok) { renderSaved(); showToast('Report updated!'); }
}

function showConfirmModal(title, message) {
  return new Promise(resolve => {
    let modal = document.getElementById('ie-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ie-confirm-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)';
      modal.innerHTML = `
        <div style="background:var(--card,#fff);border-radius:16px;padding:28px 28px 22px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center">
          <div style="width:52px;height:52px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </div>
          <div id="ie-confirm-title" style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:8px"></div>
          <div id="ie-confirm-msg" style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:22px"></div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button id="ie-confirm-cancel" style="flex:1;padding:10px 0;border-radius:10px;border:1.5px solid var(--border,#e5e7eb);background:transparent;font-size:13px;font-weight:600;color:var(--text);cursor:pointer">Cancel</button>
            <button id="ie-confirm-ok" style="flex:1;padding:10px 0;border-radius:10px;border:none;background:#ef4444;font-size:13px;font-weight:600;color:#fff;cursor:pointer">Clear all</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('ie-confirm-title').textContent = title;
    document.getElementById('ie-confirm-msg').textContent = message;
    modal.style.display = 'flex';
    const close = val => { modal.style.display = 'none'; resolve(val); };
    document.getElementById('ie-confirm-ok').onclick = () => close(true);
    document.getElementById('ie-confirm-cancel').onclick = () => close(false);
    modal.onclick = e => { if (e.target === modal) close(false); };
  });
}

function showToast(msg, duration = 2400) {
  let t = document.getElementById('ie-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ie-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(-90px)'; }, duration);
}

// Init saved badge on page load
updateSavedBadge();

// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO TAB
// ═══════════════════════════════════════════════════════════════════════════

let portChart = null;
let portPerfChart = null;

// ─── Interactive Donut Chart (Canvas) ────────────────────────────────────────
function makeDonut(canvasEl, segments) {
  // segments: [{label, pct, color}]
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const SIZE = 140, cx = 70, cy = 70, OUTER = 57, INNER = 33;
  canvasEl.width  = SIZE * dpr;
  canvasEl.height = SIZE * dpr;
  canvasEl.style.width  = SIZE + 'px';
  canvasEl.style.height = SIZE + 'px';
  const ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);
  let hov = -1;

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    let start = -Math.PI / 2;
    segments.forEach((seg, i) => {
      const sweep = (seg.pct / 100) * Math.PI * 2;
      const isH = i === hov;
      ctx.save();
      if (isH) ctx.translate(Math.cos(start + sweep / 2) * 4, Math.sin(start + sweep / 2) * 4);
      ctx.beginPath();
      ctx.arc(cx, cy, isH ? OUTER + 5 : OUTER, start, start + sweep);
      ctx.arc(cx, cy, INNER, start + sweep, start, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.globalAlpha = isH ? 1 : 0.86;
      ctx.fill();
      ctx.restore();
      start += sweep;
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textCol = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1e293b';
    if (hov >= 0) {
      const s = segments[hov];
      ctx.fillStyle = textCol;
      ctx.font = 'bold 13px system-ui,sans-serif';
      ctx.fillText(s.label, cx, cy - 7);
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui,sans-serif';
      ctx.fillText(s.pct.toFixed(1) + '%', cx, cy + 9);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 9px system-ui,sans-serif';
      ctx.fillText('ALLOCATION', cx, cy - 6);
      ctx.font = '9px system-ui,sans-serif';
      ctx.fillText(segments.length + ' holdings', cx, cy + 7);
    }
  }

  function hitIdx(mx, my) {
    const dx = mx - cx, dy = my - cy, d = Math.sqrt(dx * dx + dy * dy);
    if (d < INNER || d > OUTER + 8) return -1;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    let start = 0;
    for (let i = 0; i < segments.length; i++) {
      const sweep = (segments[i].pct / 100) * Math.PI * 2;
      if (a >= start && a < start + sweep) return i;
      start += sweep;
    }
    return segments.length - 1;
  }

  canvasEl.style.cursor = 'pointer';
  canvasEl.addEventListener('mousemove', e => {
    const r = canvasEl.getBoundingClientRect();
    const i = hitIdx(e.clientX - r.left, e.clientY - r.top);
    if (i !== hov) { hov = i; draw(); }
  });
  canvasEl.addEventListener('mouseleave', () => { if (hov !== -1) { hov = -1; draw(); } });
  canvasEl.addEventListener('click', e => {
    const r = canvasEl.getBoundingClientRect();
    const i = hitIdx(e.clientX - r.left, e.clientY - r.top);
    hov = i === hov ? -1 : i; draw();
  });
  draw();
}

// ─── Portfolio Performance Chart with period tabs ─────────────────────────────
function createPerfChart(container, data, color, height) {
  if (!container || !data.length) return null;
  container.innerHTML = '';
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 300, height,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
    grid: { vertLines: { visible: false }, horzLines: { color: '#1e293b30' } },
    crosshair: {
      mode: 1,
      vertLine: { color: color + '80', labelBackgroundColor: color },
      horzLine: { color: color + '80', labelBackgroundColor: color },
    },
    rightPriceScale: { borderVisible: false, textColor: '#94a3b8' },
    timeScale: { borderVisible: false, timeVisible: false },
    handleScroll: false, handleScale: false,
  });
  const series = chart.addAreaSeries({
    lineColor: color, lineWidth: 2.5,
    topColor: color + '35', bottomColor: color + '00',
    priceLineVisible: false, lastValueVisible: true,
    crosshairMarkerRadius: 5, crosshairMarkerBackgroundColor: color,
  });
  series.setData(data.map((d, i) => ({ time: i + 1, value: d.value })));
  chart.timeScale().fitContent();
  return chart;
}

function initPerfChart(allData, color) {
  const wrap = document.getElementById('port-perf-wrap');
  if (!wrap) return;
  const chartEl = wrap.querySelector('.perf-chart-area');
  if (!chartEl) return;
  function renderRange(range) {
    let slice = allData;
    if (range === '1m') slice = allData.slice(-4);
    else if (range === '3m') slice = allData.slice(-3);
    else if (range === '6m') slice = allData.slice(-6);
    if (portPerfChart) { try { portPerfChart.remove(); } catch (e) {} portPerfChart = null; }
    const rate = curCfg().rate;
    portPerfChart = createPerfChart(chartEl, slice.map((p, i) => ({ time: i + 1, value: p.v * rate })), color, 170);
  }
  wrap.querySelectorAll('.perf-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.perf-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRange(btn.dataset.range);
    });
  });
  renderRange('1y');
}

function animatePnlBars() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.pnl-bar-fill[data-w]').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

// Simulate portfolio history from cost→current over 12 monthly points
function genPortHistory(totalCost, total) {
  const base  = totalCost * 0.95;
  const range = total - base;
  return Array.from({ length: 12 }, (_, i) => {
    const t    = i / 11;
    const ease = t * t * (3 - 2 * t);
    const noise = (Math.sin(i * 2.3) * 0.03 + Math.cos(i * 1.7) * 0.02) * base;
    return { t: i, v: Math.max(0, base + range * ease + noise) };
  });
}

function portCurrencyBar() {
  const cur = loadSettings().currency;
  return `<div class="portfolio-currency-row">
    ${Object.entries(CURRENCY_CONFIG).map(([code, cfg]) => `
      <button onclick="saveSettings({currency:'${code}'})"
        style="flex-shrink:0;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;
               border:1.5px solid ${cur===code?'var(--green)':'var(--border)'};
               background:${cur===code?'var(--green-bg)':'transparent'};
               color:${cur===code?'var(--green)':'var(--muted)'};cursor:pointer;white-space:nowrap;
               transition:all .15s">
        ${cfg.symbol}&thinsp;${code}
      </button>
    `).join('')}
  </div>`;
}

function portfolioDashboardHeading(title, subtitle, actionHtml = '') {
  return `
    <div class="portfolio-intro">
      <div class="portfolio-welcome">
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      ${actionHtml || ''}
    </div>
  `;
}

function portfolioStatCard(icon, value, label) {
  return `
    <div class="dashboard-stat-card">
      <div class="dashboard-stat-icon">${icon}</div>
      <div>
        <div class="dashboard-stat-value">${value}</div>
        <div class="dashboard-stat-label">${label}</div>
      </div>
    </div>
  `;
}

function portfolioBars(items) {
  const max = Math.max(...items.map(item => item.value), 1);
  return `
    <div class="portfolio-bars">
      ${items.map(item => `
        <div class="portfolio-bar-item">
          <div class="portfolio-bar-value">${item.display}</div>
          <div class="portfolio-bar-track">
            <div class="portfolio-bar-fill" style="height:${Math.max((item.value / max) * 100, item.value > 0 ? 12 : 5)}%"></div>
          </div>
          <div class="portfolio-bar-label">${item.label}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function portfolioCategoryRows(items) {
  const max = Math.max(...items.map(item => item.pct), 1);
  return `
    <div class="category-list">
      ${items.map(item => `
        <div class="category-item">
          <div class="category-name">${item.name}</div>
          <div class="category-track">
            <div class="category-fill" style="width:${Math.max((item.pct / max) * 100, item.pct > 0 ? 10 : 0)}%"></div>
          </div>
          <div class="category-value">${item.value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPortfolioDemoDashboard() {
  const total = HOLDINGS.reduce((s,h) => s + h.shares * h.cur, 0);
  const cost = HOLDINGS.reduce((s,h) => s + h.shares * h.cost, 0);
  const pnl = total - cost;
  const pnlP = ((pnl / cost) * 100).toFixed(2);
  const up = pnl > 0;
  const maxDemoPct = Math.max(...HOLDINGS.map(h => Math.abs((h.cur - h.cost) / h.cost * 100))) || 1;
  const best = [...HOLDINGS].sort((a,b) => ((b.cur - b.cost) / b.cost) - ((a.cur - a.cost) / a.cost))[0];
  const monthBars = ['Nov','Dec','Jan','Feb','Mar','Apr'].map((label, index) => ({ label, value:index === 5 ? HOLDINGS.length : 0, display:index === 5 ? String(HOLDINGS.length) : '0' }));
  const categories = HOLDINGS.map(h => ({ name:h.ticker, pct:h.alloc, value:h.alloc + '%' })).sort((a,b) => b.pct - a.pct).slice(0,4);

  document.getElementById('tab-portfolio').innerHTML = `
    ${portfolioDashboardHeading('Welcome back', 'Here’s a calmer overview of your demo portfolio with the cleaner dashboard feel you liked.')}

    ${portCurrencyBar()}

    <div class="dashboard-stats">
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`, fmtMoney(total), 'Portfolio value')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>`, HOLDINGS.length, 'Active holdings')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M7 7h10"/><path d="M7 17h10"/></svg>`, `${up?'+':''}${pnlP}%`, 'Total return')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/><path d="M10 4v16"/></svg>`, HOLDINGS.length, 'Tracked assets')}
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Holdings over time</div>
            <div class="dashboard-panel-subtitle">A simplified monthly activity view in the same spirit as your reference.</div>
          </div>
        </div>
        ${portfolioBars(monthBars)}
      </div>
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Top allocations</div>
            <div class="dashboard-panel-subtitle">Where most of your demo capital is concentrated.</div>
          </div>
        </div>
        ${portfolioCategoryRows(categories)}
      </div>
    </div>

    <div class="port-perf-card" id="port-perf-wrap">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Performance</div>
          <div class="dashboard-panel-subtitle">Your value trend across the selected time window.</div>
        </div>
        <div class="perf-tabs">
          <button class="perf-tab" data-range="1m">1M</button>
          <button class="perf-tab" data-range="3m">3M</button>
          <button class="perf-tab" data-range="6m">6M</button>
          <button class="perf-tab active" data-range="1y">1Y</button>
        </div>
      </div>
      <div class="perf-chart-area" style="height:170px"></div>
    </div>

    <div class="alloc-card">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Allocation</div>
          <div class="dashboard-panel-subtitle">A cleaner breakdown by holding, value, and contribution.</div>
        </div>
        <div style="font-size:12px;color:${up?'var(--green)':'var(--red)'};font-weight:700">${up?'▲':'▼'} ${fmtMoney(Math.abs(pnl))}</div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        <div style="flex:1">
          ${HOLDINGS.map((h, i) => {
            const val = h.shares * h.cur;
            return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:7px">
                <span class="alloc-dot" style="background:${ALLOC_COLORS[i]}"></span>
                <div>
                  <p style="font-size:12px;font-weight:700;color:var(--text);line-height:1.3">${h.ticker}</p>
                  <p style="font-size:10px;color:var(--faint);line-height:1.2">${h.name}</p>
                </div>
              </div>
              <div style="text-align:right">
                <p style="font-size:12px;font-weight:700;color:var(--text)">${fmtMoney(val)}</p>
                <p style="font-size:11px;color:var(--muted)">${h.alloc}%</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Value</p>
          ${(() => {
            const maxV = Math.max(...HOLDINGS.map(h => h.shares * h.cur));
            return HOLDINGS.map((h, i) => {
              const val = h.shares * h.cur;
              const bw = (val / maxV * 100).toFixed(1);
              return `<div style="margin-bottom:6px">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                  <span style="font-size:10px;color:var(--faint)">${fmtMoney(val)}</span>
                </div>
                <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                  <div class="pnl-bar-fill" data-w="${bw}" style="background:${ALLOC_COLORS[i]};opacity:.9"></div>
                </div>
              </div>`;
            }).join('');
          })()}
        </div>
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Return</p>
          ${HOLDINGS.map(h => {
            const retPct = (h.cur - h.cost) / h.cost * 100;
            const bw = (Math.abs(retPct) / maxDemoPct * 100).toFixed(1);
            const isUp = retPct >= 0;
            return `<div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                <span style="font-size:10px;font-weight:700;color:${isUp?'var(--green)':'var(--red)'}">${isUp?'+':''}${retPct.toFixed(1)}%</span>
              </div>
              <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                <div class="pnl-bar-fill" data-w="${bw}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="pnl-bars-card">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">P&amp;L by holding</div>
          <div class="dashboard-panel-subtitle">A quick scan of which positions are strongest.</div>
        </div>
        <div style="font-size:12px;color:var(--muted)">Best performer: ${best.ticker}</div>
      </div>
      ${HOLDINGS.map(h => {
        const pct = (h.cur - h.cost) / h.cost * 100;
        const barW = (Math.abs(pct) / maxDemoPct * 100).toFixed(1);
        const isUp = pct >= 0;
        return `<div class="pnl-bar-row">
          <div class="pnl-bar-label">${h.ticker}</div>
          <div class="pnl-bar-track">
            <div class="pnl-bar-fill" data-w="${barW}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
          </div>
          <div class="pnl-bar-val ${isUp?'up':'dn'}">${isUp?'+':''}${pct.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>

    <div class="dashboard-panel-header">
      <div>
        <div class="dashboard-panel-title">Holdings</div>
        <div class="dashboard-panel-subtitle">Each position with value, cost basis, and allocation.</div>
      </div>
    </div>
    ${HOLDINGS.map(h => {
      const val = h.shares * h.cur;
      const gain = (h.cur - h.cost) * h.shares;
      const pct = ((h.cur - h.cost) / h.cost * 100).toFixed(2);
      const hUp = gain >= 0;
      return `
        <div class="holding-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                <span class="mono" style="font-weight:700;font-size:15px;color:var(--text)">${h.ticker}</span>
                <span style="font-size:11px;color:var(--faint)">${h.shares} shares</span>
              </div>
              <p style="font-size:12px;color:var(--faint)">${h.name}</p>
            </div>
            <div style="text-align:right">
              <p class="mono" style="font-weight:700;font-size:15px;color:var(--text)">${fmtMoney(val)}</p>
              <span class="mono ${hUp?'up':'dn'}" style="font-size:12px;font-weight:700">${hUp?'▲':'▼'} ${fmtMoney(Math.abs(gain))} (${pct}%)</span>
            </div>
          </div>
          <div class="holding-stats">
            ${[{l:'Avg Cost',v:fmtUnitPrice(h.cost)},{l:'Current',v:fmtUnitPrice(h.cur)},{l:'Allocation',v:h.alloc+'%'}].map(s =>
              `<div class="holding-stat"><p class="hl">${s.l}</p><p class="hv">${s.v}</p></div>`
            ).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;

  requestAnimationFrame(() => {
    if (portPerfChart) { try { portPerfChart.remove(); } catch(e){} portPerfChart = null; }
    initPerfChart(PORT_HIST, '#10b981');
    const donut = document.getElementById('port-donut');
    if (donut) makeDonut(donut, HOLDINGS.map((h, i) => ({ label: h.ticker, pct: h.alloc, color: ALLOC_COLORS[i] })));
    animatePnlBars();
  });
}

function renderEmptyPortfolioDashboard() {
  document.getElementById('tab-portfolio').innerHTML = `
    ${portfolioDashboardHeading('Portfolio', 'Track your real holdings in the new cleaner dashboard view.', `<button onclick="openAddHoldingModal()" class="portfolio-action">+ Add first holding</button>`)}
    <div class="dashboard-panel" style="text-align:center;padding:60px 20px 40px">
      <div style="font-size:52px;margin-bottom:16px">ðŸ“Š</div>
      <p style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px">No holdings yet</p>
      <p style="font-size:13px;color:var(--faint);line-height:1.6;margin-bottom:24px">
        Add your first stock, ETF or crypto holding to start tracking your portfolio.
      </p>
      <button onclick="openAddHoldingModal()" style="padding:14px 28px;border-radius:14px;
        background:var(--green);color:#fff;font-weight:800;font-size:14px">
        + Add First Holding
      </button>
    </div>
  `;
}

function renderPortfolio() {
  // If logged in and have DB portfolio data, render that instead of demo data
  if (currentUser && dbPortfolio.length > 0) {
    renderDBPortfolio();
    return;
  }
  // If logged in but empty portfolio, show onboarding
  if (currentUser && dbPortfolio.length === 0) {
    renderEmptyPortfolio();
    return;
  }

  renderPortfolioDemoDashboard();
  return;

  // Demo portfolio (not logged in)
  const total = HOLDINGS.reduce((s,h) => s + h.shares * h.cur, 0);
  const cost = HOLDINGS.reduce((s,h) => s + h.shares * h.cost, 0);
  const pnl = total - cost;
  const pnlP = ((pnl / cost) * 100).toFixed(2);
  const up = pnl > 0;

  const maxDemoPct = Math.max(...HOLDINGS.map(h => Math.abs((h.cur - h.cost) / h.cost * 100))) || 1;

  document.getElementById('tab-portfolio').innerHTML = `
    <div class="section-title"><h2>My Portfolio</h2><p>Demo portfolio · 5 holdings</p></div>

    ${portCurrencyBar()}

    <!-- Hero: summary numbers only -->
    <div class="port-hero">
      <p style="font-size:11px;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase">Total Value</p>
      <p class="mono" style="font-size:32px;font-weight:500;color:#fff;margin:4px 0 2px">${fmtMoney(total)}</p>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="chip ${up?'chip-green':'chip-red'}" style="font-size:13px;font-weight:700;font-family:var(--mono)">
          ${up?'▲':'▼'} ${fmtMoney(Math.abs(pnl))} (${pnlP}%)
        </span>
        <span style="font-size:12px;color:var(--muted)">All time</span>
      </div>
    </div>

    <!-- Performance chart card with period tabs -->
    <div class="port-perf-card" id="port-perf-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p style="font-weight:800;font-size:13px;color:var(--text)">Performance</p>
        <div class="perf-tabs">
          <button class="perf-tab" data-range="1m">1M</button>
          <button class="perf-tab" data-range="3m">3M</button>
          <button class="perf-tab" data-range="6m">6M</button>
          <button class="perf-tab active" data-range="1y">1Y</button>
        </div>
      </div>
      <div class="perf-chart-area" style="height:170px"></div>
    </div>

    <!-- Allocation: interactive canvas donut + legend + mini charts -->
    <div class="alloc-card">
      <p style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:14px">Allocation</p>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        <div style="flex:1">
          ${HOLDINGS.map((h, i) => {
            const val = h.shares * h.cur;
            return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:7px">
                <span class="alloc-dot" style="background:${ALLOC_COLORS[i]}"></span>
                <div>
                  <p style="font-size:12px;font-weight:700;color:var(--text);line-height:1.3">${h.ticker}</p>
                  <p style="font-size:10px;color:var(--faint);line-height:1.2">${h.name}</p>
                </div>
              </div>
              <div style="text-align:right">
                <p style="font-size:12px;font-weight:700;color:var(--text)">${fmtMoney(val)}</p>
                <p style="font-size:11px;color:var(--muted)">${h.alloc}%</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--border);border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Value</p>
          ${(() => {
            const maxV = Math.max(...HOLDINGS.map(h => h.shares * h.cur));
            return HOLDINGS.map((h, i) => {
              const val = h.shares * h.cur;
              const bw = (val / maxV * 100).toFixed(1);
              return `<div style="margin-bottom:6px">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                  <span style="font-size:10px;color:var(--faint)">${fmtMoney(val)}</span>
                </div>
                <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                  <div class="pnl-bar-fill" data-w="${bw}" style="background:${ALLOC_COLORS[i]};opacity:.9"></div>
                </div>
              </div>`;
            }).join('');
          })()}
        </div>
        <div style="background:var(--border);border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Return</p>
          ${HOLDINGS.map(h => {
            const pnlP = (h.cur - h.cost) / h.cost * 100;
            const bw = (Math.abs(pnlP) / maxDemoPct * 100).toFixed(1);
            const isUp = pnlP >= 0;
            return `<div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                <span style="font-size:10px;font-weight:700;color:${isUp?'var(--green)':'var(--red)'}">${isUp?'+':''}${pnlP.toFixed(1)}%</span>
              </div>
              <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                <div class="pnl-bar-fill" data-w="${bw}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- P&L breakdown bars -->
    <div class="pnl-bars-card">
      <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:12px">P&amp;L by Holding</p>
      ${HOLDINGS.map(h => {
        const pct = (h.cur - h.cost) / h.cost * 100;
        const barW = (Math.abs(pct) / maxDemoPct * 100).toFixed(1);
        const isUp = pct >= 0;
        return `<div class="pnl-bar-row">
          <div class="pnl-bar-label">${h.ticker}</div>
          <div class="pnl-bar-track">
            <div class="pnl-bar-fill" data-w="${barW}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
          </div>
          <div class="pnl-bar-val ${isUp?'up':'dn'}">${isUp?'+':''}${pct.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>

    <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px">Holdings</p>
    ${HOLDINGS.map(h => {
      const val = h.shares * h.cur;
      const gain = (h.cur - h.cost) * h.shares;
      const pct = ((h.cur - h.cost) / h.cost * 100).toFixed(2);
      const hUp = gain >= 0;
      return `
        <div class="holding-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                <span class="mono" style="font-weight:500;font-size:15px;color:var(--text)">${h.ticker}</span>
                <span style="font-size:11px;color:var(--faint)">${h.shares} shares</span>
              </div>
              <p style="font-size:12px;color:var(--faint)">${h.name}</p>
            </div>
            <div style="text-align:right">
              <p class="mono" style="font-weight:500;font-size:15px;color:var(--text)">${fmtMoney(val)}</p>
              <span class="mono ${hUp?'up':'dn'}" style="font-size:12px;font-weight:700">${hUp?'▲':'▼'} ${fmtMoney(Math.abs(gain))} (${pct}%)</span>
            </div>
          </div>
          <div class="holding-stats">
            ${[{l:'Avg Cost',v:fmtUnitPrice(h.cost)},{l:'Current',v:fmtUnitPrice(h.cur)},{l:'Allocation',v:h.alloc+'%'}].map(s =>
              `<div class="holding-stat"><p class="hl">${s.l}</p><p class="hv">${s.v}</p></div>`
            ).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;

  requestAnimationFrame(() => {
    if (portPerfChart) { try { portPerfChart.remove(); } catch(e){} portPerfChart = null; }
    initPerfChart(PORT_HIST, '#10b981');
    const donut = document.getElementById('port-donut');
    if (donut) makeDonut(donut, HOLDINGS.map((h, i) => ({ label: h.ticker, pct: h.alloc, color: ALLOC_COLORS[i] })));
    animatePnlBars();
  });
}

function renderEmptyPortfolio() {
  renderEmptyPortfolioDashboard();
  return;

  document.getElementById('tab-portfolio').innerHTML = `
    <div class="section-title"><h2>Portfolio</h2><p>Track your real holdings</p></div>
    <div style="text-align:center;padding:60px 20px 40px">
      <div style="font-size:52px;margin-bottom:16px">📊</div>
      <p style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px">No holdings yet</p>
      <p style="font-size:13px;color:var(--faint);line-height:1.6;margin-bottom:24px">
        Add your first stock, ETF or crypto holding to start tracking your portfolio.
      </p>
      <button onclick="openAddHoldingModal()" style="padding:14px 28px;border-radius:14px;
        background:var(--green);color:#fff;font-weight:800;font-size:14px">
        + Add First Holding
      </button>
    </div>
  `;
}

function analyzePortfolioWithFinBot() {
  if (!dbPortfolio.length) return;
  const tot = dbPortfolio.reduce((s, h) => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    return s + h.shares * (mkt ? mkt.val : h.avg_cost);
  }, 0);
  finbotForm.portfolio = dbPortfolio.map(h => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    const val = h.shares * (mkt ? mkt.val : h.avg_cost);
    const pct = tot > 0 ? ((val / tot) * 100).toFixed(1) : '0';
    return `${h.ticker} ${pct}%`;
  }).join(', ');
  finbotForm.portVal = fmtMoney(tot);
  finbotState.mode = 'risk';
  finbotState.result = null;
  finbotState.error = null;
  finbotState.loading = false;
  switchTab('finbot');
}

function renderDBPortfolio() {
  const COLORS = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ec4899','#06b6d4','#ef4444','#f97316'];
  const SECTOR_MAP = {
    AAPL:'Tech',MSFT:'Tech',GOOGL:'Tech',GOOG:'Tech',NVDA:'Tech',META:'Tech',AMZN:'Tech',
    TSLA:'Tech',AMD:'Tech',INTC:'Tech',NFLX:'Tech',CRM:'Tech',ORCL:'Tech',ADBE:'Tech',
    PYPL:'Tech',SHOP:'Tech',UBER:'Tech',SNOW:'Tech',PLTR:'Tech',DDOG:'Tech',NET:'Tech',
    CRWD:'Tech',PINS:'Tech',RBLX:'Tech',SNAP:'Tech',
    JPM:'Finance',BAC:'Finance',GS:'Finance',MS:'Finance',WFC:'Finance',
    V:'Finance',MA:'Finance',AXP:'Finance',C:'Finance',BLK:'Finance',
    JNJ:'Healthcare',PFE:'Healthcare',UNH:'Healthcare',ABBV:'Healthcare',
    MRK:'Healthcare',LLY:'Healthcare',TMO:'Healthcare',ABT:'Healthcare',MRNA:'Healthcare',
    XOM:'Energy',CVX:'Energy',COP:'Energy',SLB:'Energy',BP:'Energy',
    WMT:'Consumer',HD:'Consumer',MCD:'Consumer',COST:'Consumer',NKE:'Consumer',
    SBUX:'Consumer',TGT:'Consumer',DIS:'Consumer',
    CAT:'Industrial',BA:'Industrial',GE:'Industrial',HON:'Industrial',
    SPY:'ETF',QQQ:'ETF',VOO:'ETF',VTI:'ETF',IWM:'ETF',GLD:'ETF',
    SLV:'ETF',TLT:'ETF',ARKK:'ETF',USO:'ETF',
    BTC:'Crypto',ETH:'Crypto',SOL:'Crypto',XRP:'Crypto',DOGE:'Crypto',
    ADA:'Crypto',GBTC:'Crypto',ETHE:'Crypto',IBIT:'Crypto',FBTC:'Crypto',
    PDBC:'Commodities',DBC:'Commodities',PLTM:'Commodities',
    // JSE — South Africa
    NPN:'Tech',PRX:'Tech',
    BHG:'Mining',AGL:'Mining',GLN:'Mining',ANG:'Mining',IMP:'Mining',
    CFR:'Consumer',SHP:'Consumer',
    FSR:'Finance',SBK:'Finance',CPI:'Finance',ABG:'Finance',NED:'Finance',SLM:'Finance',DSY:'Finance',OMU:'Finance',
    MTN:'Telecom',
    SOLJ:'Energy',
    MNP:'Industrial',
  };
  const SECTOR_COLORS = {
    Tech:'#6366f1',Finance:'#3b82f6',Healthcare:'#10b981',Crypto:'#f59e0b',
    ETF:'#8b5cf6',Energy:'#f97316',Consumer:'#ec4899',Industrial:'#06b6d4',
    Commodities:'#84cc16',Mining:'#d97706',Telecom:'#0891b2',Other:'#94a3b8',
  };

  // Enrich holdings with current prices
  const holdings = dbPortfolio.map(h => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    const cur  = mkt ? mkt.val : h.avg_cost;
    const val  = h.shares * cur;
    const cost = h.shares * h.avg_cost;
    const pnl  = val - cost;
    const pnlP = h.avg_cost > 0 ? ((cur - h.avg_cost) / h.avg_cost * 100) : 0;
    return { ...h, cur, val, cost, pnl, pnlP };
  });

  const total     = holdings.reduce((s, h) => s + h.val, 0);
  const totalCost = holdings.reduce((s, h) => s + h.cost, 0);
  const totalPnl  = total - totalCost;
  const totalPnlP = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(2) : '0.00';
  const up        = totalPnl >= 0;
  const maxPnlPct = Math.max(...holdings.map(h => Math.abs(h.pnlP))) || 1;
  const perfData  = genPortHistory(totalCost, total);

  // Metrics
  const sortedByPnl = [...holdings].sort((a, b) => b.pnlP - a.pnlP);
  const best    = sortedByPnl[0];
  const worst   = sortedByPnl[sortedByPnl.length - 1];
  const gainers = holdings.filter(h => h.pnl >= 0).length;
  const losers  = holdings.length - gainers;
  const sectors = new Set(holdings.map(h => SECTOR_MAP[h.ticker] || 'Other'));
  const divScore = Math.min(100, Math.round(holdings.length * 10 + sectors.size * 8));

  // Sector breakdown
  const sectorTotals = {};
  holdings.forEach(h => {
    const sec = SECTOR_MAP[h.ticker] || 'Other';
    sectorTotals[sec] = (sectorTotals[sec] || 0) + h.val;
  });
  const sectorList = Object.entries(sectorTotals)
    .map(([name, val]) => ({ name, val, pct: total > 0 ? (val / total * 100) : 0 }))
    .sort((a, b) => b.val - a.val);
  const maxSectorPct = sectorList[0]?.pct || 1;

  // Apply filter + sort to holdings list
  let filtered = portFilter === 'gainers' ? holdings.filter(h => h.pnl >= 0)
               : portFilter === 'losers'  ? holdings.filter(h => h.pnl < 0)
               : [...holdings];
  if (portSort === 'pnl_pct') filtered.sort((a, b) => b.pnlP - a.pnlP);
  else if (portSort === 'ticker') filtered.sort((a, b) => a.ticker.localeCompare(b.ticker));
  else filtered.sort((a, b) => b.val - a.val); // default: value

  const filterBtn = (id, label) => {
    const active = portFilter === id;
    return `<button onclick="portFilter='${id}';renderDBPortfolio()"
      style="padding:5px 11px;border-radius:20px;font-size:11px;font-weight:700;border:1.5px solid ${active?'var(--green)':'var(--border)'};
             background:${active?'var(--green-bg)':'transparent'};color:${active?'var(--green)':'var(--muted)'};cursor:pointer;white-space:nowrap">
      ${label}
    </button>`;
  };

  const monthBars = ['Nov','Dec','Jan','Feb','Mar','Apr'].map((label, index) => ({
    label,
    value: index === 5 ? holdings.length : Math.max(0, Math.round((holdings.length / 6) * index * 0.2)),
    display: index === 5 ? String(holdings.length) : String(Math.max(0, Math.round((holdings.length / 6) * index * 0.2)))
  }));
  const topCategories = sectorList.slice(0, 4).map(s => ({ name: s.name, pct: s.pct, value: s.pct.toFixed(1) + '%' }));

  document.getElementById('tab-portfolio').innerHTML = `
    ${portfolioDashboardHeading('Welcome back', 'Here’s a cleaner view of your live portfolio, with calmer surfaces and easier hierarchy.', `<button onclick="openAddHoldingModal()" class="portfolio-action">+ Add holding</button>`)}

    ${portCurrencyBar()}

    <div class="dashboard-stats">
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`, fmtMoney(total), 'Portfolio value')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>`, holdings.length, 'Active holdings')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M7 7h10"/><path d="M7 17h10"/></svg>`, `${up?'+':''}${totalPnlP}%`, 'Portfolio return')}
      ${portfolioStatCard(`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/><path d="M10 4v16"/></svg>`, sectors.size, 'Sectors covered')}
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Holdings over time</div>
            <div class="dashboard-panel-subtitle">A soft monthly activity snapshot modeled on the clean admin layout you shared.</div>
          </div>
        </div>
        ${portfolioBars(monthBars)}
      </div>
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Top categories</div>
            <div class="dashboard-panel-subtitle">Where most of your current portfolio is concentrated.</div>
          </div>
        </div>
        ${portfolioCategoryRows(topCategories)}
      </div>
    </div>

    <button onclick="analyzePortfolioWithFinBot()"
      style="width:100%;padding:13px 16px;border-radius:16px;background:#eef1fb;color:#6b5bd2;font-size:13px;font-weight:700;border:1px solid #ddd7f7;cursor:pointer;margin-bottom:18px">
      Analyze portfolio with FinBot →
    </button>

    <div class="port-perf-card" id="port-perf-wrap">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Performance</div>
          <div class="dashboard-panel-subtitle">Your portfolio value over time with the same simplified dashboard treatment.</div>
        </div>
        <div class="perf-tabs">
          <button class="perf-tab" data-range="1m">1M</button>
          <button class="perf-tab" data-range="3m">3M</button>
          <button class="perf-tab" data-range="6m">6M</button>
          <button class="perf-tab active" data-range="1y">1Y</button>
        </div>
      </div>
      <div class="perf-chart-area" style="height:170px"></div>
    </div>

    <div class="alloc-card">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Portfolio metrics</div>
          <div class="dashboard-panel-subtitle">Quick indicators for balance, winners, and risk concentration.</div>
        </div>
        <div style="font-size:12px;color:${up?'var(--green)':'var(--red)'};font-weight:700">${up?'▲':'▼'} ${fmtMoney(Math.abs(totalPnl))}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Best performer</p>
          <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${best?.ticker || '—'}</p>
          <p style="font-size:12px;font-weight:700;color:var(--green)">${best ? '+' + best.pnlP.toFixed(1) + '%' : '—'}</p>
        </div>
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Worst performer</p>
          <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${worst?.ticker || '—'}</p>
          <p style="font-size:12px;font-weight:700;color:${worst && worst.pnlP < 0 ? 'var(--red)' : 'var(--green)'}">${worst ? (worst.pnlP >= 0 ? '+' : '') + worst.pnlP.toFixed(1) + '%' : '—'}</p>
        </div>
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Gainers / Losers</p>
          <p style="font-size:14px;font-weight:800"><span style="color:var(--green)">${gainers}↑</span> <span style="color:var(--faint);font-weight:400">/</span> <span style="color:var(--red)">${losers}↓</span></p>
        </div>
        <div style="background:#f4eee1;border-radius:14px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Diversification</p>
          <p style="font-weight:800;font-size:14px;color:var(--text)">${divScore}/100</p>
          <div style="height:6px;background:#fff;border-radius:999px;overflow:hidden;margin-top:8px">
            <div style="height:100%;width:${divScore}%;background:${divScore >= 60 ? 'var(--green)' : divScore >= 30 ? 'var(--amber)' : 'var(--red)'}"></div>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        <div style="flex:1">
          ${holdings.map((h, i) => {
            const pct = total > 0 ? ((h.val / total) * 100).toFixed(1) : '0.0';
            return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:7px">
                <span class="alloc-dot" style="background:${COLORS[i % COLORS.length]}"></span>
                <div>
                  <p style="font-size:12px;font-weight:700;color:var(--text);line-height:1.3">${h.ticker}</p>
                  <p style="font-size:10px;color:var(--faint);line-height:1.2">${escHtml(h.name)}</p>
                </div>
              </div>
              <div style="text-align:right">
                <p style="font-size:12px;font-weight:700;color:var(--text)">${fmtMoney(h.val)}</p>
                <p style="font-size:11px;color:var(--muted)">${pct}%</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    ${sectorList.length > 1 ? `
      <div class="pnl-bars-card">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Sector breakdown</div>
            <div class="dashboard-panel-subtitle">How your holdings are distributed across sectors.</div>
          </div>
        </div>
        ${sectorList.map(s => {
          const barW = (s.pct / maxSectorPct * 100).toFixed(1);
          const col  = SECTOR_COLORS[s.name] || '#94a3b8';
          return `<div class="pnl-bar-row">
            <div class="pnl-bar-label" style="width:72px;font-size:10px">${s.name}</div>
            <div class="pnl-bar-track">
              <div class="pnl-bar-fill" data-w="${barW}" style="background:${col}"></div>
            </div>
            <div class="pnl-bar-val" style="color:var(--muted)">${s.pct.toFixed(1)}%</div>
          </div>`;
        }).join('')}
      </div>` : ''}

    <div class="pnl-bars-card">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">P&amp;L by holding</div>
          <div class="dashboard-panel-subtitle">A quick read on which positions are driving the portfolio.</div>
        </div>
      </div>
      ${holdings.map(h => {
        const barW = (Math.abs(h.pnlP) / maxPnlPct * 100).toFixed(1);
        const isUp = h.pnl >= 0;
        return `<div class="pnl-bar-row">
          <div class="pnl-bar-label">${h.ticker}</div>
          <div class="pnl-bar-track">
            <div class="pnl-bar-fill" data-w="${barW}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
          </div>
          <div class="pnl-bar-val ${isUp?'up':'dn'}">${isUp?'+':''}${h.pnlP.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>

    <div class="dashboard-panel-header">
      <div>
        <div class="dashboard-panel-title">Holdings</div>
        <div class="dashboard-panel-subtitle">Filtered list of your real positions.</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${filterBtn('all', 'All')}
        ${filterBtn('gainers', '↑ Up')}
        ${filterBtn('losers', '↓ Down')}
        <select onchange="portSort=this.value;renderDBPortfolio()"
          style="padding:8px 10px;border-radius:12px;background:#f4eee1;color:var(--text);font-size:11px;font-weight:700;border:1px solid var(--border);cursor:pointer;outline:none">
          <option value="value" ${portSort==='value'?'selected':''}>By Value</option>
          <option value="pnl_pct" ${portSort==='pnl_pct'?'selected':''}>By P&L %</option>
          <option value="ticker" ${portSort==='ticker'?'selected':''}>A → Z</option>
        </select>
      </div>
    </div>

    ${filtered.length === 0 ? `<div class="dashboard-panel" style="text-align:center;padding:30px;color:var(--faint);font-size:13px">No holdings match this filter</div>` : ''}

    ${filtered.map(h => `
      <div class="holding-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${h.ticker}</p>
              ${SECTOR_MAP[h.ticker] ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${SECTOR_COLORS[SECTOR_MAP[h.ticker]] || '#94a3b8'}18;color:${SECTOR_COLORS[SECTOR_MAP[h.ticker]] || '#94a3b8'}">${SECTOR_MAP[h.ticker]}</span>` : ''}
            </div>
            <p style="font-size:11px;color:var(--faint);margin-top:2px">${escHtml(h.name)}</p>
          </div>
          <div style="text-align:right">
            <p style="font-weight:700;font-size:15px;color:var(--text);font-family:var(--mono)">${fmtMoney(h.val)}</p>
            <p style="font-size:12px;font-weight:700;margin-top:2px;color:${h.pnl>=0?'var(--green)':'var(--red)'}">${h.pnl>=0?'+':''}${h.pnlP.toFixed(2)}%</p>
          </div>
        </div>
        <div class="holding-stats">
          ${[
            {l:'Units',   v:h.shares},
            {l:'Avg Cost',v:fmtUnitPrice(h.avg_cost)},
            {l:'Current', v:fmtUnitPrice(h.cur)},
            {l:'P&L', v:(h.pnl>=0?'+':'')+fmtMoney(Math.abs(h.pnl))},
            {l:'Value',   v:fmtMoney(h.val)},
            {l:'Alloc',   v:total>0?((h.val/total*100).toFixed(1)+'%'):'—'},
          ].map(s => `<div class="holding-stat"><p class="hl">${s.l}</p><p class="hv" style="color:var(--text)">${s.v}</p></div>`).join('')}
        </div>
        <div class="holding-actions">
          <button onclick="openAddHoldingModal('${h.ticker}','${escHtml(h.name).replace(/'/g,"\\'")}')" class="holding-action-secondary">Edit</button>
          <button onclick="removeHolding('${h.ticker}')" class="holding-action-danger">Remove</button>
        </div>
      </div>
    `).join('')}
    <div style="height:8px"></div>
  `;

  requestAnimationFrame(() => {
    if (portPerfChart) { try { portPerfChart.remove(); } catch(e){} portPerfChart = null; }
    initPerfChart(perfData, up ? '#10b981' : '#ef4444');
    const donut = document.getElementById('port-donut');
    if (donut) makeDonut(donut, holdings.map((h, i) => ({ label: h.ticker, pct: total > 0 ? (h.val / total * 100) : 0, color: COLORS[i % COLORS.length] })));
    animatePnlBars();
  });
  return;

  document.getElementById('tab-portfolio').innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <div><h2>Portfolio</h2><p>Your real holdings</p></div>
      <button onclick="openAddHoldingModal()" style="padding:9px 16px;border-radius:12px;
        background:var(--green);color:#fff;font-weight:800;font-size:12px;flex-shrink:0">+ Add</button>
    </div>

    ${portCurrencyBar()}

    <div class="port-hero">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <p style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Total Value</p>
          <p style="font-size:28px;font-weight:800;color:#fff;margin-top:4px;font-family:var(--mono)">${fmtMoney(total)}</p>
          <p style="margin-top:6px;font-size:13px;font-weight:700;color:${up?'#10b981':'#ef4444'}">
            ${up?'▲':'▼'} ${fmtMoney(Math.abs(totalPnl))} (${up?'+':''}${totalPnlP}%)
          </p>
        </div>
        <div style="text-align:right">
          <p style="font-size:10px;color:#64748b">Holdings</p>
          <p style="font-size:22px;font-weight:800;color:#fff">${holdings.length}</p>
        </div>
      </div>
    </div>

    <button onclick="analyzePortfolioWithFinBot()"
      style="width:100%;padding:13px;border-radius:14px;background:linear-gradient(135deg,#7c3aed18,#6d28d918);
             color:#a78bfa;font-size:13px;font-weight:700;border:1.5px solid #7c3aed30;cursor:pointer;
             margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s"
      onmouseenter="this.style.background='linear-gradient(135deg,#7c3aed28,#6d28d928)'"
      onmouseleave="this.style.background='linear-gradient(135deg,#7c3aed18,#6d28d918)'">
      🤖 Analyze Portfolio with FinBot →
    </button>

    <div class="port-perf-card" id="port-perf-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p style="font-weight:800;font-size:13px;color:var(--text)">Performance</p>
        <div class="perf-tabs">
          <button class="perf-tab" data-range="1m">1M</button>
          <button class="perf-tab" data-range="3m">3M</button>
          <button class="perf-tab" data-range="6m">6M</button>
          <button class="perf-tab active" data-range="1y">1Y</button>
        </div>
      </div>
      <div class="perf-chart-area" style="height:170px"></div>
    </div>

    <!-- Metrics card -->
    <div class="alloc-card">
      <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:14px">Portfolio Metrics</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:var(--border);border-radius:12px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Best Performer</p>
          <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${best?.ticker || '—'}</p>
          <p style="font-size:12px;font-weight:700;color:var(--green)">${best ? '+' + best.pnlP.toFixed(1) + '%' : '—'}</p>
        </div>
        <div style="background:var(--border);border-radius:12px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Worst Performer</p>
          <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${worst?.ticker || '—'}</p>
          <p style="font-size:12px;font-weight:700;color:${worst && worst.pnlP < 0 ? 'var(--red)' : 'var(--green)'}">
            ${worst ? (worst.pnlP >= 0 ? '+' : '') + worst.pnlP.toFixed(1) + '%' : '—'}
          </p>
        </div>
        <div style="background:var(--border);border-radius:12px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Gainers / Losers</p>
          <p style="font-size:14px;font-weight:800">
            <span style="color:var(--green)">${gainers}↑</span>
            <span style="color:var(--faint);font-weight:400"> / </span>
            <span style="color:var(--red)">${losers}↓</span>
          </p>
        </div>
        <div style="background:var(--border);border-radius:12px;padding:12px">
          <p style="font-size:10px;color:var(--faint);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Cost Basis</p>
          <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${fmtMoney(totalCost)}</p>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <p style="font-size:12px;font-weight:700;color:var(--text)">Diversification</p>
          <p style="font-size:12px;font-weight:800;color:${divScore >= 60 ? 'var(--green)' : divScore >= 30 ? '#f59e0b' : 'var(--red)'}">
            ${divScore}/100
          </p>
        </div>
        <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${divScore}%;border-radius:4px;
            background:${divScore >= 60 ? 'var(--green)' : divScore >= 30 ? '#f59e0b' : 'var(--red)'};
            transition:width .8s cubic-bezier(.25,.46,.45,.94)"></div>
        </div>
        <p style="font-size:10px;color:var(--faint);margin-top:5px">
          ${sectors.size} sector${sectors.size !== 1 ? 's' : ''} · ${holdings.length} holding${holdings.length !== 1 ? 's' : ''}
          ${divScore >= 60 ? ' · Well diversified' : divScore >= 30 ? ' · Moderately diversified' : ' · Consider adding more variety'}
        </p>
      </div>
    </div>

    <!-- Allocation donut + mini charts -->
    <div class="alloc-card">
      <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:14px">Allocation</p>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        <div style="flex:1">
          ${holdings.map((h, i) => {
            const pct = total > 0 ? ((h.val / total) * 100).toFixed(1) : '0.0';
            return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:7px">
                <span class="alloc-dot" style="background:${COLORS[i % COLORS.length]}"></span>
                <div>
                  <p style="font-size:12px;font-weight:700;color:var(--text);line-height:1.3">${h.ticker}</p>
                  <p style="font-size:10px;color:var(--faint);line-height:1.2">${escHtml(h.name)}</p>
                </div>
              </div>
              <div style="text-align:right">
                <p style="font-size:12px;font-weight:700;color:var(--text)">${fmtMoney(h.val)}</p>
                <p style="font-size:11px;color:var(--muted)">${pct}%</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--border);border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Value</p>
          ${(() => {
            const maxV = Math.max(...holdings.map(h => h.val));
            return holdings.map((h, i) => {
              const bw = (h.val / maxV * 100).toFixed(1);
              return `<div style="margin-bottom:6px">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                  <span style="font-size:10px;color:var(--faint)">${fmtMoney(h.val)}</span>
                </div>
                <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                  <div class="pnl-bar-fill" data-w="${bw}" style="background:${COLORS[i % COLORS.length]};opacity:.9"></div>
                </div>
              </div>`;
            }).join('');
          })()}
        </div>
        <div style="background:var(--border);border-radius:14px;padding:12px">
          <p style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Return</p>
          ${holdings.map(h => {
            const bw = (Math.abs(h.pnlP) / maxPnlPct * 100).toFixed(1);
            const isUp = h.pnl >= 0;
            return `<div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="font-size:10px;font-weight:700;color:var(--muted);font-family:var(--mono)">${h.ticker}</span>
                <span style="font-size:10px;font-weight:700;color:${isUp?'var(--green)':'var(--red)'}">${isUp?'+':''}${h.pnlP.toFixed(1)}%</span>
              </div>
              <div style="height:5px;background:var(--card);border-radius:3px;overflow:hidden">
                <div class="pnl-bar-fill" data-w="${bw}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Sector breakdown -->
    ${sectorList.length > 1 ? `
    <div class="pnl-bars-card">
      <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:14px">Sector Breakdown</p>
      ${sectorList.map(s => {
        const barW = (s.pct / maxSectorPct * 100).toFixed(1);
        const col  = SECTOR_COLORS[s.name] || '#94a3b8';
        return `<div class="pnl-bar-row">
          <div class="pnl-bar-label" style="width:72px;font-size:10px">${s.name}</div>
          <div class="pnl-bar-track">
            <div class="pnl-bar-fill" data-w="${barW}" style="background:${col}"></div>
          </div>
          <div class="pnl-bar-val" style="color:var(--muted)">${s.pct.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <!-- P&L bars -->
    <div class="pnl-bars-card">
      <p style="font-weight:800;font-size:13px;color:var(--text);margin-bottom:12px">P&amp;L by Holding</p>
      ${holdings.map(h => {
        const barW = (Math.abs(h.pnlP) / maxPnlPct * 100).toFixed(1);
        const isUp = h.pnl >= 0;
        return `<div class="pnl-bar-row">
          <div class="pnl-bar-label">${h.ticker}</div>
          <div class="pnl-bar-track">
            <div class="pnl-bar-fill" data-w="${barW}" style="background:${isUp?'var(--green)':'var(--red)'}"></div>
          </div>
          <div class="pnl-bar-val ${isUp?'up':'dn'}">${isUp?'+':''}${h.pnlP.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>

    <!-- Holdings header with sort + filter -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase">
        Holdings${filtered.length !== holdings.length ? ' (' + filtered.length + ' of ' + holdings.length + ')' : ''}
      </p>
      <div style="display:flex;align-items:center;gap:6px">
        ${filterBtn('all', 'All')}
        ${filterBtn('gainers', '↑ Up')}
        ${filterBtn('losers', '↓ Down')}
        <select onchange="portSort=this.value;renderDBPortfolio()"
          style="padding:5px 8px;border-radius:10px;background:var(--border);color:var(--text);
                 font-size:11px;font-weight:700;border:none;cursor:pointer;outline:none">
          <option value="value" ${portSort==='value'?'selected':''}>By Value</option>
          <option value="pnl_pct" ${portSort==='pnl_pct'?'selected':''}>By P&L %</option>
          <option value="ticker" ${portSort==='ticker'?'selected':''}>A → Z</option>
        </select>
      </div>
    </div>

    ${filtered.length === 0 ? `<div style="text-align:center;padding:30px;color:var(--faint);font-size:13px">No holdings match this filter</div>` : ''}

    ${filtered.map(h => `
      <div class="holding-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <p style="font-weight:800;font-size:14px;color:var(--text);font-family:var(--mono)">${h.ticker}</p>
              ${SECTOR_MAP[h.ticker] ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
                background:${SECTOR_COLORS[SECTOR_MAP[h.ticker]] || '#94a3b8'}18;
                color:${SECTOR_COLORS[SECTOR_MAP[h.ticker]] || '#94a3b8'}">${SECTOR_MAP[h.ticker]}</span>` : ''}
            </div>
            <p style="font-size:11px;color:var(--faint);margin-top:1px">${escHtml(h.name)}</p>
          </div>
          <div style="text-align:right">
            <p style="font-weight:700;font-size:15px;color:var(--text);font-family:var(--mono)">${fmtMoney(h.val)}</p>
            <p style="font-size:12px;font-weight:700;margin-top:2px;color:${h.pnl>=0?'var(--green)':'var(--red)'}">
              ${h.pnl>=0?'+':''}${h.pnlP.toFixed(2)}%
            </p>
          </div>
        </div>
        <div class="holding-stats">
          ${[
            {l:'Units',   v:h.shares},
            {l:'Avg Cost',v:fmtUnitPrice(h.avg_cost)},
            {l:'Current', v:fmtUnitPrice(h.cur)},
            {l:'P&amp;L', v:(h.pnl>=0?'+':'')+fmtMoney(Math.abs(h.pnl))},
            {l:'Value',   v:fmtMoney(h.val)},
            {l:'Alloc',   v:total>0?((h.val/total*100).toFixed(1)+'%'):'—'},
          ].map(s => `<div class="holding-stat"><p class="hl">${s.l}</p><p class="hv" style="color:var(--text)">${s.v}</p></div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="openAddHoldingModal('${h.ticker}','${escHtml(h.name).replace(/'/g,"\\'")}')"
            style="flex:1;padding:8px;border-radius:10px;background:var(--border);font-size:12px;font-weight:700;color:var(--muted)">Edit</button>
          <button onclick="removeHolding('${h.ticker}')"
            style="padding:8px 14px;border-radius:10px;background:#fef2f2;font-size:12px;font-weight:700;color:var(--red)">Remove</button>
        </div>
      </div>
    `).join('')}
    <div style="height:8px"></div>
  `;

  requestAnimationFrame(() => {
    if (portPerfChart) { try { portPerfChart.remove(); } catch(e){} portPerfChart = null; }
    initPerfChart(perfData, up ? '#10b981' : '#ef4444');
    const donut = document.getElementById('port-donut');
    if (donut) {
      makeDonut(donut, holdings.map((h, i) => ({
        label: h.ticker,
        pct: total > 0 ? (h.val / total) * 100 : 0,
        color: COLORS[i % COLORS.length],
      })));
    }
    animatePnlBars();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

const SETTINGS_DEFAULTS = {
  name: '', email: '', username: '',
  notifications: true, priceAlerts: true, newsletter: false,
  currency: 'USD', hideBalances: false,
  defaultRisk: 'Moderate', defaultHorizon: '1–5 years', defaultSectors: 'Tech, Finance',
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('ie_settings') || '{}');
    return Object.assign({}, SETTINGS_DEFAULTS, saved);
  } catch(e) { return Object.assign({}, SETTINGS_DEFAULTS); }
}

function saveSettings(updates) {
  const current = loadSettings();
  const next = Object.assign(current, updates);
  localStorage.setItem('ie_settings', JSON.stringify(next));
  saveSettingsToDB(updates);
  renderSettings();
  // Re-render all price-displaying views when display-affecting settings change
  if ('currency' in updates || 'hideBalances' in updates) {
    const portTab = document.getElementById('tab-portfolio');
    if (portTab && portTab.classList.contains('active')) renderPortfolio();
    const mktTab = document.getElementById('tab-markets');
    if (mktTab && mktTab.classList.contains('active')) renderMarkets();
    if (currentDetailIdx !== null) openStockDetail(currentDetailIdx);
  }
}

function getInitials(name) {
  return name.split(' ').filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');
}

function getAvatarColor(name) {
  const colors = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ec4899','#06b6d4','#ef4444'];
  let h = 0; for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function openEditModal() {
  // Always prefer live currentUser data over stale localStorage values
  document.getElementById('modal-name').value     = currentUser ? (currentUser.name     || '') : '';
  document.getElementById('modal-email').value    = currentUser ? (currentUser.email    || '') : '';
  document.getElementById('modal-username').value = currentUser ? (currentUser.username || '') : '';
  const errEl = document.getElementById('edit-profile-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  document.getElementById('edit-profile-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-profile-modal').classList.add('hidden');
}

function manageSignInEmail() {
  openEditModal();
  const emailInput = document.getElementById('modal-email');
  if (emailInput) {
    setTimeout(() => emailInput.focus(), 30);
  }
}

async function saveProfile() {
  const name     = document.getElementById('modal-name').value.trim();
  const email    = document.getElementById('modal-email').value.trim();
  const username = document.getElementById('modal-username').value.trim().replace(/^@/, '');
  const errEl    = document.getElementById('edit-profile-error');
  const saveBtn  = document.getElementById('edit-profile-save-btn');

  const showErr = msg => { errEl.textContent = msg; errEl.classList.add('show'); };
  errEl.classList.remove('show');

  if (!name)  { showErr('Name is required.'); document.getElementById('modal-name').focus(); return; }
  if (!email) { showErr('Email is required.'); return; }
  if (!username) { showErr('Username is required.'); return; }

  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  if (currentUser) {
    const result = await saveProfileToDB(name, email, username);
    if (result !== true) {
      showErr(result);
      saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      return;
    }
  }
  saveSettings({ name, email, username });
  saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
  closeEditModal();
  renderSettings();
  updateHeaderUser();
}

// Close modal on backdrop click
document.getElementById('edit-profile-modal').addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});

function renderSettings() {
  const s = loadSettings();
  const tierInfo = getTierPresentation(currentUser?.tier || 'free');
  // Use live DB user data for name/email when logged in
  const displayName  = currentUser ? currentUser.name     : s.name;
  const displayEmail = currentUser ? currentUser.email    : s.email;
  const displayUser  = currentUser ? '@' + currentUser.username : s.username;
  const initials  = getInitials(displayName);
  const avatarCol = getAvatarColor(displayName);

  document.getElementById('tab-settings').innerHTML = `
    <div class="section-title"><h2>Settings</h2><p>Manage your profile & preferences</p></div>

    <!-- Profile Card -->
    <div class="profile-card">
      <div class="avatar" style="background:linear-gradient(135deg,${avatarCol},${avatarCol}cc)">${initials}</div>
      <div class="profile-info">
        <p class="profile-name">${escHtml(displayName)}</p>
        <p class="profile-email">${escHtml(displayEmail)}</p>
        <div class="profile-badge"><span class="live-dot" style="width:6px;height:6px"></span>
          <span>${currentUser ? escHtml(displayUser) : 'Demo Mode'}</span></div>
      </div>
      <button class="edit-profile-btn" onclick="openEditModal()">Edit</button>
    </div>

    <!-- Notifications -->
    <div class="settings-section">
      <p class="settings-section-label">Notifications</p>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#3b82f614">🔔</div>
            <div><p class="settings-row-title">Push Notifications</p><p class="settings-row-sub">Market updates & news alerts</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.notifications?'checked':''} onchange="saveSettings({notifications:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#10b98114">📈</div>
            <div><p class="settings-row-title">Price Alerts</p><p class="settings-row-sub">Notify when watchlist moves ±5%</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.priceAlerts?'checked':''} onchange="saveSettings({priceAlerts:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#8b5cf614">📩</div>
            <div><p class="settings-row-title">Weekly Newsletter</p><p class="settings-row-sub">Top picks & market recap</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.newsletter?'checked':''} onchange="saveSettings({newsletter:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
      </div>
    </div>

    <!-- Display -->
    <div class="settings-section">
      <p class="settings-section-label">Display</p>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#f59e0b14">💱</div>
            <div><p class="settings-row-title">Currency</p><p class="settings-row-sub">Base display currency</p></div>
          </div>
          <select class="settings-select" onchange="saveSettings({currency:this.value})">
            ${['USD','GBP','EUR','JPY','CAD','AUD','ZAR'].map(c =>
              `<option value="${c}" ${s.currency===c?'selected':''}>${c}${c==='ZAR'?' (Rand)':''}</option>`
            ).join('')}
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#ef444414">🙈</div>
            <div><p class="settings-row-title">Hide Balances</p><p class="settings-row-sub">Mask portfolio values</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.hideBalances?'checked':''} onchange="saveSettings({hideBalances:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
      </div>
    </div>

    <!-- FinBot Defaults -->
    <div class="settings-section">
      <p class="settings-section-label">FinBot Defaults</p>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#10b98114">⚖️</div>
            <div><p class="settings-row-title">Default Risk</p><p class="settings-row-sub">Pre-fill risk tolerance</p></div>
          </div>
          <select class="settings-select" onchange="saveSettings({defaultRisk:this.value})">
            ${['Conservative','Moderate','Aggressive'].map(r =>
              `<option value="${r}" ${s.defaultRisk===r?'selected':''}>${r}</option>`
            ).join('')}
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#3b82f614">🕐</div>
            <div><p class="settings-row-title">Time Horizon</p><p class="settings-row-sub">Default investment horizon</p></div>
          </div>
          <select class="settings-select" onchange="saveSettings({defaultHorizon:this.value})">
            ${['< 1 year','1–5 years','5–10 years','10+ years'].map(h =>
              `<option value="${h}" ${s.defaultHorizon===h?'selected':''}>${h}</option>`
            ).join('')}
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#8b5cf614">🏢</div>
            <div>
              <p class="settings-row-title">Preferred Sectors</p>
              <p class="settings-row-sub">${s.defaultSectors || 'Not set'}</p>
            </div>
          </div>
          <button class="settings-select" onclick="promptSectors()" style="cursor:pointer">Edit</button>
        </div>
      </div>
    </div>

    <!-- Plan & Credits -->
    ${currentUser ? `
    <div class="settings-section">
      <p class="settings-section-label">Plan &amp; Credits</p>
      <div class="settings-group" style="overflow:hidden">
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:${tierInfo.iconBg}">${tierInfo.icon}</div>
            <div>
              <p class="settings-row-title">Current Plan</p>
              <p class="settings-row-sub">${tierInfo.sub}</p>
            </div>
          </div>
          <span style="font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:0.05em;background:${tierInfo.chipBg};color:${tierInfo.chipColor}">${tierInfo.label}</span>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#10b98114">⚡</div>
            <div>
              <p class="settings-row-title">Credits Remaining</p>
              <p class="settings-row-sub">Resets monthly · 5 per analysis, 2 per news AI</p>
            </div>
          </div>
          <span style="font-size:13px;font-weight:800;color:#10b981">${currentUser.finbot_credits??0}</span>
        </div>
      </div>
    </div>
    ` : ''}


    <!-- Account -->
    <div class="settings-section">
      <p class="settings-section-label">Account</p>
      <div class="settings-group" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        ${currentUser ? `
          <button class="modal-save-btn" style="background:#3b82f6" onclick="manageSignInEmail()">Manage Sign-In Email</button>
          <button class="modal-save-btn" style="background:#1e293b" onclick="doLogout()">Sign Out</button>
        ` : `<button class="modal-save-btn" onclick="document.getElementById('auth-overlay').classList.remove('hidden')">Sign In / Create Account</button>`}
        <button class="danger-btn" onclick="resetAllSettings()">Reset All Settings</button>
      </div>
    </div>

    <div style="height:8px"></div>
  `;
}

function openChangePasswordModal() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  const errEl = document.getElementById('change-password-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  document.getElementById('change-password-modal').classList.remove('hidden');
}

function closeChangePasswordModal() {
  document.getElementById('change-password-modal').classList.add('hidden');
}

async function doChangePassword() {
  const current = document.getElementById('cp-current').value;
  const newPass = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  const errEl   = document.getElementById('change-password-error');
  const saveBtn = document.getElementById('change-password-save-btn');

  const showErr = msg => { errEl.textContent = msg; errEl.classList.add('show'); errEl.style.color = ''; };
  errEl.classList.remove('show');

  if (!current || !newPass || !confirm) { showErr('All fields are required.'); return; }
  if (newPass.length < 6) { showErr('New password must be at least 6 characters.'); return; }
  if (newPass !== confirm) { showErr('New passwords do not match.'); return; }

  saveBtn.disabled = true; saveBtn.textContent = 'Updating…';
  try {
    const d = await apiCall('auth.php?action=change-password', 'POST', {
      current_password: current, new_password: newPass, confirm_password: confirm
    });
    if (d.success) {
      errEl.textContent = 'Password updated successfully!';
      errEl.style.color = '#10b981';
      errEl.classList.add('show');
      setTimeout(() => closeChangePasswordModal(), 1500);
    } else {
      showErr(d.error || 'Failed to update password.');
    }
  } catch(e) {
    showErr('Connection error. Please try again.');
  }
  saveBtn.disabled = false; saveBtn.textContent = 'Update Password';
}

function promptSectors() {
  const s = loadSettings();
  const val = prompt('Enter preferred sectors (e.g. Tech, Finance, Healthcare):', s.defaultSectors);
  if (val !== null) saveSettings({ defaultSectors: val.trim() });
}

function resetAllSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  localStorage.removeItem('ie_settings');
  renderSettings();
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH & DATABASE SYNC
// ═══════════════════════════════════════════════════════════════════════════

// ── Supabase-backed API compatibility layer ──────────────────────────────────
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
let supabaseClient = null;
let supabaseAuthListenerBound = false;
let pendingOtp = null;

function isSupabaseConfigured() {
  return !!(window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
}

function getSupabase() {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.');
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return supabaseClient;
}

function apiAction(url) {
  try {
    return new URL(url, window.location.href).searchParams.get('action') || '';
  } catch (e) {
    const q = (url.split('?')[1] || '');
    return new URLSearchParams(q).get('action') || '';
  }
}

function authMeta(user) {
  return user?.user_metadata || user?.raw_user_meta_data || {};
}

function fallbackUsername(email = '') {
  return (email.split('@')[0] || 'investor').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'investor';
}

function normalizeCurrentUser(authUser, profile = {}) {
  const meta = authMeta(authUser);
  const username = profile.username || meta.username || fallbackUsername(authUser?.email || '');
  const name = profile.name || meta.name || username || 'Investor';
  return {
    id: authUser.id,
    name,
    email: authUser.email || '',
    username,
    tier: profile.tier || 'free',
    finbot_credits: profile.finbot_credits ?? 0,
    credits_reset_at: profile.credits_reset_at ?? null,
    age: profile.age ?? meta.age ?? null,
    created_at: profile.created_at || authUser.created_at || null,
  };
}

function getTierPresentation(tier = 'free') {
  if (tier === 'enterprise') {
    return {
      label: 'Enterprise',
      sub: '200 credits/month · Full access',
      chipBg: '#d9770622',
      chipColor: '#fbbf24',
      iconBg: '#d9770614',
      icon: '🏆'
    };
  }
  if (tier === 'pro') {
    return {
      label: 'Pro',
      sub: '50 credits/month · Full access',
      chipBg: '#7c3aed22',
      chipColor: '#a78bfa',
      iconBg: '#7c3aed14',
      icon: '⚡'
    };
  }
  return {
    label: 'Free',
    sub: '0 credits/month · Core access',
    chipBg: '#64748b22',
    chipColor: '#64748b',
    iconBg: '#64748b14',
    icon: '○'
  };
}

async function ensureProfileRow(authUser, patch = {}) {
  if (!authUser) return null;
  const sb = getSupabase();
  const meta = authMeta(authUser);
  const payload = {
    id: authUser.id,
    name: patch.name || meta.name || authUser.email || 'Investor',
    username: patch.username || meta.username || fallbackUsername(authUser.email || ''),
  };
  if (patch.age !== undefined && patch.age !== null && patch.age !== '') payload.age = patch.age;
  const { error } = await sb.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
  const { data, error: profileError } = await sb.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
  if (profileError) throw profileError;
  return data || payload;
}

async function loadCurrentUserFromSupabase() {
  const sb = getSupabase();
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!session?.user) return null;
  let profile = null;
  try { profile = await ensureProfileRow(session.user); } catch (e) {}
  currentUser = normalizeCurrentUser(session.user, profile || {});
  return currentUser;
}

function settingsFromDb(row = {}) {
  return {
    notifications: !!row.notifications,
    priceAlerts: !!row.price_alerts,
    newsletter: !!row.newsletter,
    currency: row.currency ?? 'USD',
    hideBalances: !!row.hide_balances,
    compactView: !!row.compact_view,
    defaultRisk: row.default_risk ?? 'Moderate',
    defaultHorizon: row.default_horizon ?? '1–5 years',
    defaultSectors: row.default_sectors ?? 'Tech, Finance',
  };
}

function settingsToDb(updates = {}) {
  const mapped = {};
  if ('notifications' in updates) mapped.notifications = !!updates.notifications;
  if ('priceAlerts' in updates) mapped.price_alerts = !!updates.priceAlerts;
  if ('newsletter' in updates) mapped.newsletter = !!updates.newsletter;
  if ('currency' in updates) mapped.currency = updates.currency;
  if ('hideBalances' in updates) mapped.hide_balances = !!updates.hideBalances;
  if ('compactView' in updates) mapped.compact_view = !!updates.compactView;
  if ('defaultRisk' in updates) mapped.default_risk = updates.defaultRisk;
  if ('defaultHorizon' in updates) mapped.default_horizon = updates.defaultHorizon;
  if ('defaultSectors' in updates) mapped.default_sectors = updates.defaultSectors;
  return mapped;
}

async function handleAuthAction(action, method, body) {
  const sb = getSupabase();
  switch (action) {
    case 'me': {
      const user = await loadCurrentUserFromSupabase();
      return user ? { success: true, user } : { success: false, error: 'Not logged in' };
    }
    case 'login': {
      const { error } = await sb.auth.signInWithOtp({
        email: body.email,
        options: { shouldCreateUser: false }
      });
      if (error) return { success: false, error: error.message };
      return { success: true, otp_sent: true, message: 'We sent a 6-digit sign-in code to your email.' };
    }
    case 'register': {
      const cleanName = (body.name || '').trim();
      const cleanEmail = (body.email || '').trim().toLowerCase();
      const cleanUser = (body.username || '').trim().replace(/^@+/, '').toLowerCase();
      const age = body.age ?? null;
      const { error } = await sb.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          data: { name: cleanName, username: cleanUser, age }
        }
      });
      if (error) return { success: false, error: error.message };
      return { success: true, otp_sent: true, message: 'We sent a 6-digit sign-up code to your email.' };
    }
    case 'verify-otp': {
      const cleanEmail = (body.email || '').trim().toLowerCase();
      const token = String(body.token || '').trim();
      const { data, error } = await sb.auth.verifyOtp({
        email: cleanEmail,
        token,
        type: 'email'
      });
      if (error) return { success: false, error: error.message };
      if (!data.user) {
        return { success: false, error: 'Verification succeeded, but no user was returned.' };
      }
      let profile = null;
      try {
        profile = await ensureProfileRow(data.user, {
          name: body.name,
          username: body.username,
          age: body.age
        });
      } catch (e) {}
      currentUser = normalizeCurrentUser(data.user, profile || {});
      return { success: true, user: currentUser };
    }
    case 'forgot-password': {
      const redirectTo = new URL('reset-password.html', window.location.href).href;
      const { error } = await sb.auth.resetPasswordForEmail(body.email, { redirectTo });
      return error ? { success: false, error: error.message } : { success: true };
    }
    case 'logout': {
      const { error } = await sb.auth.signOut();
      if (error) return { success: false, error: error.message };
      return { success: true };
    }
    case 'update-profile': {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return { success: false, error: 'Not logged in' };
      const cleanName = (body.name || '').trim();
      const cleanEmail = (body.email || '').trim().toLowerCase();
      const cleanUsername = (body.username || '').trim().replace(/^@+/, '').toLowerCase();
      const authUpdates = { data: { ...authMeta(user), name: cleanName, username: cleanUsername } };
      if (cleanEmail && cleanEmail !== user.email) authUpdates.email = cleanEmail;
      const { error: authError } = await sb.auth.updateUser(authUpdates);
      if (authError) return { success: false, error: authError.message };
      try {
        await ensureProfileRow(user, {
          name: cleanName,
          username: cleanUsername,
          age: currentUser?.age ?? null,
        });
      } catch (profileError) {
        return { success: false, error: profileError.message || 'Failed to update profile.' };
      }
      const mapped = await loadCurrentUserFromSupabase();
      return { success: true, user: mapped };
    }
    case 'change-password': {
      return { success: false, error: 'Password changes are disabled while email code sign-in is enabled.' };
    }
    default:
      return { success: false, error: `Unsupported auth action: ${action}` };
  }
}

async function handleDataAction(action, method, body) {
  const sb = getSupabase();
  const uid = currentUser?.id;
  if (!uid) return { success: false, error: 'Not logged in' };

  switch (action) {
    case 'settings': {
      if (method === 'GET') {
        const { data, error } = await sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle();
        if (error) return { success: false, error: error.message };
        return { success: true, settings: settingsFromDb(data || {}) };
      }
      const payload = { user_id: uid, ...settingsToDb(body) };
      const { error } = await sb.from('user_settings').upsert(payload, { onConflict: 'user_id' });
      return error ? { success: false, error: error.message } : { success: true };
    }
    case 'portfolio': {
      if (method === 'GET') {
        const { data, error } = await sb.from('portfolio').select('ticker,name,shares,avg_cost').order('ticker');
        if (error) return { success: false, error: error.message };
        return { success: true, portfolio: (data || []).map(r => ({ ...r, shares: Number(r.shares), avg_cost: Number(r.avg_cost) })) };
      }
      if (method === 'POST') {
        const payload = { user_id: uid, ticker: body.ticker, name: body.name, shares: body.shares, avg_cost: body.avg_cost };
        const { error } = await sb.from('portfolio').upsert(payload, { onConflict: 'user_id,ticker' });
        return error ? { success: false, error: error.message } : { success: true };
      }
      if (method === 'DELETE') {
        const { error } = await sb.from('portfolio').delete().eq('user_id', uid).eq('ticker', body.ticker || '');
        return error ? { success: false, error: error.message } : { success: true };
      }
      break;
    }
    case 'watchlist': {
      if (method === 'GET') {
        const { data, error } = await sb.from('watchlist').select('ticker,name').order('added_at', { ascending: false });
        return error ? { success: false, error: error.message } : { success: true, watchlist: data || [] };
      }
      if (method === 'POST') {
        const { error } = await sb.from('watchlist').upsert({ user_id: uid, ticker: body.ticker, name: body.name }, { onConflict: 'user_id,ticker' });
        return error ? { success: false, error: error.message } : { success: true };
      }
      if (method === 'DELETE') {
        const { error } = await sb.from('watchlist').delete().eq('user_id', uid).eq('ticker', body.ticker || '');
        return error ? { success: false, error: error.message } : { success: true };
      }
      break;
    }
    case 'saved_reports': {
      if (method === 'GET') {
        const { data, error } = await sb.from('saved_reports').select('*').order('saved_at', { ascending: false });
        if (error) return { success: false, error: error.message };
        const reports = (data || []).map(r => ({
          id: r.id,
          modeId: r.mode_id,
          modeTitle: r.mode_title,
          modeSub: r.mode_sub,
          modeCol: r.mode_col,
          modeIcon: r.mode_icon,
          content: r.content,
          articleLink: r.article_link,
          savedAt: Number(r.saved_at),
          tags: Array.isArray(r.tags) ? r.tags : (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })(),
          folder: r.folder || '',
          starred: !!r.starred,
          note: r.note || '',
        }));
        return { success: true, reports };
      }
      if (method === 'DELETE') {
        const { error } = await sb.from('saved_reports').delete().eq('id', body.id || '');
        return error ? { success: false, error: error.message } : { success: true };
      }
      if (method === 'POST' || method === 'PUT') {
        if (body.modeId) {
          const payload = {
            id: body.id,
            user_id: uid,
            mode_id: body.modeId,
            mode_title: body.modeTitle || '',
            mode_sub: body.modeSub || '',
            mode_col: body.modeCol || '#10b981',
            mode_icon: body.modeIcon || '🤖',
            content: body.content || '',
            article_link: body.articleLink || '',
            saved_at: body.savedAt || Date.now(),
            starred: !!body.starred,
            tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
            folder: body.folder || '',
            note: body.note || '',
          };
          const { error } = await sb.from('saved_reports').upsert(payload, { onConflict: 'id' });
          return error ? { success: false, error: error.message } : { success: true };
        }
        const patch = {};
        if ('modeTitle' in body) patch.mode_title = body.modeTitle;
        if ('tags' in body) patch.tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);
        if ('folder' in body) patch.folder = body.folder || '';
        if ('starred' in body) patch.starred = !!body.starred;
        if ('note' in body) patch.note = body.note || '';
        const { error } = await sb.from('saved_reports').update(patch).eq('id', body.id || '');
        return error ? { success: false, error: error.message } : { success: true };
      }
      break;
    }
    case 'learn_progress': {
      if (method === 'GET') {
        const { data, error } = await sb.from('user_progress').select('state').eq('user_id', uid).maybeSingle();
        if (error) return { success: false, error: error.message };
        let state = {};
        try { state = data?.state ? JSON.parse(data.state) : {}; } catch (e) {}
        return { success: true, state };
      }
      const { error } = await sb.from('user_progress').upsert({ user_id: uid, state: JSON.stringify(body.state || {}) }, { onConflict: 'user_id' });
      return error ? { success: false, error: error.message } : { success: true };
    }
    case 'price_alerts': {
      if (method === 'GET') {
        const { data, error } = await sb.from('price_alerts').select('*').order('created_at', { ascending: false });
        return error ? { success: false, error: error.message } : { success: true, alerts: data || [] };
      }
      if (method === 'POST') {
        const payload = { user_id: uid, ticker: body.ticker, name: body.name, target: body.target, direction: body.direction, triggered: false };
        const { data, error } = await sb.from('price_alerts').insert(payload).select('id').single();
        return error ? { success: false, error: error.message } : { success: true, id: data.id };
      }
      if (method === 'PUT') {
        const { error } = await sb.from('price_alerts').update({ triggered: true }).eq('id', body.id).eq('user_id', uid);
        return error ? { success: false, error: error.message } : { success: true };
      }
      if (method === 'DELETE') {
        const { error } = await sb.from('price_alerts').delete().eq('id', body.id).eq('user_id', uid);
        return error ? { success: false, error: error.message } : { success: true };
      }
      break;
    }
    default:
      return { success: false, error: `Unsupported data action: ${action}` };
  }

  return { success: false, error: `Unsupported ${action} operation.` };
}

function bindSupabaseAuthListener() {
  if (supabaseAuthListenerBound || !isSupabaseConfigured()) return;
  const sb = getSupabase();
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      currentUser = null;
      updateHeaderUser();
      return;
    }
    currentUser = await loadCurrentUserFromSupabase();
    updateHeaderUser();
  });
  supabaseAuthListenerBound = true;
}

async function apiCall(url, method = 'GET', body = null) {
  if (/^(auth|data)\.php/i.test(url)) {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase is not configured. Add your project URL and anon key to supabase-config.js.' };
    bindSupabaseAuthListener();
    const action = apiAction(url);
    return url.startsWith('auth.php')
      ? handleAuthAction(action, method, body || {})
      : handleDataAction(action, method, body || {});
  }
  const opts = { method, credentials: 'include', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const token = localStorage.getItem('ie_auth_token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(url, opts);
  return r.json();
}

// ── Auth overlay helpers ──────────────────────────────────────────────────────
function showAuthTab(mode) {
  ensureOtpAuthUi();
  const isLogin    = mode === 'login';
  const isRegister = mode === 'register';
  const isOtp      = mode === 'otp';
  document.getElementById('tab-login-btn').classList.toggle('active', isLogin);
  document.getElementById('tab-register-btn').classList.toggle('active', isRegister);
  document.getElementById('auth-login-form').style.display    = isLogin ? '' : 'none';
  document.getElementById('auth-register-form').style.display = isRegister ? '' : 'none';
  const otpForm = document.getElementById('auth-otp-form');
  if (otpForm) otpForm.style.display = isOtp ? '' : 'none';
  if (isOtp) {
    document.getElementById('auth-footer-text').innerHTML =
      'Need a different email? <span class="auth-link" onclick="showAuthTab(\'' + (pendingOtp?.mode === 'register' ? 'register' : 'login') + '\')">Go back</span>';
  } else if (isLogin) {
    document.getElementById('auth-footer-text').innerHTML =
      'Don\'t have an account? <span class="auth-link" onclick="showAuthTab(\'register\')">Sign up free</span>';
  } else {
    document.getElementById('auth-footer-text').innerHTML =
      'Already have an account? <span class="auth-link" onclick="showAuthTab(\'login\')">Sign in</span>';
  }
  clearAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.color = '';
  el.classList.add('show');
}
function ensureOtpAuthUi() {
  const card = document.querySelector('.auth-card');
  const footer = document.getElementById('auth-footer-text');
  if (!card || !footer) return;

  const legacyForgot = document.getElementById('auth-forgot-form');
  if (legacyForgot) legacyForgot.style.display = 'none';

  const loginPassword = document.getElementById('login-password');
  if (loginPassword && loginPassword.closest('.auth-field')) {
    loginPassword.closest('.auth-field').style.display = 'none';
  }

  const regPassword = document.getElementById('reg-password');
  if (regPassword && regPassword.closest('.auth-field')) {
    regPassword.closest('.auth-field').style.display = 'none';
  }

  const loginInput = document.getElementById('login-email');
  if (loginInput) {
    loginInput.setAttribute('onkeydown', "if(event.key==='Enter')doLogin()");
  }

  const regAge = document.getElementById('reg-age');
  if (regAge) {
    regAge.setAttribute('onkeydown', "if(event.key==='Enter')doRegister()");
  }

  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) loginBtn.textContent = 'Send Sign-In Code';

  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) registerBtn.textContent = 'Send Sign-Up Code';

  let loginNote = document.getElementById('login-otp-note');
  if (!loginNote && loginBtn && loginBtn.parentElement) {
    loginNote = document.createElement('p');
    loginNote.id = 'login-otp-note';
    loginNote.className = 'auth-note';
    loginNote.textContent = "We'll email you a 6-digit code to sign in securely.";
    loginBtn.parentElement.insertBefore(loginNote, loginBtn);
  }
  let registerNote = document.getElementById('register-otp-note');
  if (!registerNote && registerBtn && registerBtn.parentElement) {
    registerNote = document.createElement('p');
    registerNote.id = 'register-otp-note';
    registerNote.className = 'auth-note';
    registerNote.textContent = "We'll send a 6-digit verification code to finish creating your account.";
    registerBtn.parentElement.insertBefore(registerNote, registerBtn);
  }
  if (!document.getElementById('auth-otp-form')) {
    const otpForm = document.createElement('div');
    otpForm.id = 'auth-otp-form';
    otpForm.style.display = 'none';
    otpForm.innerHTML = `
      <p class="auth-note" id="otp-note">Enter the 6-digit code we sent to your email.</p>
      <div class="auth-otp-meta" id="otp-email-display"></div>
      <div class="auth-field">
        <label class="form-label">Verification Code</label>
        <input id="otp-code" class="form-input auth-otp-box" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"
          oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)"
          onkeydown="if(event.key==='Enter')verifyOtpCode()">
      </div>
      <button class="auth-btn" id="otp-btn" onclick="verifyOtpCode()">Verify Code</button>
      <button class="auth-secondary-btn" id="otp-resend-btn" onclick="resendOtpCode()">Resend Code</button>
    `;
    card.insertBefore(otpForm, footer);
  }
}
function clearAuthError() {
  const el = document.getElementById('auth-error');
  el.textContent = '';
  el.style.color = '';
  el.classList.remove('show');
}
function showAuthSuccess(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.color = '#10b981';
  el.classList.add('show');
}
function setAuthLoading(loading) {
  ensureOtpAuthUi();
  ['login-btn', 'register-btn', 'otp-btn', 'otp-resend-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = loading;
  });
}
function setPendingOtp(payload) {
  ensureOtpAuthUi();
  pendingOtp = payload;
  const emailEl = document.getElementById('otp-email-display');
  const noteEl = document.getElementById('otp-note');
  const codeInput = document.getElementById('otp-code');
  if (emailEl) emailEl.textContent = payload?.email ? `Code sent to ${payload.email}` : '';
  if (noteEl) {
    noteEl.textContent = payload?.mode === 'register'
      ? 'Enter the 6-digit code to create your account and sign in.'
      : 'Enter the 6-digit code to sign in to your account.';
  }
  if (codeInput) codeInput.value = '';
}

// ── Session check on load ─────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const d = await apiCall('auth.php?action=me');
    if (d.success) {
      currentUser = d.user;
      if (d.token) localStorage.setItem('ie_auth_token', d.token);
      await syncAfterLogin();
    }
  } catch(e) { /* db.php not set up yet — run in demo mode */ }
  // Always go to home page — no login required
  document.getElementById('auth-overlay').classList.add('hidden');
  updateHeaderUser();
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { showAuthError('Please enter your email address.'); return; }
  clearAuthError();
  setAuthLoading(true);
  try {
    const d = await apiCall('auth.php?action=login', 'POST', { email });
    if (d.success) {
      setPendingOtp({ mode: 'login', email });
      showAuthTab('otp');
      showAuthSuccess(d.message || 'We sent your sign-in code.');
    } else {
      showAuthError(d.error || 'Login failed. Please try again.');
    }
  } catch(e) {
    showAuthError('Connection error. Please try again.');
  }
  setAuthLoading(false);
}

// ── Register ──────────────────────────────────────────────────────────────────
async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const ageVal   = document.getElementById('reg-age').value.trim();
  const age      = ageVal !== '' ? parseInt(ageVal, 10) : null;
  if (!name || !email || !username) { showAuthError('Name, email, and username are required.'); return; }
  if (age !== null && (isNaN(age) || age < 13 || age > 120)) { showAuthError('Please enter a valid age (13–120).'); return; }
  clearAuthError();
  setAuthLoading(true);
  try {
    const d = await apiCall('auth.php?action=register', 'POST', { name, email, username, age });
    if (d.success) {
      setPendingOtp({ mode: 'register', email, name, username, age });
      showAuthTab('otp');
      showAuthSuccess(d.message || 'We sent your sign-up code.');
    } else {
      showAuthError(d.error || 'Registration failed. Please try again.');
    }
  } catch(e) {
    showAuthError('Connection error. Please try again.');
  }
  setAuthLoading(false);
}

// ── Forgot Password — send reset link via email ───────────────────────────────
async function verifyOtpCode() {
  const code = document.getElementById('otp-code').value.trim();
  if (!pendingOtp?.email) { showAuthError('Start by requesting a sign-in code first.'); return; }
  if (!/^\d{6}$/.test(code)) { showAuthError('Enter the full 6-digit code.'); return; }
  clearAuthError();
  setAuthLoading(true);
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({
      email: pendingOtp.email,
      token: code,
      type: 'email'
    });
    if (error) {
      showAuthError(error.message || 'Verification failed. Please try again.');
      setAuthLoading(false);
      return;
    }
    if (!data?.user) {
      showAuthError('Verification succeeded, but no user session was returned.');
      setAuthLoading(false);
      return;
    }

    let profile = null;
    try {
      profile = await ensureProfileRow(data.user, {
        name: pendingOtp.name,
        username: pendingOtp.username,
        age: pendingOtp.age
      });
    } catch (e) {}

    currentUser = normalizeCurrentUser(data.user, profile || {});
    pendingOtp = null;
    document.getElementById('auth-overlay').classList.add('hidden');
    setAuthLoading(false);
    updateHeaderUser();
    syncAfterLogin().catch(() => {});
    return;
  } catch(e) {
    showAuthError('Connection error. Please try again.');
  }
  setAuthLoading(false);
}

async function resendOtpCode() {
  if (!pendingOtp?.email) { showAuthError('Start by requesting a code first.'); return; }
  clearAuthError();
  setAuthLoading(true);
  try {
    const action = pendingOtp.mode === 'register' ? 'register' : 'login';
    const d = await apiCall('auth.php?action=' + action, 'POST', {
      email: pendingOtp.email,
      name: pendingOtp.name,
      username: pendingOtp.username,
      age: pendingOtp.age
    });
    if (d.success) {
      showAuthSuccess(d.message || 'A fresh code is on the way.');
    } else {
      showAuthError(d.error || 'Failed to resend the code.');
    }
  } catch(e) {
    showAuthError('Connection error. Please try again.');
  }
  setAuthLoading(false);
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function doLogout() {
  try { await apiCall('auth.php?action=logout', 'POST'); } catch(e) {}
  localStorage.removeItem('ie_auth_token');
  pendingOtp              = null;
  currentUser            = null;
  dbPortfolio            = [];
  watchlistSet           = new Set();
  alertsMap              = {};
  compareSet.clear();
  compareMode            = false;
  dbSavedReports         = null;
  dbSavedReportsLoading  = false;
  // Portfolio/settings require login — redirect; finbot/saved show their own guest wall
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && (activeTab.id === 'tab-portfolio' || activeTab.id === 'tab-settings')) {
    switchTab('news');
  }
  if (activeTab?.id === 'tab-finbot') renderFinBot();
  if (activeTab?.id === 'tab-saved')  renderSaved();
  updateHeaderUser();
  document.getElementById('auth-overlay').classList.remove('hidden');
  showAuthTab('login');
}

// ── Sync after login: pull settings, watchlist, portfolio from DB ─────────────
function updateHeaderUser() {
  const authBtns = document.getElementById('header-auth-btns');
  const userEl   = document.getElementById('header-user');
  const av = document.getElementById('header-avatar');
  const un = document.getElementById('header-username-text');
  document.querySelectorAll('nav.nav .auth-only').forEach(b => {
    b.style.display = currentUser ? '' : 'none';
  });
  if (currentUser) {
    authBtns.style.display = 'none';
    userEl.style.display = 'flex';
    un.textContent = '@' + currentUser.username;
    av.textContent = (currentUser.name || currentUser.username)[0].toUpperCase();
    const ddName  = document.getElementById('dd-name');
    const ddEmail = document.getElementById('dd-email');
    if (ddName)  ddName.textContent  = currentUser.name || currentUser.username;
    if (ddEmail) ddEmail.textContent = currentUser.email || ('@' + currentUser.username);
    // Tier badge
    const tierColors = { free: '#64748b', pro: '#7c3aed', enterprise: '#d97706' };
    const tierLabels = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
    const t = currentUser.tier || 'free';
    let tierBadge = document.getElementById('header-tier-badge');
    if (!tierBadge) {
      tierBadge = document.createElement('span');
      tierBadge.id = 'header-tier-badge';
      tierBadge.style.cssText = 'font-size:10px;font-weight:800;padding:2px 7px;border-radius:20px;letter-spacing:0.05em;text-transform:uppercase;margin-left:4px';
      un.parentNode.insertBefore(tierBadge, un.nextSibling);
    }
    tierBadge.textContent = tierLabels[t] || t;
    tierBadge.style.background = (tierColors[t] || '#64748b') + '22';
    tierBadge.style.color = tierColors[t] || '#64748b';
    // Credits counter (only for pro/enterprise)
    let credEl = document.getElementById('header-credits');
    if (t !== 'free') {
      if (!credEl) {
        credEl = document.createElement('span');
        credEl.id = 'header-credits';
        credEl.style.cssText = 'font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:#10b98122;color:#10b981;margin-left:4px;cursor:default';
        credEl.title = 'FinBot credits remaining';
        tierBadge.parentNode.insertBefore(credEl, tierBadge.nextSibling);
      }
      credEl.textContent = '⚡ ' + (currentUser.finbot_credits ?? 0) + ' credits';
    } else if (credEl) {
      credEl.remove();
    }
  } else {
    authBtns.style.display = 'flex';
    userEl.style.display = 'none';
  }
}

async function syncAfterLogin() {
  await Promise.all([loadSettingsFromDB(), loadWatchlistFromDB(), loadPortfolioFromDB(), loadSavedReportsFromDB(), loadLearnProgressFromDB(), loadAlertsFromDB()]);
  updateHeaderUser();
  // If the user was already on a gated tab, re-render it now that they're logged in
  const activePanel = document.querySelector('.tab-content.active');
  if (activePanel?.id === 'tab-finbot')    renderFinBot();
  if (activePanel?.id === 'tab-saved')     renderSaved();
  if (activePanel?.id === 'tab-portfolio') renderPortfolio();
}

async function loadSettingsFromDB() {
  try {
    const d = await apiCall('data.php?action=settings');
    if (d.success && d.settings) {
      // Merge into localStorage so existing helpers keep working
      const merged = Object.assign(loadSettings(), d.settings);
      localStorage.setItem('ie_settings', JSON.stringify(merged));
    }
  } catch(e) {}
}

async function loadWatchlistFromDB() {
  try {
    const d = await apiCall('data.php?action=watchlist');
    if (d.success) {
      watchlistSet = new Set(d.watchlist.map(w => w.ticker));
    }
  } catch(e) {}
}

async function loadPortfolioFromDB() {
  try {
    const d = await apiCall('data.php?action=portfolio');
    if (d.success) dbPortfolio = d.portfolio;
  } catch(e) {}
}

// ── Settings DB save (called by saveSettings in background) ──────────────────
function saveSettingsToDB(updates) {
  if (!currentUser) return;
  apiCall('data.php?action=settings', 'POST', updates).catch(() => {});
}

// ── Learn progress DB sync ────────────────────────────────────────────────────
let _learnSaveTimer = null;
function saveLearnProgressToDB() {
  if (!currentUser) return;
  clearTimeout(_learnSaveTimer);
  _learnSaveTimer = setTimeout(() => {
    apiCall('data.php?action=learn_progress', 'POST', { state: learnState }).catch(() => {});
  }, 1500);
}

async function loadLearnProgressFromDB() {
  try {
    const d = await apiCall('data.php?action=learn_progress');
    if (!d.success) return;
    const remote = d.state;
    if (remote && Object.keys(remote).length > 0) {
      // Server has data — merge additively so no progress is lost from either side
      const local = learnState;
      const merged = Object.assign({}, remote);
      LEARN_TOPICS.forEach(t => {
        const r = remote[t.id] || {};
        const l = local[t.id] || {};
        const lessonsRead = [...new Set([...(r.lessonsRead || []), ...(l.lessonsRead || [])])];
        const quizDone = !!(r.quizDone || l.quizDone);
        const quizScore = quizDone ? Math.max(r.quizScore || 0, l.quizScore || 0) : null;
        merged[t.id] = { lessonsRead, quizDone, ...(quizScore !== null ? { quizScore } : {}) };
      });
      // Streak: keep whichever side is more recent
      const rDate = remote._streakDate, lDate = local._streakDate;
      if (lDate && (!rDate || new Date(lDate) > new Date(rDate))) {
        merged._streak = local._streak || 0;
        merged._streakDate = lDate;
      }
      // XP: take higher value (additive; server is the floor)
      merged._xp = Math.max(remote._xp || 0, local._xp || 0);
      // Daily challenge: server wins (prevents local manipulation)
      if (remote._daily) merged._daily = remote._daily;
      learnState = merged;
      localStorage.setItem('ie_learn', JSON.stringify(learnState));
      // Push merged state back if local had extra progress
      saveLearnProgressToDB();
    } else {
      // No server state yet — push whatever local progress exists
      if (Object.keys(learnState).length > 0) saveLearnProgressToDB();
    }
  } catch(e) {}
}

// ── Profile save: update DB if logged in ─────────────────────────────────────
async function saveProfileToDB(name, email, username) {
  if (!currentUser) return true;
  try {
    const d = await apiCall('auth.php?action=update-profile', 'POST', { name, email, username });
    if (d.success) { currentUser = Object.assign(currentUser, d.user); return true; }
    return d.error || 'Failed to update profile.';
  } catch(e) { return 'Connection error.'; }
}

// ── Watchlist helpers ─────────────────────────────────────────────────────────
async function toggleWatchlist(ticker, name) {
  if (!currentUser) return;
  if (watchlistSet.has(ticker)) {
    watchlistSet.delete(ticker);
    apiCall('data.php?action=watchlist', 'DELETE', { ticker }).catch(() => {});
  } else {
    watchlistSet.add(ticker);
    apiCall('data.php?action=watchlist', 'POST', { ticker, name }).catch(() => {});
  }
  renderMarkets(currentMarketsFilter);
}

// ── Add / Remove Portfolio Holdings ──────────────────────────────────────────
function holdingQuickPick(ticker, name, chipEl) {
  // Decode HTML entities (e.g. &amp; → &) for display
  const txt = document.createElement('textarea');
  txt.innerHTML = name;
  document.getElementById('holding-ticker').value = ticker;
  document.getElementById('holding-name').value   = txt.value;

  // Highlight selected chip, clear others
  document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('selected'));
  if (chipEl) chipEl.classList.add('selected');

  // Show current market price as a hint
  const mkt      = RAW_MARKETS.find(m => m.ticker === ticker);
  const hintEl   = document.getElementById('holding-price-hint');
  if (hintEl) {
    if (mkt) {
      hintEl.textContent = 'Market price: ' + fmtUnitPrice(mkt.val);
      hintEl.style.display = 'block';
    } else {
      hintEl.textContent = '';
    }
  }

  // Clear stale values and move focus to quantity
  document.getElementById('holding-shares').value = '';
  document.getElementById('holding-cost').value   = '';
  document.getElementById('holding-error').textContent = '';
  document.getElementById('holding-error').classList.remove('show');
  document.getElementById('holding-shares').focus();
}

function importPortfolioToFinBot(field, textareaId) {
  if (!currentUser || !dbPortfolio.length) return;
  const enriched = dbPortfolio.map(h => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    const cur  = mkt ? mkt.val : h.avg_cost;
    return { ...h, val: h.shares * cur };
  });
  const total = enriched.reduce((s, h) => s + h.val, 0);
  const str   = enriched.map(h => {
    const pct = total > 0 ? Math.round(h.val / total * 100) : 0;
    return `${h.ticker} ${pct}%`;
  }).join(', ');
  finbotForm[field] = str;
  if (field === 'portfolio' && total > 0) finbotForm.portVal = '$' + Math.round(total).toLocaleString();
  const ta = document.getElementById(textareaId);
  if (ta) { ta.value = str; ta.dispatchEvent(new Event('input')); }
  // Flash button feedback
  const btn = document.querySelector(`[data-import="${field}"]`);
  if (btn) { btn.textContent = '✓ Imported'; setTimeout(() => btn.textContent = '↓ Import portfolio', 1500); }
}

function openAddHoldingModal(ticker = '', name = '') {
  document.getElementById('holding-ticker').value = ticker;
  document.getElementById('holding-name').value   = name;
  document.getElementById('holding-shares').value = '';
  document.getElementById('holding-cost').value   = '';
  const e = document.getElementById('holding-error');
  e.textContent = ''; e.classList.remove('show');

  // Sync currency symbol prefix
  const sym = curCfg().symbol;
  const symEl = document.getElementById('holding-cost-sym');
  if (symEl) symEl.textContent = sym;

  // Clear any previous chip selection + price hint
  document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('selected'));
  const hint = document.getElementById('holding-price-hint');
  if (hint) hint.textContent = '';

  // If pre-filled from a quick-pick context (e.g. stock detail), show market price hint
  if (ticker) {
    const mkt = RAW_MARKETS.find(m => m.ticker === ticker);
    if (mkt && hint) hint.textContent = 'Market price: ' + fmtUnitPrice(mkt.val);
  }

  document.getElementById('add-holding-modal').classList.remove('hidden');
}
function closeAddHoldingModal() {
  document.getElementById('add-holding-modal').classList.add('hidden');
}
document.getElementById('add-holding-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAddHoldingModal();
});

async function saveHolding() {
  const ticker  = document.getElementById('holding-ticker').value.trim().toUpperCase();
  const name    = document.getElementById('holding-name').value.trim() || ticker;
  const shares  = parseFloat(document.getElementById('holding-shares').value);
  const avgCost = parseFloat(document.getElementById('holding-cost').value);
  const errEl   = document.getElementById('holding-error');

  if (!ticker || isNaN(shares) || shares <= 0 || isNaN(avgCost) || avgCost < 0) {
    errEl.textContent = 'Please fill in all fields correctly.';
    errEl.classList.add('show');
    return;
  }

  try {
    const d = await apiCall('data.php?action=portfolio', 'POST', { ticker, name, shares, avg_cost: avgCost });
    if (d.success) {
      await loadPortfolioFromDB();
      closeAddHoldingModal();
      renderPortfolio();
    } else {
      errEl.textContent = d.error || 'Failed to save.';
      errEl.classList.add('show');
    }
  } catch(e) {
    errEl.textContent = 'Connection error.';
    errEl.classList.add('show');
  }
}

async function removeHolding(ticker) {
  if (!confirm('Remove ' + ticker + ' from your portfolio?')) return;
  try {
    await apiCall('data.php?action=portfolio', 'DELETE', { ticker });
    await loadPortfolioFromDB();
    renderPortfolio();
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING HUB
// ═══════════════════════════════════════════════════════════════════════════

const LEARN_TOPICS = [
  {
    id: 'basics',
    icon: '📊',
    iconBg: '#10b98118',
    title: 'Investing Basics',
    desc: 'Stocks, bonds, ETFs, and how the market works',
    difficulty: 'beginner',
    lessons: [
      {
        title: 'What is Investing?',
        content: `
          <p>Investing is putting your money to work by purchasing assets that have the potential to grow in value over time. Instead of keeping cash idle, investors allocate capital into stocks, bonds, real estate, and other instruments to build wealth.</p>
          <div class="highlight">Key Principle: Investing is about making your money generate more money — the earlier you start, the more time compound interest has to work its magic.</div>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Why Invest?</h4>
          <ul>
            <li><span class="term">Beat inflation</span> — Cash loses purchasing power over time. The average inflation rate is ~3% per year.</li>
            <li><span class="term">Build wealth</span> — Global equity markets have returned ~7–10% annually on average over the long term.</li>
            <li><span class="term">Financial freedom</span> — Investments can generate passive income and fund retirement.</li>
            <li><span class="term">Achieve goals</span> — Save for a house, education, or any long-term goal more effectively.</li>
          </ul>
          <div class="warn">Remember: All investing carries risk. You can lose money. Never invest more than you can afford to lose, and always do your research.</div>
        `
      },
      {
        title: 'Stocks Explained',
        content: `
          <p>A <span class="term">stock</span> (also called a share or equity) represents partial ownership in a company. When you buy a stock, you become a shareholder — you literally own a small piece of that business.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How Stocks Make You Money</h4>
          <ul>
            <li><span class="term">Capital gains</span> — The stock price increases over time, and you sell for a profit.</li>
            <li><span class="term">Dividends</span> — Some companies pay a portion of profits to shareholders quarterly.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Stock Terms</h4>
          <ul>
            <li><span class="term">Ticker symbol</span> — The short abbreviation for a stock (e.g., AAPL = Apple).</li>
            <li><span class="term">Market cap</span> — Total value of all shares (share price × shares outstanding).</li>
            <li><span class="term">P/E Ratio</span> — Price-to-Earnings ratio. How much investors pay per dollar of earnings.</li>
            <li><span class="term">Volume</span> — Number of shares traded in a given period.</li>
            <li><span class="term">Bid/Ask</span> — The highest price a buyer will pay (bid) and lowest a seller will accept (ask).</li>
          </ul>
          <div class="highlight">A company with a low P/E ratio might be undervalued, while a high P/E could mean investors expect strong future growth — or that the stock is overpriced.</div>
        `
      },
      {
        title: 'Bonds & Fixed Income',
        content: `
          <p>A <span class="term">bond</span> is essentially a loan you make to a government or corporation. In return, they pay you interest (called a coupon) at regular intervals and return your principal when the bond matures.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Bonds</h4>
          <ul>
            <li><span class="term">Treasury Bonds</span> — Issued by the U.S. government. Safest but lowest returns.</li>
            <li><span class="term">Corporate Bonds</span> — Issued by companies. Higher yield but more risk.</li>
            <li><span class="term">Municipal Bonds</span> — Issued by state/local governments. Often tax-exempt.</li>
            <li><span class="term">High-Yield (Junk) Bonds</span> — Lower credit rating, higher returns, more risk of default.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Bond Concepts</h4>
          <ul>
            <li><span class="term">Yield</span> — The annual return as a percentage of the bond's price.</li>
            <li><span class="term">Maturity</span> — When the bond's principal is repaid (e.g., 10-year bond).</li>
            <li><span class="term">Credit rating</span> — AAA (safest) to D (default). Agencies like Moody's and S&P rate bonds.</li>
          </ul>
          <div class="highlight">When interest rates rise, existing bond prices fall (and vice versa). This is called interest rate risk.</div>
        `
      },
      {
        title: 'ETFs & Index Funds',
        content: `
          <p>An <span class="term">ETF (Exchange-Traded Fund)</span> is a basket of securities that trades on an exchange like a stock. ETFs let you invest in hundreds of companies at once with a single purchase.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Why ETFs Are Popular</h4>
          <ul>
            <li><span class="term">Instant diversification</span> — A single global ETF can give you exposure to hundreds of companies across dozens of countries.</li>
            <li><span class="term">Low fees</span> — Index ETFs charge as little as 0.03–0.20% per year.</li>
            <li><span class="term">Easy to trade</span> — Buy and sell throughout the day like stocks.</li>
            <li><span class="term">Tax efficient</span> — Generally more tax-friendly than actively managed funds.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Common ETF Categories</h4>
          <ul>
            <li><span class="term">Global equity ETFs</span> — Track world indices like the MSCI World or FTSE All-World, covering thousands of companies globally.</li>
            <li><span class="term">Regional ETFs</span> — Focus on specific regions (e.g., Europe, Asia-Pacific, emerging markets).</li>
            <li><span class="term">Sector ETFs</span> — Target specific industries such as technology, healthcare, or energy.</li>
            <li><span class="term">Bond ETFs</span> — Provide income through diversified exposure to government or corporate bonds.</li>
          </ul>
          <div class="highlight">Many investment experts advise most investors to keep it simple: a low-cost global index fund gives broad diversification at minimal cost, outperforming most active managers over the long run.</div>
        `
      }
    ],
    quiz: [
      { q: 'What does a stock represent?', opts: ['A loan to a company', 'Partial ownership in a company', 'A government bond', 'A savings account'], ans: 1, explain: 'A stock represents partial ownership (equity) in a company. When you buy shares, you own a small piece of that business.' },
      { q: 'What is the P/E ratio?', opts: ['Price to Earnings ratio', 'Profit to Equity ratio', 'Payment to Exchange ratio', 'Portfolio to Expense ratio'], ans: 0, explain: 'The P/E ratio is the Price-to-Earnings ratio — it tells you how much investors are paying for each dollar of a company\'s earnings.' },
      { q: 'What happens to bond prices when interest rates rise?', opts: ['They go up', 'They go down', 'They stay the same', 'They become worthless'], ans: 1, explain: 'When interest rates rise, existing bond prices fall because new bonds offer higher yields, making older bonds less attractive.' },
      { q: 'What is an ETF?', opts: ['A type of savings account', 'A basket of securities that trades like a stock', 'A government tax form', 'An insurance product'], ans: 1, explain: 'An ETF (Exchange-Traded Fund) is a basket of securities — stocks, bonds, or commodities — that trades on exchanges just like individual stocks.' },
      { q: 'Which of these is NOT a reason to invest?', opts: ['Beat inflation', 'Build long-term wealth', 'Guaranteed short-term profits', 'Achieve financial goals'], ans: 2, explain: 'There are no guaranteed profits in investing. All investments carry some risk, and short-term returns are unpredictable.' }
    ]
  },
  {
    id: 'strategies',
    icon: '🎯',
    iconBg: '#3b82f618',
    title: 'Investment Strategies',
    desc: 'Value investing, growth, DCA, and portfolio building',
    difficulty: 'intermediate',
    lessons: [
      {
        title: 'Value Investing',
        content: `
          <p><span class="term">Value investing</span> is a strategy of buying stocks that appear underpriced relative to their intrinsic value. Popularized by Benjamin Graham and practiced famously by Warren Buffett.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Core Principles</h4>
          <ul>
            <li><span class="term">Intrinsic value</span> — Every company has a true worth based on its fundamentals (earnings, assets, cash flow).</li>
            <li><span class="term">Margin of safety</span> — Buy well below intrinsic value to cushion against errors in your analysis.</li>
            <li><span class="term">Mr. Market</span> — The market is emotional. Prices swing above and below fair value, creating opportunities.</li>
            <li><span class="term">Long-term focus</span> — Be patient. The market eventually recognizes true value.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">What to Look For</h4>
          <ul>
            <li>Low P/E ratio compared to industry peers</li>
            <li>Strong balance sheet (low debt, plenty of cash)</li>
            <li>Consistent earnings and cash flow growth</li>
            <li>Durable competitive advantages ("moats")</li>
          </ul>
          <div class="highlight">"Price is what you pay. Value is what you get." — Warren Buffett</div>
        `
      },
      {
        title: 'Growth Investing',
        content: `
          <p><span class="term">Growth investing</span> focuses on companies expected to grow revenues and earnings faster than the market average. These stocks often have high P/E ratios because investors are paying a premium for future potential.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Characteristics of Growth Stocks</h4>
          <ul>
            <li><span class="term">High revenue growth</span> — Often 20%+ year-over-year revenue increases.</li>
            <li><span class="term">Market disruption</span> — Companies creating new markets or disrupting existing ones.</li>
            <li><span class="term">Reinvesting profits</span> — Growth companies often reinvest earnings rather than paying dividends.</li>
            <li><span class="term">High valuations</span> — Investors accept premium prices for strong growth potential.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Risks</h4>
          <ul>
            <li>If growth slows, the stock can drop dramatically</li>
            <li>High valuations leave little room for error</li>
            <li>More volatile than value stocks</li>
          </ul>
          <div class="warn">Not every high-growth company becomes the next Amazon. Many fail. Diversification is crucial when investing in growth stocks.</div>
        `
      },
      {
        title: 'Dollar-Cost Averaging (DCA)',
        content: `
          <p><span class="term">Dollar-Cost Averaging (DCA)</span> is investing a fixed amount of money at regular intervals, regardless of market conditions. This is one of the simplest and most effective strategies for long-term investors.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How DCA Works</h4>
          <p>Say you invest a fixed amount each month into a broad market index fund:</p>
          <ul>
            <li>When prices are <strong>high</strong>, your fixed amount buys fewer shares</li>
            <li>When prices are <strong>low</strong>, your fixed amount buys more shares</li>
            <li>Over time, your average cost per share smooths out</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Why DCA Works</h4>
          <ul>
            <li><span class="term">Removes emotion</span> — No trying to time the market.</li>
            <li><span class="term">Builds discipline</span> — Consistent investing becomes a habit.</li>
            <li><span class="term">Reduces timing risk</span> — Avoids the danger of investing everything at a market peak.</li>
            <li><span class="term">Simple to automate</span> — Set up automatic monthly purchases.</li>
          </ul>
          <div class="highlight">Studies show that DCA often outperforms lump-sum timing attempts because even professionals can't consistently predict market direction.</div>
        `
      },
      {
        title: 'Portfolio Diversification',
        content: `
          <p><span class="term">Diversification</span> means spreading your investments across different asset classes, sectors, and geographies to reduce risk. It's the investment equivalent of "don't put all your eggs in one basket."</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Diversification</h4>
          <ul>
            <li><span class="term">Asset class</span> — Mix of stocks, bonds, real estate, commodities.</li>
            <li><span class="term">Sector</span> — Spread across tech, healthcare, finance, energy, etc.</li>
            <li><span class="term">Geographic</span> — Your home market, other developed markets, and emerging markets.</li>
            <li><span class="term">Company size</span> — Large-cap, mid-cap, and small-cap stocks.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Sample Portfolios by Risk Level</h4>
          <ul>
            <li><span class="term">Conservative</span> — 30% stocks, 60% bonds, 10% cash</li>
            <li><span class="term">Moderate</span> — 60% stocks, 30% bonds, 10% alternatives</li>
            <li><span class="term">Aggressive</span> — 85% stocks, 10% bonds, 5% crypto/alternatives</li>
          </ul>
          <div class="highlight">Diversification can't eliminate all risk, but it can significantly reduce the impact of any single investment's poor performance on your overall portfolio.</div>
        `
      }
    ],
    quiz: [
      { q: 'What is the "margin of safety" in value investing?', opts: ['A type of stop-loss order', 'Buying well below intrinsic value to cushion against errors', 'The minimum account balance required', 'Insurance on your portfolio'], ans: 1, explain: 'The margin of safety means buying stocks well below their estimated intrinsic value, giving you a buffer if your analysis is wrong.' },
      { q: 'What does Dollar-Cost Averaging (DCA) involve?', opts: ['Investing everything at once', 'Investing a fixed amount at regular intervals', 'Only buying stocks when they dip', 'Trading daily based on trends'], ans: 1, explain: 'DCA means investing a fixed amount at regular intervals (e.g., monthly) regardless of whether the market is up or down.' },
      { q: 'Which is a characteristic of growth stocks?', opts: ['Low P/E ratios', 'High dividend yields', 'High revenue growth rates', 'Minimal price volatility'], ans: 2, explain: 'Growth stocks are defined by their high revenue and earnings growth rates, often 20%+ year-over-year. They typically have high P/E ratios and low or no dividends.' },
      { q: 'What is portfolio diversification?', opts: ['Buying only one type of asset', 'Spreading investments across different assets to reduce risk', 'Investing only in the safest bonds', 'Holding only cash'], ans: 1, explain: 'Diversification means spreading investments across different asset classes, sectors, and geographies to reduce the risk of any single position hurting your portfolio.' },
      { q: 'A conservative portfolio typically has more of what?', opts: ['Cryptocurrency', 'Growth stocks', 'Bonds', 'Penny stocks'], ans: 2, explain: 'Conservative portfolios weight heavily toward bonds (60%+) because they offer more stability and lower volatility than stocks or crypto.' }
    ]
  },
  {
    id: 'analysis',
    icon: '🔍',
    iconBg: '#8b5cf618',
    title: 'Fundamental Analysis',
    desc: 'Reading financial statements and evaluating companies',
    difficulty: 'intermediate',
    lessons: [
      {
        title: 'The Income Statement',
        content: `
          <p>The <span class="term">income statement</span> (also called the profit & loss statement or P&L) shows how much money a company earned and spent over a period. It's the report card for a company's profitability.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Line Items</h4>
          <ul>
            <li><span class="term">Revenue (Sales)</span> — Total money earned from selling products/services. The "top line."</li>
            <li><span class="term">Cost of Goods Sold (COGS)</span> — Direct costs to produce what was sold.</li>
            <li><span class="term">Gross Profit</span> — Revenue minus COGS. Shows production efficiency.</li>
            <li><span class="term">Operating Expenses</span> — R&D, marketing, salaries, rent — costs to run the business.</li>
            <li><span class="term">Operating Income (EBIT)</span> — Gross profit minus operating expenses.</li>
            <li><span class="term">Net Income</span> — The "bottom line" — what's left after all expenses, interest, and taxes.</li>
          </ul>
          <div class="highlight">Growing revenue is great, but growing net income margins is even better — it means the company is becoming more efficient at converting sales into profit.</div>
        `
      },
      {
        title: 'The Balance Sheet',
        content: `
          <p>The <span class="term">balance sheet</span> is a snapshot of what a company owns (assets), what it owes (liabilities), and what shareholders own (equity) at a specific point in time.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Fundamental Equation</h4>
          <div class="highlight" style="font-weight:700;text-align:center;font-size:15px">Assets = Liabilities + Shareholders' Equity</div>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Items</h4>
          <ul>
            <li><span class="term">Current Assets</span> — Cash, receivables, inventory — can be converted to cash within a year.</li>
            <li><span class="term">Long-term Assets</span> — Property, equipment, patents, goodwill.</li>
            <li><span class="term">Current Liabilities</span> — Bills due within a year (accounts payable, short-term debt).</li>
            <li><span class="term">Long-term Debt</span> — Loans and bonds due after one year.</li>
            <li><span class="term">Shareholders' Equity</span> — Net worth. Assets minus all liabilities. Also called book value.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Ratios from the Balance Sheet</h4>
          <ul>
            <li><span class="term">Debt-to-Equity Ratio</span> — Total debt / shareholders' equity. Lower is generally better.</li>
            <li><span class="term">Current Ratio</span> — Current assets / current liabilities. Above 1.0 means the company can pay its short-term bills.</li>
          </ul>
        `
      },
      {
        title: 'Cash Flow Statement',
        content: `
          <p>The <span class="term">cash flow statement</span> tracks actual cash moving in and out of a company. A profitable company on paper can still go bankrupt if it runs out of cash.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Three Sections</h4>
          <ul>
            <li><span class="term">Operating Cash Flow</span> — Cash from core business operations. This is the most important. Positive and growing is ideal.</li>
            <li><span class="term">Investing Cash Flow</span> — Cash spent on or received from investments (buying equipment, acquisitions). Usually negative for growing companies.</li>
            <li><span class="term">Financing Cash Flow</span> — Cash from issuing debt/stock or paying dividends/buying back shares.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Free Cash Flow (FCF)</h4>
          <div class="highlight">Free Cash Flow = Operating Cash Flow − Capital Expenditures<br><br>FCF is the cash available for dividends, buybacks, debt payoff, or reinvestment. It's one of the most important metrics for valuing a company.</div>
          <div class="warn">A company with rising earnings but declining cash flow is a red flag — it may be using accounting tricks to inflate profits.</div>
        `
      },
      {
        title: 'Valuation Metrics',
        content: `
          <p>Valuation metrics help you determine whether a stock is cheap, fair, or expensive relative to its fundamentals.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Essential Metrics</h4>
          <ul>
            <li><span class="term">P/E Ratio</span> — Price / Earnings Per Share. A P/E of 20 means you're paying $20 for every $1 of earnings.</li>
            <li><span class="term">P/B Ratio</span> — Price / Book Value. Useful for asset-heavy companies like banks.</li>
            <li><span class="term">P/S Ratio</span> — Price / Sales. Useful for unprofitable companies with strong revenue growth.</li>
            <li><span class="term">EV/EBITDA</span> — Enterprise Value / EBITDA. Accounts for debt, often more accurate than P/E.</li>
            <li><span class="term">PEG Ratio</span> — P/E / Earnings Growth Rate. A PEG below 1 may indicate an undervalued growth stock.</li>
            <li><span class="term">Dividend Yield</span> — Annual dividend / stock price. Higher yield = more income.</li>
          </ul>
          <div class="highlight">No single metric tells the whole story. Always compare metrics to industry peers and the company's own historical averages.</div>
        `
      }
    ],
    quiz: [
      { q: 'What does the income statement show?', opts: ['What a company owns and owes', 'Cash moving in and out', 'Revenue, expenses, and profitability over a period', 'The company\'s stock price history'], ans: 2, explain: 'The income statement shows a company\'s revenues, expenses, and resulting profit or loss over a specific period (quarter or year).' },
      { q: 'What is the balance sheet equation?', opts: ['Revenue − Expenses = Profit', 'Assets = Liabilities + Equity', 'Cash In − Cash Out = Net Cash', 'Price × Volume = Market Cap'], ans: 1, explain: 'The fundamental accounting equation is Assets = Liabilities + Shareholders\' Equity. Everything a company owns is funded by either debt or equity.' },
      { q: 'What is Free Cash Flow?', opts: ['Total revenue minus taxes', 'Operating cash flow minus capital expenditures', 'Stock price times shares outstanding', 'Dividends paid to shareholders'], ans: 1, explain: 'Free Cash Flow = Operating Cash Flow − Capital Expenditures. It represents the cash available after maintaining or expanding the asset base.' },
      { q: 'A PEG ratio below 1 generally suggests what?', opts: ['The stock is overvalued', 'The stock may be undervalued relative to its growth', 'The company is losing money', 'The company has too much debt'], ans: 1, explain: 'A PEG ratio below 1 suggests the stock\'s price may not fully reflect its earnings growth rate, potentially indicating undervaluation.' },
      { q: 'Which is a red flag in financial analysis?', opts: ['Rising revenue and rising cash flow', 'Consistently growing dividends', 'Rising earnings but declining cash flow', 'Low debt-to-equity ratio'], ans: 2, explain: 'Rising earnings with declining cash flow can indicate aggressive accounting. Real cash generation should support reported profits.' }
    ]
  },
  {
    id: 'technical',
    icon: '📈',
    iconBg: '#f59e0b18',
    title: 'Technical Analysis',
    desc: 'Charts, patterns, indicators, and price action',
    difficulty: 'advanced',
    lessons: [
      {
        title: 'Reading Price Charts',
        content: `
          <p><span class="term">Technical analysis</span> studies price movements and trading volume to forecast future price direction. Unlike fundamental analysis (which looks at financials), technical analysis reads the story told by the charts.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Chart Types</h4>
          <ul>
            <li><span class="term">Line chart</span> — Simple. Plots closing prices over time.</li>
            <li><span class="term">Candlestick chart</span> — Shows open, high, low, and close for each period. Green = up, red = down.</li>
            <li><span class="term">Bar chart</span> — Similar to candlestick but uses horizontal lines instead of bodies.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Timeframes</h4>
          <ul>
            <li><span class="term">Intraday</span> — 1-min, 5-min, 15-min, 1-hour candles. For day traders.</li>
            <li><span class="term">Daily</span> — Each candle = one trading day. Most popular for swing traders.</li>
            <li><span class="term">Weekly/Monthly</span> — Big picture trends for long-term investors.</li>
          </ul>
          <div class="highlight">Candlestick charts are the most popular because they pack four data points (open, high, low, close) into each candle, revealing market sentiment at a glance.</div>
        `
      },
      {
        title: 'Support & Resistance',
        content: `
          <p><span class="term">Support</span> is a price level where buying pressure tends to prevent further decline. <span class="term">Resistance</span> is a price level where selling pressure tends to prevent further advance.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Concepts</h4>
          <ul>
            <li>Support and resistance form because traders remember previous price levels and act on them.</li>
            <li>The more times a level is tested, the stronger it becomes.</li>
            <li>When support breaks, it often becomes resistance (and vice versa).</li>
            <li><span class="term">Breakout</span> — When price pushes through support or resistance with volume, expect a strong move.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How to Identify Levels</h4>
          <ul>
            <li>Look for areas where price has bounced multiple times</li>
            <li>Round numbers (e.g., 100, 50, 1000) often act as psychological support/resistance in any currency</li>
            <li>Previous highs and lows are natural levels</li>
            <li>Moving averages can act as dynamic support/resistance</li>
          </ul>
          <div class="warn">A "false breakout" occurs when price briefly crosses a level then reverses. Wait for confirmation (strong volume, candle close beyond the level) before trading breakouts.</div>
        `
      },
      {
        title: 'Moving Averages',
        content: `
          <p>A <span class="term">moving average (MA)</span> smooths out price data by calculating the average price over a set number of periods. It helps identify the trend direction and potential support/resistance levels.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Moving Averages</h4>
          <ul>
            <li><span class="term">SMA (Simple Moving Average)</span> — Equal weight to all periods. E.g., 50-day SMA = average of last 50 closing prices.</li>
            <li><span class="term">EMA (Exponential Moving Average)</span> — More weight on recent prices, reacts faster to changes.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Moving Average Signals</h4>
          <ul>
            <li><span class="term">Golden Cross</span> — 50-day MA crosses above 200-day MA. Bullish long-term signal.</li>
            <li><span class="term">Death Cross</span> — 50-day MA crosses below 200-day MA. Bearish long-term signal.</li>
            <li><span class="term">Price above MA</span> — Generally bullish. The MA acts as support.</li>
            <li><span class="term">Price below MA</span> — Generally bearish. The MA acts as resistance.</li>
          </ul>
          <div class="highlight">The 200-day moving average is widely watched by institutional investors worldwide. When a major market index is above its 200-day MA, it's generally considered to be in a bullish trend.</div>
        `
      },
      {
        title: 'Common Indicators',
        content: `
          <p>Technical indicators are mathematical calculations based on price and/or volume that help traders make decisions.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Essential Indicators</h4>
          <ul>
            <li><span class="term">RSI (Relative Strength Index)</span> — Oscillates 0–100. Above 70 = overbought, below 30 = oversold. Measures momentum.</li>
            <li><span class="term">MACD</span> — Moving Average Convergence Divergence. Shows trend direction and momentum. Bullish when MACD line crosses above signal line.</li>
            <li><span class="term">Bollinger Bands</span> — A moving average with upper/lower bands (2 standard deviations). Price touching the bands suggests overextension.</li>
            <li><span class="term">Volume</span> — Confirms price moves. High volume on a breakout = strong signal. Low volume = weak/suspect move.</li>
          </ul>
          <div class="highlight">Don't use too many indicators at once — they often give conflicting signals. Pick 2–3 that complement each other (e.g., one trend indicator + one momentum indicator).</div>
          <div class="warn">No indicator is perfect. Technical analysis works best when combined with an understanding of market context, news events, and fundamental analysis.</div>
        `
      }
    ],
    quiz: [
      { q: 'What does a "Golden Cross" signal?', opts: ['A bearish reversal', 'Short-term MA crosses above long-term MA (bullish)', 'The stock has reached its all-time high', 'Volume has reached a record level'], ans: 1, explain: 'A Golden Cross occurs when the 50-day moving average crosses above the 200-day moving average, signaling a potential long-term bullish trend.' },
      { q: 'An RSI reading above 70 typically indicates:', opts: ['The stock is oversold', 'The stock is overbought', 'The trend is neutral', 'Volume is increasing'], ans: 1, explain: 'An RSI above 70 indicates the stock may be overbought — it has risen quickly and might be due for a pullback. Below 30 indicates oversold.' },
      { q: 'What happens when support is broken?', opts: ['It disappears entirely', 'It often becomes resistance', 'The stock always crashes', 'Trading is halted'], ans: 1, explain: 'When a support level is broken, it often flips to become a resistance level — the previous floor becomes a ceiling. This is called a role reversal.' },
      { q: 'Which chart type shows open, high, low, and close?', opts: ['Line chart', 'Candlestick chart', 'Point and figure chart', 'Pie chart'], ans: 1, explain: 'Candlestick charts display four data points per period: open, high, low, and close, making them the most informative chart type for technical analysis.' },
      { q: 'What confirms the strength of a price breakout?', opts: ['Low trading volume', 'High trading volume', 'A news announcement', 'The time of day'], ans: 1, explain: 'High volume on a breakout confirms conviction behind the move. Low volume breakouts are more likely to be false breakouts that reverse.' }
    ]
  },
  {
    id: 'risk',
    icon: '🛡️',
    iconBg: '#06b6d418',
    title: 'Risk Management',
    desc: 'Protecting your capital and managing downside',
    difficulty: 'beginner',
    lessons: [
      {
        title: 'Understanding Risk',
        content: `
          <p><span class="term">Risk</span> in investing is the possibility that your actual returns will differ from expected returns — including the possibility of losing some or all of your investment.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Risk</h4>
          <ul>
            <li><span class="term">Market risk</span> — The entire market declines (recession, crash). Affects nearly all stocks.</li>
            <li><span class="term">Company-specific risk</span> — Bad earnings, scandal, or bankruptcy at one company. Diversification reduces this.</li>
            <li><span class="term">Interest rate risk</span> — Rising rates hurt bond prices and can pressure stock valuations.</li>
            <li><span class="term">Inflation risk</span> — Returns don't keep up with inflation, losing purchasing power.</li>
            <li><span class="term">Liquidity risk</span> — Can't sell an investment quickly without a major price concession.</li>
            <li><span class="term">Currency risk</span> — International investments affected by exchange rate changes.</li>
          </ul>
          <div class="highlight">Risk and return are related. Higher potential returns generally come with higher risk. There is no such thing as a high-return, no-risk investment.</div>
        `
      },
      {
        title: 'Position Sizing',
        content: `
          <p><span class="term">Position sizing</span> determines how much of your portfolio to allocate to a single investment. It's one of the most important — yet overlooked — aspects of risk management.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Rules of Thumb</h4>
          <ul>
            <li><span class="term">The 5% rule</span> — No single stock should be more than 5% of your portfolio.</li>
            <li><span class="term">The 1% rule</span> — Never risk more than 1% of your portfolio on a single trade (for active traders).</li>
            <li><span class="term">Conviction-based</span> — Allocate more to your highest-conviction ideas, but still cap exposure.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Why It Matters</h4>
          <p>If you put 50% of your portfolio in one stock and it drops 40%, your whole portfolio is down 20%. If that same stock were 5% of your portfolio, the impact is only 2%.</p>
          <div class="warn">The #1 mistake new investors make is concentrating too heavily in a single stock because they're "sure" about it. Even the best analysts are wrong frequently.</div>
        `
      },
      {
        title: 'Stop Losses & Exit Strategies',
        content: `
          <p>A <span class="term">stop-loss</span> is a predetermined price at which you'll sell an investment to limit your losses. Having exit rules before you enter a position is crucial.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Stops</h4>
          <ul>
            <li><span class="term">Fixed percentage stop</span> — Sell if the stock drops X% from your purchase price (e.g., 10%).</li>
            <li><span class="term">Trailing stop</span> — Moves up with the stock price. E.g., always 10% below the highest price reached.</li>
            <li><span class="term">Support-based stop</span> — Place stop just below a key technical support level.</li>
            <li><span class="term">Time stop</span> — Sell if the investment hasn't performed within a set timeframe.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Exit Strategy Principles</h4>
          <ul>
            <li>Define your exit before you enter the trade</li>
            <li>Cut losers early, let winners run</li>
            <li>Don't move your stop loss further away to avoid getting stopped out</li>
          </ul>
          <div class="highlight">"The first loss is the best loss." — A small loss today prevents a devastating loss tomorrow. Protecting capital is more important than maximizing gains.</div>
        `
      }
    ],
    quiz: [
      { q: 'What is market risk?', opts: ['Risk of one company going bankrupt', 'Risk that the entire market declines', 'Risk of currency fluctuations', 'Risk of high inflation'], ans: 1, explain: 'Market risk (also called systematic risk) affects the entire market — like recessions or major geopolitical events. It cannot be eliminated through diversification.' },
      { q: 'The 5% rule in position sizing recommends:', opts: ['Saving 5% of income monthly', 'No single stock should exceed 5% of your portfolio', 'Only investing in the top 5 stocks', 'Keeping 5% of your portfolio in cash'], ans: 1, explain: 'The 5% rule suggests limiting any single stock position to no more than 5% of your total portfolio, ensuring adequate diversification.' },
      { q: 'What is a trailing stop loss?', opts: ['A stop that never changes', 'A stop that moves up with the stock price', 'A stop based on time only', 'A stop that triggers after hours'], ans: 1, explain: 'A trailing stop follows the stock price upward, maintaining a set percentage or dollar distance below the highest price reached, locking in gains as the stock rises.' },
      { q: 'Which statement about risk is TRUE?', opts: ['Higher returns always mean lower risk', 'Diversification eliminates all risk', 'Higher potential returns generally come with higher risk', 'Bonds have zero risk'], ans: 2, explain: 'Risk and return are fundamentally linked. To achieve higher potential returns, investors must generally accept higher risk. No investment is truly risk-free.' }
    ]
  },
  {
    id: 'psychology',
    icon: '🧠',
    iconBg: '#ec489918',
    title: 'Investor Psychology',
    desc: 'Emotional biases, behavioral finance, and discipline',
    difficulty: 'advanced',
    lessons: [
      {
        title: 'Common Cognitive Biases',
        content: `
          <p>Behavioral finance studies how psychological biases lead investors to make irrational decisions. Understanding these biases is the first step to overcoming them.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Biases</h4>
          <ul>
            <li><span class="term">Confirmation bias</span> — Seeking information that supports your existing beliefs and ignoring contradicting evidence.</li>
            <li><span class="term">Loss aversion</span> — The pain of losing $100 feels about 2x stronger than the pleasure of gaining $100. This causes investors to hold losers too long.</li>
            <li><span class="term">Anchoring</span> — Fixating on a specific price (like your purchase price) rather than evaluating current value objectively.</li>
            <li><span class="term">Recency bias</span> — Overweighting recent events. After a crash, assuming more crashes. After a rally, assuming it will continue.</li>
            <li><span class="term">Herd mentality</span> — Following the crowd. Buying when everyone is euphoric, selling when everyone is panicking.</li>
            <li><span class="term">Overconfidence</span> — Overestimating your ability to pick stocks or time the market.</li>
          </ul>
          <div class="highlight">"Be fearful when others are greedy, and greedy when others are fearful." — Warren Buffett. The best opportunities often come when emotions run highest.</div>
        `
      },
      {
        title: 'Emotional Discipline',
        content: `
          <p>The difference between successful and unsuccessful investors often isn't knowledge — it's emotional discipline. Markets are designed to exploit your emotions.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Building Discipline</h4>
          <ul>
            <li><span class="term">Have a written plan</span> — Define your strategy, criteria for buying/selling, and risk limits before you invest.</li>
            <li><span class="term">Automate when possible</span> — Automatic DCA removes the temptation to time the market.</li>
            <li><span class="term">Check less often</span> — Daily portfolio checking increases anxiety and trading. Weekly or monthly is enough.</li>
            <li><span class="term">Keep a journal</span> — Record why you made each investment decision. Review it to learn from mistakes.</li>
            <li><span class="term">Accept uncertainty</span> — No one knows what the market will do tomorrow. Focus on process, not outcomes.</li>
          </ul>
          <div class="warn">During the 2020 COVID crash, investors who panic-sold at the bottom missed a 70%+ recovery within a year. Emotional selling is the single biggest destroyer of long-term wealth.</div>
          <div class="highlight">The goal isn't to be emotionless — it's to recognize your emotions and ensure they don't override your strategy.</div>
        `
      },
      {
        title: 'FOMO & Market Cycles',
        content: `
          <p><span class="term">FOMO (Fear of Missing Out)</span> drives investors to chase hot stocks, sectors, or trends after they've already risen significantly. It's one of the most destructive forces in investing.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Market Cycle of Emotions</h4>
          <ul>
            <li><span class="term">Optimism</span> → <span class="term">Excitement</span> → <span class="term">Thrill</span> → <span class="term">Euphoria</span> (maximum financial risk!)</li>
            <li><span class="term">Anxiety</span> → <span class="term">Denial</span> → <span class="term">Fear</span> → <span class="term">Panic</span> (maximum financial opportunity!)</li>
            <li><span class="term">Capitulation</span> → <span class="term">Depression</span> → <span class="term">Hope</span> → <span class="term">Relief</span></li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Protecting Against FOMO</h4>
          <ul>
            <li>If everyone is talking about a stock, you're probably late</li>
            <li>Stick to your investment criteria regardless of hype</li>
            <li>Remember: there's always another opportunity</li>
            <li>The best investors spend most of their time waiting, not trading</li>
          </ul>
          <div class="highlight">"The stock market is a device for transferring money from the impatient to the patient." — Warren Buffett</div>
        `
      }
    ],
    quiz: [
      { q: 'What is loss aversion?', opts: ['Fear of investing at all', 'Losses feel ~2x more painful than equivalent gains feel good', 'A strategy to avoid all losses', 'A type of insurance for investments'], ans: 1, explain: 'Loss aversion means the psychological pain of losing $100 is roughly twice as strong as the pleasure of gaining $100, causing investors to hold losing positions too long.' },
      { q: 'When is the point of "maximum financial risk" in the emotional cycle?', opts: ['During panic selling', 'At the point of euphoria', 'During depression', 'At the point of hope'], ans: 1, explain: 'Euphoria represents maximum financial risk because everyone is buying and prices are at their highest. It\'s when most people feel the most confident — right before a potential crash.' },
      { q: 'Which is the BEST approach to emotional discipline in investing?', opts: ['Check your portfolio every hour', 'Follow social media stock tips', 'Have a written investment plan and stick to it', 'Make decisions based on gut feeling'], ans: 2, explain: 'Having a written plan with clear criteria for buying, selling, and risk limits helps prevent emotional decision-making during market turbulence.' },
      { q: 'What is confirmation bias?', opts: ['Confirming trades before executing', 'Seeking information that supports your existing beliefs', 'Getting a second opinion on investments', 'Verifying stock prices are accurate'], ans: 1, explain: 'Confirmation bias is the tendency to seek out and favor information that confirms what you already believe, while ignoring contradicting evidence.' }
    ]
  },
  {
    id: 'crypto',
    icon: '₿',
    iconBg: '#f59e0b18',
    title: 'Crypto & Blockchain',
    desc: 'Bitcoin, Ethereum, DeFi, and digital asset investing',
    difficulty: 'intermediate',
    lessons: [
      {
        title: 'What is Blockchain?',
        content: `
          <p>A <span class="term">blockchain</span> is a distributed ledger — a database copied across thousands of computers worldwide. Instead of one company controlling your data, it's verified by a network of independent participants.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Core Concepts</h4>
          <ul>
            <li><span class="term">Decentralization</span> — No single point of control or failure. No bank, no CEO, no shutdown button.</li>
            <li><span class="term">Immutability</span> — Once a transaction is recorded, it cannot be altered. History is permanent.</li>
            <li><span class="term">Consensus mechanisms</span> — Rules that nodes use to agree on valid transactions:</li>
            <li><span class="term">Proof of Work (PoW)</span> — Miners solve complex puzzles to add blocks (Bitcoin). Energy-intensive but battle-tested.</li>
            <li><span class="term">Proof of Stake (PoS)</span> — Validators "stake" coins as collateral (Ethereum). More energy-efficient.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Why It Matters for Finance</h4>
          <ul>
            <li>Enables peer-to-peer transactions without banks or intermediaries</li>
            <li>Programmable money through smart contracts</li>
            <li>Transparent and auditable by anyone</li>
          </ul>
          <div class="highlight">The blockchain is the underlying technology — Bitcoin and Ethereum are applications built on top of it. The internet is a useful analogy: email and the web are apps; TCP/IP is the underlying protocol.</div>
        `
      },
      {
        title: 'Bitcoin & Major Cryptos',
        content: `
          <p><span class="term">Bitcoin (BTC)</span> was created in 2009 by the pseudonymous Satoshi Nakamoto. It is the first and largest cryptocurrency by market cap — often called "digital gold."</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Bitcoin's Key Properties</h4>
          <ul>
            <li><span class="term">Fixed supply</span> — Only 21 million BTC will ever exist. Scarcity is built in by design.</li>
            <li><span class="term">Halving</span> — Every ~4 years, the reward for mining new Bitcoin halves. Historically precedes bull runs.</li>
            <li><span class="term">Store of value</span> — Bitcoin's use case is primarily as a hedge against inflation and currency debasement.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Ethereum & Beyond</h4>
          <ul>
            <li><span class="term">Ethereum (ETH)</span> — A programmable blockchain. Powers decentralized apps, DeFi, and NFTs.</li>
            <li><span class="term">Stablecoins</span> — Cryptos pegged to the dollar (USDC, USDT). Used for trading and DeFi without price volatility.</li>
            <li><span class="term">Altcoins</span> — All cryptos other than Bitcoin. Higher risk/reward profile than BTC or ETH.</li>
            <li><span class="term">Market cap dominance</span> — Bitcoin typically represents 40-60% of total crypto market cap.</li>
          </ul>
          <div class="warn">The vast majority of altcoins (thousands exist) are speculative projects or outright scams. Stick to assets with proven network effects and real utility.</div>
        `
      },
      {
        title: 'DeFi & Web3',
        content: `
          <p><span class="term">DeFi (Decentralized Finance)</span> is a financial system built on blockchain — lending, borrowing, trading, and earning yield without banks or brokers. All governed by code (smart contracts).</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key DeFi Concepts</h4>
          <ul>
            <li><span class="term">Smart contracts</span> — Self-executing code. "If X happens, automatically do Y." Trustless and unstoppable.</li>
            <li><span class="term">DEX (Decentralized Exchange)</span> — Trade tokens directly from your wallet with no account needed (e.g., Uniswap).</li>
            <li><span class="term">Liquidity pools</span> — Users deposit token pairs to enable trading. Earn fees as a liquidity provider.</li>
            <li><span class="term">Yield farming</span> — Earning interest/rewards by putting crypto to work in DeFi protocols.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">NFTs & Tokenization</h4>
          <ul>
            <li><span class="term">NFT</span> — Non-Fungible Token. Unique digital ownership on a blockchain. Used for art, gaming, real estate.</li>
            <li><span class="term">Tokenization</span> — Real-world assets (real estate, stocks, commodities) represented as tokens on a blockchain.</li>
          </ul>
          <div class="warn">DeFi protocols can have smart contract bugs, exploits, and rug pulls. Always research thoroughly and only use audited, battle-tested protocols with real liquidity.</div>
        `
      },
      {
        title: 'Crypto Risk & Investing',
        content: `
          <p>Cryptocurrencies offer high potential returns — but they are the highest-volatility asset class available to retail investors. A 50–80% drawdown is not unusual, even for Bitcoin.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Major Risks</h4>
          <ul>
            <li><span class="term">Volatility</span> — Prices can move 10-30% in a day. Extreme emotional swings. Not suitable for money you need soon.</li>
            <li><span class="term">Regulatory risk</span> — Governments can ban, tax, or restrict crypto. Policy changes move markets.</li>
            <li><span class="term">Exchange risk</span> — Centralized exchanges can freeze funds or collapse (FTX in 2022, $8B lost).</li>
            <li><span class="term">Security risk</span> — Lost keys = lost funds. No recovery option, no customer support, no insurance.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Storage: Hot vs Cold Wallets</h4>
          <ul>
            <li><span class="term">Hot wallet</span> — Software wallet connected to the internet. Convenient but vulnerable to hacks.</li>
            <li><span class="term">Cold wallet</span> — Hardware device (Ledger, Trezor). Offline storage. Best for large holdings.</li>
          </ul>
          <div class="highlight">"Not your keys, not your coins." Keeping crypto on an exchange means the exchange technically owns it. For significant holdings, use a hardware wallet you control.</div>
          <div class="warn">Most financial advisors suggest limiting crypto to 5–10% of your portfolio at most due to its extreme volatility and speculative nature.</div>
        `
      }
    ],
    quiz: [
      { q: 'What makes Bitcoin\'s supply unique?', opts: ['It increases every year', 'Only 21 million will ever exist', 'It can be printed by governments', 'It resets every 4 years'], ans: 1, explain: 'Bitcoin\'s maximum supply is capped at 21 million coins, hard-coded into its protocol. This fixed supply is a key reason many see it as "digital gold."' },
      { q: 'What is a smart contract?', opts: ['A legal agreement signed digitally', 'Self-executing code on a blockchain that runs when conditions are met', 'A contract to buy crypto at a fixed price', 'An insurance policy for crypto investments'], ans: 1, explain: 'A smart contract is self-executing code on a blockchain. When predefined conditions are met, it automatically executes — no human or intermediary required.' },
      { q: 'What does "Proof of Stake" mean?', opts: ['Mining with powerful computers', 'Validators stake crypto as collateral to validate transactions', 'Staking a claim on a blockchain', 'Holding crypto for at least one year'], ans: 1, explain: 'Proof of Stake requires validators to lock up ("stake") cryptocurrency as collateral. If they try to cheat, they lose their stake. Ethereum uses PoS.' },
      { q: 'What happened with FTX in 2022?', opts: ['It launched a successful IPO', 'A major crypto exchange collapsed, losing billions in customer funds', 'It was acquired by a bank', 'Bitcoin reached its all-time high'], ans: 1, explain: 'FTX, once one of the world\'s largest crypto exchanges, collapsed in November 2022 due to fraud. Billions in customer funds were lost, illustrating exchange risk.' },
      { q: 'What is a "cold wallet"?', opts: ['A wallet for frozen assets in a bankruptcy', 'A hardware device that stores crypto offline', 'A wallet that earns below-average interest', 'Any wallet with zero balance'], ans: 1, explain: 'A cold wallet (hardware wallet) stores your private keys on a physical device that is never connected to the internet, making it far more secure than software wallets.' }
    ]
  },
  {
    id: 'options',
    icon: '⚡',
    iconBg: '#ef444418',
    title: 'Options Basics',
    desc: 'Calls, puts, strategies, and the Greeks explained',
    difficulty: 'advanced',
    lessons: [
      {
        title: 'Calls & Puts',
        content: `
          <p>An <span class="term">option</span> is a contract that gives the buyer the right — but not the obligation — to buy or sell an asset at a specific price before a set date. Options are powerful but require careful understanding.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Two Types</h4>
          <ul>
            <li><span class="term">Call option</span> — The right to BUY 100 shares at the strike price. You profit if the stock goes UP.</li>
            <li><span class="term">Put option</span> — The right to SELL 100 shares at the strike price. You profit if the stock goes DOWN.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Terms</h4>
          <ul>
            <li><span class="term">Strike price</span> — The price at which you can exercise the option.</li>
            <li><span class="term">Expiration date</span> — The option expires worthless if not exercised by this date.</li>
            <li><span class="term">Premium</span> — The price you pay for the option contract.</li>
            <li><span class="term">In the money (ITM)</span> — The option has intrinsic value (call: stock above strike; put: stock below strike).</li>
            <li><span class="term">Out of the money (OTM)</span> — The option has no intrinsic value yet. All time value.</li>
          </ul>
          <div class="highlight">Each standard option contract covers 100 shares. A call option at $5.00 premium actually costs $500 (5.00 × 100).</div>
          <div class="warn">Options buyers can lose 100% of their investment. Sellers face theoretically unlimited losses on naked calls. Never trade options without fully understanding the risks.</div>
        `
      },
      {
        title: 'Options Pricing',
        content: `
          <p>The price (premium) of an option is determined by several factors. Understanding what drives premium helps you make better decisions about which options to buy or sell.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Two Components of Premium</h4>
          <ul>
            <li><span class="term">Intrinsic value</span> — How much "in the money" the option already is. A call with strike $100 when stock is $110 has $10 intrinsic value.</li>
            <li><span class="term">Time value (extrinsic)</span> — The extra premium above intrinsic value. Represents the probability of becoming more profitable. Decays to zero at expiration.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Pricing Factors</h4>
          <ul>
            <li><span class="term">Implied Volatility (IV)</span> — The market's expectation of future price movement. Higher IV → higher option premiums. IV spikes around earnings.</li>
            <li><span class="term">Time to expiration</span> — More time = more premium. Options lose value as expiration approaches (time decay).</li>
            <li><span class="term">Stock price vs strike</span> — Distance between stock price and strike directly affects intrinsic value.</li>
            <li><span class="term">Interest rates</span> — Minor effect; calls slightly more expensive when rates rise.</li>
          </ul>
          <div class="warn">Buying options before earnings is risky — even if you're right about direction, "IV crush" (volatility collapsing after the announcement) can still cause losses.</div>
        `
      },
      {
        title: 'Basic Strategies',
        content: `
          <p>Options enable strategies that are impossible with stocks alone — hedging, generating income, or controlling more shares with less capital.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Beginner-Friendly Strategies</h4>
          <ul>
            <li><span class="term">Covered Call</span> — Own 100 shares, sell a call above the current price. Collect premium as income. Cap your upside. Ideal for sideways markets.</li>
            <li><span class="term">Protective Put</span> — Own shares, buy a put below the current price. Insurance against a crash. Costs premium but limits downside.</li>
            <li><span class="term">Cash-Secured Put</span> — Sell a put and set aside cash to buy the shares if assigned. A way to get paid to buy stocks at a discount you're happy with.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Directional Plays</h4>
          <ul>
            <li><span class="term">Long Call</span> — Buy a call if you're bullish. Leveraged upside, max loss = premium paid.</li>
            <li><span class="term">Long Put</span> — Buy a put if you're bearish. Profit if stock falls below strike price minus premium.</li>
          </ul>
          <div class="highlight">Selling options (covered calls, cash-secured puts) is generally lower risk than buying them, because you collect premium instead of paying it. This is how many professionals use options for income.</div>
        `
      },
      {
        title: 'The Greeks',
        content: `
          <p>The "Greeks" are measures that describe how an option's price changes in response to various factors. Understanding them is essential for managing options positions.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Main Greeks</h4>
          <ul>
            <li><span class="term">Delta (Δ)</span> — How much the option price changes per $1 move in the stock. A call with delta 0.50 gains ~$0.50 for every $1 the stock rises. Range: 0 to 1 for calls, 0 to -1 for puts.</li>
            <li><span class="term">Theta (Θ)</span> — Time decay. How much the option loses in value each day as expiration approaches. Theta works against buyers, for sellers.</li>
            <li><span class="term">Gamma (Γ)</span> — Rate of change of delta. High gamma near expiration means delta changes rapidly — big moves have big effects.</li>
            <li><span class="term">Vega (V)</span> — Sensitivity to implied volatility. A vega of 0.10 means a 1% rise in IV adds ~$0.10 to the premium. Buyers want high IV; sellers want low IV.</li>
          </ul>
          <div class="highlight">Think of delta as speed, gamma as acceleration, theta as rust (eating away value), and vega as the wind (volatility can push your position up or down regardless of direction).</div>
        `
      }
    ],
    quiz: [
      { q: 'What does a call option give you the right to do?', opts: ['Sell shares at the strike price', 'Buy shares at the strike price', 'Short-sell shares at any price', 'Receive dividends without owning shares'], ans: 1, explain: 'A call option gives the buyer the right (but not obligation) to BUY 100 shares at the strike price before expiration. You profit if the stock rises above the strike plus premium paid.' },
      { q: 'What is "time decay" in options?', opts: ['The delay in filling option orders', 'The loss of an option\'s value as expiration approaches', 'The time it takes to earn a profit', 'Interest rate changes over time'], ans: 1, explain: 'Time decay (theta) refers to the daily erosion of an option\'s extrinsic value as it approaches expiration. At expiration, only intrinsic value remains.' },
      { q: 'What is Implied Volatility (IV)?', opts: ['Historical stock price swings', 'The market\'s expectation of future price movement', 'The difference between bid and ask', 'A measure of the stock\'s trading volume'], ans: 1, explain: 'IV reflects the market\'s collective expectation of how much a stock will move. Higher IV = higher option premiums. IV typically spikes before earnings reports.' },
      { q: 'A covered call involves:', opts: ['Buying a call with no other position', 'Buying a put as insurance', 'Owning 100 shares and selling a call against them', 'Selling a call on shares you don\'t own'], ans: 2, explain: 'A covered call means you own 100 shares (the "cover") and sell a call option against them. You collect premium income but cap your upside at the strike price.' },
      { q: 'Delta measures:', opts: ['Time decay per day', 'Option price sensitivity to stock price moves', 'Sensitivity to volatility changes', 'The probability of assignment'], ans: 1, explain: 'Delta measures how much an option\'s price changes for every $1 move in the underlying stock. A delta of 0.50 means the option gains/loses $0.50 for each $1 move in the stock.' }
    ]
  },
  {
    id: 'dividends',
    icon: '💰',
    iconBg: '#10b98118',
    title: 'Dividends & Income',
    desc: 'Dividend investing, REITs, and building passive income',
    difficulty: 'beginner',
    lessons: [
      {
        title: 'Understanding Dividends',
        content: `
          <p>A <span class="term">dividend</span> is a payment made by a company to its shareholders out of profits. It's a way to share the success of the business directly with investors — real cash in your pocket.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Key Dividend Terms</h4>
          <ul>
            <li><span class="term">Dividend yield</span> — Annual dividend / stock price. A stock at $100 paying $4/year has a 4% yield.</li>
            <li><span class="term">Payout ratio</span> — Dividends paid / net income. A 40% ratio means 40% of earnings go to dividends. Sustainability check.</li>
            <li><span class="term">Ex-dividend date</span> — You must own the stock BEFORE this date to receive the next dividend.</li>
            <li><span class="term">Record date</span> — The date the company checks its records to identify shareholders who receive the dividend.</li>
            <li><span class="term">Payment date</span> — When the dividend is actually paid to shareholders.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Types of Dividends</h4>
          <ul>
            <li><span class="term">Regular dividends</span> — Paid quarterly (most US companies), monthly, or annually.</li>
            <li><span class="term">Special dividends</span> — One-time extra payments, often from a one-time profit event.</li>
            <li><span class="term">Stock dividends</span> — Additional shares instead of cash. Less common.</li>
          </ul>
          <div class="highlight">A high dividend yield can be a red flag — sometimes a yield spikes because the stock price has fallen sharply, suggesting trouble. Always check the payout ratio and earnings stability.</div>
        `
      },
      {
        title: 'Dividend Growth Investing',
        content: `
          <p><span class="term">Dividend growth investing</span> focuses on companies that consistently raise their dividends year after year. The goal is a growing income stream that compounds over time.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Dividend Growth Champions</h4>
          <ul>
            <li><span class="term">Dividend growth streaks</span> — Many blue-chip companies globally have raised dividends for 10, 20, or even 50+ consecutive years. These streaks signal financial strength and shareholder commitment.</li>
            <li><span class="term">Examples worldwide</span> — Consumer staples, utilities, and healthcare companies in any market often lead for dividend consistency (e.g., Nestlé, Unilever, Johnson &amp; Johnson, Procter &amp; Gamble, LVMH).</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">DRIP — Dividend Reinvestment Plans</h4>
          <p>A <span class="term">DRIP</span> automatically reinvests your dividends to buy more shares, accelerating compound growth:</p>
          <ul>
            <li>More shares → more dividends → even more shares</li>
            <li>Works best over long time periods (10+ years)</li>
            <li>Many brokers offer DRIP for free</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Dividend Traps to Avoid</h4>
          <ul>
            <li><span class="term">Unsustainable payout ratio</span> — Above 80% is risky; above 100% means paying more than they earn.</li>
            <li><span class="term">Declining revenue</span> — If sales are shrinking, the dividend may eventually be cut.</li>
            <li><span class="term">Heavy debt</span> — Debt servicing can compete with dividends during tough times.</li>
          </ul>
          <div class="highlight">$10,000 invested in a stock with 3% yield growing 7% per year becomes ~$76,000 in dividends alone after 20 years — that's the power of dividend growth + reinvestment.</div>
        `
      },
      {
        title: 'REITs & Income Investments',
        content: `
          <p>Beyond individual stocks, there are several asset classes specifically designed to generate income for investors.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">REITs (Real Estate Investment Trusts)</h4>
          <ul>
            <li>Companies that own income-producing real estate (offices, malls, apartments, data centers)</li>
            <li><span class="term">Required by law</span> to distribute at least 90% of taxable income as dividends</li>
            <li>Offer real estate exposure without buying property directly</li>
            <li>Types: Residential, Commercial, Industrial, Healthcare, Data Centers</li>
            <li><span class="term">Key metric</span> — Funds From Operations (FFO), not earnings. A more accurate measure of REIT profitability.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Other Income Assets</h4>
          <ul>
            <li><span class="term">Preferred stocks</span> — Hybrid between stocks and bonds. Fixed dividend, priority over common shareholders.</li>
            <li><span class="term">Bond funds</span> — ETFs holding dozens of bonds. Monthly income, lower risk than individual bonds.</li>
            <li><span class="term">Covered call ETFs</span> — ETFs that sell covered calls to generate above-average income. Available in many markets. Trade some upside growth for higher current income.</li>
          </ul>
          <div class="highlight">REITs are sensitive to interest rates — when rates rise, REIT yields become less attractive compared to bonds, often causing REIT prices to fall. This creates buying opportunities for long-term income investors.</div>
        `
      }
    ],
    quiz: [
      { q: 'What is dividend yield?', opts: ['The number of dividends per year', 'Annual dividend divided by stock price', 'Total earnings per share', 'The payout frequency'], ans: 1, explain: 'Dividend yield = Annual Dividend ÷ Stock Price. A $4 annual dividend on a $100 stock = 4% yield. It helps compare income across different stocks.' },
      { q: 'What characterises a "dividend growth champion"?', opts: ['Any stock that pays a dividend', 'A company with a long history of consecutive annual dividend increases', 'A company with a yield above 5%', 'A fund that only invests in dividend stocks'], ans: 1, explain: 'Dividend growth champions are companies that have consistently raised their dividend for many consecutive years — a sign of financial strength and a shareholder-friendly culture found across global markets.' },
      { q: 'What does DRIP stand for?', opts: ['Daily Rate Income Plan', 'Dividend Reinvestment Plan', 'Diversified Return Income Portfolio', 'Dividend Risk Income Percentage'], ans: 1, explain: 'DRIP stands for Dividend Reinvestment Plan. Instead of receiving cash, your dividends automatically buy more shares, accelerating compound growth over time.' },
      { q: 'REITs are required by law to distribute at least what percentage of taxable income?', opts: ['50%', '75%', '90%', '100%'], ans: 2, explain: 'REITs must distribute at least 90% of their taxable income as dividends to qualify for their special tax status. This is what makes them high-yield income investments.' },
      { q: 'A payout ratio above 100% means:', opts: ['Excellent dividend safety', 'The company is paying out more in dividends than it earns', 'The stock has great growth potential', 'The dividend was recently doubled'], ans: 1, explain: 'A payout ratio above 100% means the company is paying out more in dividends than it earns in net income. This is unsustainable and often signals a future dividend cut.' }
    ]
  },
  {
    id: 'retirement',
    icon: '🏦',
    iconBg: '#f59e0b18',
    title: 'Retirement Accounts',
    desc: '401(k), IRA, Roth IRA, and tax-advantaged investing',
    difficulty: 'beginner',
    lessons: [
      {
        title: 'Employer-Sponsored Retirement Plans',
        content: `
          <p>Most countries offer some form of <span class="term">employer-sponsored retirement plan</span> — a workplace savings scheme that lets you invest for retirement, often with tax advantages and employer contributions.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How They Work</h4>
          <ul>
            <li>Contributions are deducted from your salary — either pre-tax (reducing taxable income now) or post-tax (tax-free withdrawals later)</li>
            <li>Money grows in investments (funds, ETFs, bonds) until you retire</li>
            <li>Early withdrawals typically incur penalties plus taxes</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Employer Matching — Free Money</h4>
          <ul>
            <li>Many employers match a percentage of your contributions (e.g., 50% of the first 6% of salary)</li>
            <li>Always contribute at least enough to capture the <span class="term">full employer match</span> — it's an instant return before any market gains</li>
            <li>Matching rates and vesting rules vary by employer and country</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Examples Around the World</h4>
          <ul>
            <li><span class="term">401(k)</span> — United States</li>
            <li><span class="term">RRSP / TFSA</span> — Canada</li>
            <li><span class="term">Workplace pension / SIPP</span> — United Kingdom</li>
            <li><span class="term">Superannuation</span> — Australia</li>
            <li><span class="term">CPF</span> — Singapore</li>
            <li><span class="term">NPS</span> — India</li>
          </ul>
          <div class="highlight">The specific account name varies by country, but the core principle is the same everywhere: invest early, take advantage of tax benefits, and never leave free employer matching on the table.</div>
        `
      },
      {
        title: 'Tax-Deferred vs. Tax-Exempt Accounts',
        content: `
          <p>Retirement and savings accounts typically fall into two tax structures. Understanding the difference helps you choose the right account for your situation.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Tax-Deferred Accounts</h4>
          <ul>
            <li><span class="term">Tax break now</span> — Contributions are made pre-tax, reducing your taxable income today</li>
            <li>Investments grow without annual tax drag</li>
            <li>You pay income tax when you <strong>withdraw</strong> in retirement</li>
            <li>Best if you expect to be in a <strong>lower tax bracket</strong> in retirement than you are now</li>
            <li>Examples: Traditional 401(k) (US), Traditional RRSP (Canada), most workplace pensions (UK, Europe)</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Tax-Exempt Accounts</h4>
          <ul>
            <li><span class="term">Tax break later</span> — Contributions are made with after-tax income, but growth and qualified withdrawals are <strong>tax-free</strong></li>
            <li>No mandatory withdrawals in most structures</li>
            <li>Best if you expect to be in a <strong>higher tax bracket</strong> in retirement, or want flexibility</li>
            <li>Examples: Roth IRA/401(k) (US), TFSA (Canada), ISA (UK), Roth-style accounts in many other countries</li>
          </ul>
          <div class="highlight">Young investors often benefit most from tax-exempt accounts — you're likely in a lower tax bracket now, and decades of tax-free compounding on growth assets is extraordinarily powerful.</div>
        `
      },
      {
        title: 'Tax-Efficient Investing',
        content: `
          <p>The account you hold an investment in can matter as much as the investment itself. Placing assets strategically across account types — called <span class="term">asset location</span> — can meaningfully improve your after-tax returns.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">General Principles</h4>
          <ul>
            <li>Hold <span class="term">high-growth assets</span> (equities, ETFs) in tax-exempt accounts — maximises the value of tax-free compounding</li>
            <li>Hold <span class="term">income-generating assets</span> (bonds, dividend stocks, REITs) in tax-deferred accounts — shelters regular income from annual taxation</li>
            <li>Use <span class="term">taxable brokerage accounts</span> for assets with low turnover and tax-efficient returns (e.g., index ETFs)</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Capital Gains Tax Basics</h4>
          <ul>
            <li>Most countries distinguish between <span class="term">short-term</span> and <span class="term">long-term</span> capital gains — holding investments longer usually results in a lower tax rate</li>
            <li><span class="term">Tax-loss harvesting</span> — Selling positions at a loss to offset taxable gains elsewhere in your portfolio</li>
            <li>Dividend taxation rules vary widely by country and account type — check your local tax authority's guidance</li>
          </ul>
          <div class="highlight">Regardless of your country, the principle is the same: maximise your use of tax-advantaged accounts before investing in taxable accounts. Tax-sheltered compounding is one of the most powerful wealth-building tools available to any investor.</div>
        `
      },
      {
        title: 'Retirement Planning Basics',
        content: `
          <p>Building a retirement plan doesn't require complex spreadsheets — a few universal principles apply regardless of where you live.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The 4% Rule</h4>
          <p>Research suggests you can withdraw approximately <span class="term">4% of your portfolio per year</span> in retirement without running out of money over 30 years. To find your target:</p>
          <ul>
            <li>Estimate your desired annual spending in retirement</li>
            <li>Multiply by 25 — that's your rough savings target</li>
            <li>Example: if you need the equivalent of $40,000/year, aim for ~$1,000,000 in savings</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Power of Starting Early</h4>
          <ul>
            <li>Investing a fixed amount annually from age 25–35 (10 years, then stopping) can produce more wealth by retirement than investing the same amount from age 35–65 (30 years)</li>
            <li>Compound interest rewards the earliest contributions most — every decade of delay roughly halves your ending balance</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Target Savings Rate</h4>
          <ul>
            <li>Saving 15% of gross income for retirement is a widely cited starting guideline</li>
            <li>Starting later? Aim for 20–25% and consider working a few extra years</li>
          </ul>
          <div class="warn">Government or state pensions exist in most countries but are rarely sufficient on their own. Treat them as a supplement — plan to fund the majority of your retirement through your own savings and investments.</div>
        `
      }
    ],
    quiz: [
      { q: 'What is the main benefit of an employer-sponsored retirement plan?', opts: ['Guaranteed investment returns', 'Tax advantages and potential employer matching contributions', 'No restrictions on withdrawals at any age', 'Protection from market losses'], ans: 1, explain: 'Employer-sponsored plans offer tax advantages (pre-tax contributions, tax-deferred growth) and often include employer matching — effectively free money added to your retirement savings.' },
      { q: 'What is the key difference between tax-deferred and tax-exempt retirement accounts?', opts: ['Tax-deferred accounts have higher contribution limits', 'Tax-deferred: pay tax on withdrawal; tax-exempt: pay tax on contribution (withdrawals are tax-free)', 'Tax-exempt accounts are only for high earners', 'There is no practical difference'], ans: 1, explain: 'Tax-deferred accounts give you a tax break now but you pay income tax on withdrawals. Tax-exempt accounts (like ISAs in the UK or Roth accounts in the US) use after-tax contributions but qualified withdrawals are completely tax-free.' },
      { q: 'What does the "4% rule" help determine?', opts: ['The ideal portfolio equity allocation', 'How much you can safely withdraw from retirement savings each year', 'The best savings rate for young investors', 'The tax rate on retirement withdrawals'], ans: 1, explain: 'The 4% rule states that withdrawing approximately 4% of your portfolio annually provides ~30 years of income. Multiply your desired annual income by 25 to estimate your retirement savings target.' },
      { q: 'What is "asset location" in investing?', opts: ['Choosing which country to invest in', 'Strategically placing different assets in the most tax-efficient account type', 'Picking the physical location of your brokerage', 'Diversifying across geographic regions'], ans: 1, explain: 'Asset location means choosing which account type (tax-deferred, tax-exempt, or taxable) to hold each investment in to minimise your overall tax burden and maximise after-tax returns.' },
      { q: 'Why do young investors typically benefit most from tax-exempt (e.g., Roth-style) accounts?', opts: ['They have higher contribution limits when young', 'They are likely in a lower tax bracket now, and decades of tax-free compounding follow', 'Young investors pay no capital gains tax', 'Tax-exempt accounts are restricted to investors under 35'], ans: 1, explain: 'Young investors are often in lower tax brackets early in their careers, making after-tax contributions affordable. The real power is the decades of tax-free compounding growth that follows — the earlier you start, the greater the benefit.' }
    ]
  },
  {
    id: 'macro',
    icon: '🌍',
    iconBg: '#6366f118',
    title: 'Macro & Market Cycles',
    desc: 'Economic indicators, business cycles, and market timing',
    difficulty: 'intermediate',
    lessons: [
      {
        title: 'Key Economic Indicators',
        content: `
          <p>Economic indicators are statistics that signal the health of the economy. Savvy investors track them to anticipate market moves before they happen. These metrics exist in virtually every country and work the same way globally.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Leading Indicators (Predict the Future)</h4>
          <ul>
            <li><span class="term">PMI (Purchasing Managers' Index)</span> — Above 50 = expansion; below 50 = contraction. Published monthly for most major economies.</li>
            <li><span class="term">Yield curve</span> — When short-term rates exceed long-term rates (inversion), a recession often follows within 12–18 months. Observed in bond markets worldwide.</li>
            <li><span class="term">Building permits / housing starts</span> — A rise signals construction confidence and economic strength.</li>
            <li><span class="term">Consumer confidence</span> — How optimistic households feel about the economy. Tracked by statistical agencies in most countries.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Lagging Indicators (Confirm Trends)</h4>
          <ul>
            <li><span class="term">GDP (Gross Domestic Product)</span> — Total value of goods and services produced. Two consecutive quarterly declines = recession (definition used in most countries).</li>
            <li><span class="term">Unemployment rate</span> — Rises after recessions begin; falls after recovery is underway.</li>
            <li><span class="term">CPI (Consumer Price Index)</span> — Measures inflation. Most central banks globally target approximately 2% annually.</li>
          </ul>
          <div class="highlight">Markets are forward-looking. Stock prices often fall before official recession data arrives and recover before the recession officially ends. Watch leading indicators, not just headlines.</div>
        `
      },
      {
        title: 'The Business Cycle',
        content: `
          <p>The <span class="term">business cycle</span> describes the recurring pattern of economic expansion and contraction. Every sector of the stock market tends to perform differently across the cycle's four phases.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Four Phases</h4>
          <ul>
            <li><span class="term">Expansion</span> — GDP growing, unemployment falling, consumer spending rising. Cyclicals (tech, consumer discretionary) typically outperform.</li>
            <li><span class="term">Peak</span> — Growth at maximum, inflation rising, central banks raising rates. Defensive sectors (healthcare, utilities) start to look attractive.</li>
            <li><span class="term">Contraction (Recession)</span> — GDP declining, unemployment rising. Defensive stocks, bonds, and cash hold value better.</li>
            <li><span class="term">Trough</span> — Worst point; forward-looking markets begin pricing in recovery. Early cyclicals (financials, industrials) often lead the rebound.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Sector Rotation</h4>
          <p>Investors rotate capital into sectors expected to outperform in the next phase. A common pattern:</p>
          <ul>
            <li>Early recovery → <span class="term">Financials, Industrials</span></li>
            <li>Mid expansion → <span class="term">Technology, Consumer Discretionary</span></li>
            <li>Late cycle → <span class="term">Energy, Materials, Healthcare</span></li>
            <li>Recession → <span class="term">Utilities, Consumer Staples, Bonds</span></li>
          </ul>
          <div class="warn">Sector rotation sounds simple but timing it is notoriously difficult. Most retail investors are better served by broad diversification than trying to rotate with the cycle.</div>
        `
      },
      {
        title: 'Central Banks & Interest Rates',
        content: `
          <p>Every major economy has a <span class="term">central bank</span> whose decisions on interest rates are arguably the single most important force affecting financial markets in the short term.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Major Central Banks</h4>
          <ul>
            <li><span class="term">Federal Reserve (Fed)</span> — United States</li>
            <li><span class="term">European Central Bank (ECB)</span> — Eurozone</li>
            <li><span class="term">Bank of England (BoE)</span> — United Kingdom</li>
            <li><span class="term">Bank of Japan (BoJ)</span> — Japan</li>
            <li><span class="term">People's Bank of China (PBoC)</span> — China</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Common Central Bank Mandate</h4>
          <ul>
            <li><span class="term">Price stability</span> — Keep inflation near a target (typically ~2%)</li>
            <li><span class="term">Economic stability</span> — Support employment and growth</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How Rate Changes Ripple Through Markets</h4>
          <ul>
            <li><span class="term">Rate hikes</span> — Fight inflation. Borrowing gets expensive → companies invest less → growth slows → often bearish for stocks, especially high-growth names. Good for savings rates and bonds (eventually).</li>
            <li><span class="term">Rate cuts</span> — Stimulate growth. Cheaper borrowing → more investment → economic expansion → often bullish for stocks, especially rate-sensitive sectors like real estate and utilities.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">The Policy Rate</h4>
          <p>Each central bank sets a benchmark overnight rate that anchors all other interest rates in that economy — mortgages, car loans, credit cards, and bond yields.</p>
          <div class="highlight">When central banks are raising rates aggressively, it's historically risky to be heavily invested in high-growth, high-valuation stocks. When they pivot to cutting, it's often a tailwind for equities globally.</div>
        `
      },
      {
        title: 'Inflation & Your Portfolio',
        content: `
          <p><span class="term">Inflation</span> is the silent enemy of wealth. At 3% annual inflation, the purchasing power of $100,000 falls to just $74,000 in 10 years — even if the dollar amount stays the same.</p>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">How Inflation Affects Asset Classes</h4>
          <ul>
            <li><span class="term">Cash</span> — Loses value in real terms. Worst inflation hedge.</li>
            <li><span class="term">Bonds (fixed)</span> — Fixed payments worth less in real terms as inflation rises. Rising inflation crushes bond prices.</li>
            <li><span class="term">Stocks</span> — Mixed. Companies can raise prices (pricing power), but high inflation → high rates → multiple compression.</li>
            <li><span class="term">Real assets</span> — Commodities, real estate, and TIPS tend to perform well in inflationary environments.</li>
          </ul>
          <h4 style="margin-top:16px;font-weight:700;color:var(--text)">Inflation Hedges</h4>
          <ul>
            <li><span class="term">Inflation-linked bonds</span> — Government bonds whose principal or interest adjusts with inflation. Available in many countries (e.g., TIPS in the US, index-linked gilts in the UK, OATi in France).</li>
            <li><span class="term">Commodities</span> — Oil, gold, and agricultural goods often rise with inflation.</li>
            <li><span class="term">Real Estate / REITs</span> — Property values and rents typically rise with inflation.</li>
            <li><span class="term">Equities with pricing power</span> — Companies that can raise prices (consumer staples, healthcare, luxury goods) tend to protect against inflation better than those that cannot.</li>
          </ul>
          <div class="highlight">The best long-term inflation hedge is simply owning a diversified stock portfolio. Equities have historically delivered 7% real (after-inflation) returns over long periods.</div>
        `
      }
    ],
    quiz: [
      { q: 'What does an inverted yield curve typically signal?', opts: ['Strong economic growth ahead', 'A potential recession in the next 12–18 months', 'The Fed is cutting interest rates', 'Inflation is under control'], ans: 1, explain: 'An inverted yield curve (short-term rates higher than long-term rates) has preceded nearly every U.S. recession. It signals that markets expect the economy to slow and rates to fall in the future.' },
      { q: 'In which phase of the business cycle do defensive stocks typically outperform?', opts: ['Expansion', 'Peak and Contraction', 'Early recovery', 'Any phase equally'], ans: 1, explain: 'Defensive sectors like utilities, healthcare, and consumer staples tend to outperform during the Peak and Contraction (recession) phases, as demand for their products remains stable regardless of economic conditions.' },
      { q: 'What is the primary mandate of most central banks?', opts: ['Maximise GDP growth at all costs', 'Maintain price stability (low inflation) and support economic stability', 'Keep the national currency strong', 'Lower interest rates permanently'], ans: 1, explain: 'Most central banks worldwide share a core mandate of price stability — typically targeting around 2% inflation — while also supporting employment and broader economic stability.' },
      { q: 'Which asset class is considered the worst inflation hedge?', opts: ['Real Estate', 'Commodities', 'Cash', 'Inflation-linked bonds'], ans: 2, explain: 'Cash is the worst inflation hedge because its purchasing power erodes directly with inflation. Holding large amounts of cash during periods of high inflation steadily destroys real wealth.' },
      { q: 'What does GDP measure?', opts: ['The total value of a country\'s stock market', 'The total value of goods and services produced in a country', 'Government spending as a percentage of income', 'The average income per household'], ans: 1, explain: 'GDP (Gross Domestic Product) measures the total monetary value of all goods and services produced within a country in a specific time period. Two consecutive quarters of negative GDP growth define a recession.' }
    ]
  }
];

// ── Glossary terms ────────────────────────────────────────────────────────────
const GLOSSARY_TERMS = [
  { term:'Alpha', def:'Return above a benchmark index. Positive alpha means the investment outperformed.', cat:'Performance' },
  { term:'Asset Allocation', def:'The mix of different asset classes (stocks, bonds, cash) in a portfolio based on goals and risk tolerance.', cat:'Strategy' },
  { term:'Bear Market', def:'A market decline of 20% or more from recent highs. Associated with pessimism and falling prices.', cat:'Market' },
  { term:'Beta', def:'Measure of a stock\'s volatility relative to the market. Beta > 1 means more volatile than the S&P 500.', cat:'Risk' },
  { term:'Blockchain', def:'A distributed, immutable digital ledger that records transactions across a network of computers.', cat:'Crypto' },
  { term:'Bond', def:'A fixed-income security representing a loan made by an investor to a borrower (government or corporate).', cat:'Instruments' },
  { term:'Bull Market', def:'A market rise of 20% or more. Associated with optimism, rising prices, and strong economic growth.', cat:'Market' },
  { term:'Call Option', def:'A contract giving the right to buy 100 shares at a specific strike price before expiration.', cat:'Options' },
  { term:'Capital Gains', def:'Profit from selling an asset for more than its purchase price. Short-term (<1yr) taxed as income; long-term at lower rates.', cat:'Tax' },
  { term:'Compounding', def:'Earning returns on previous returns. A $1,000 investment at 10% becomes $17,449 over 30 years.', cat:'Concepts' },
  { term:'Correction', def:'A market decline of 10–19% from recent highs. Less severe than a bear market; often a normal, healthy pullback.', cat:'Market' },
  { term:'Correlation', def:'How two assets move relative to each other. Low or negative correlation is valuable for diversification.', cat:'Risk' },
  { term:'Covered Call', def:'Selling a call option against shares you own. Generates income but caps upside at the strike price.', cat:'Options' },
  { term:'Death Cross', def:'When the 50-day moving average crosses below the 200-day MA. Considered a bearish long-term signal.', cat:'Technical' },
  { term:'Delta', def:'How much an option\'s price changes per $1 move in the underlying stock. Ranges 0–1 for calls.', cat:'Options' },
  { term:'Depreciation', def:'The reduction in the value of an asset over time. Important for company financial statements.', cat:'Fundamentals' },
  { term:'Diversification', def:'Spreading investments across assets, sectors, and geographies to reduce risk.', cat:'Strategy' },
  { term:'Dividend', def:'A portion of a company\'s earnings paid to shareholders, typically quarterly.', cat:'Income' },
  { term:'Dollar-Cost Averaging', def:'Investing a fixed amount at regular intervals regardless of price, reducing the impact of volatility.', cat:'Strategy' },
  { term:'EBITDA', def:'Earnings Before Interest, Taxes, Depreciation & Amortization. A proxy for operating profitability.', cat:'Fundamentals' },
  { term:'EPS (Earnings Per Share)', def:'Net income divided by total shares outstanding. A key measure of company profitability.', cat:'Fundamentals' },
  { term:'ETF', def:'Exchange-Traded Fund. A basket of securities trading on an exchange like a single stock.', cat:'Instruments' },
  { term:'Ex-Dividend Date', def:'You must own the stock before this date to receive the upcoming dividend payment.', cat:'Income' },
  { term:'Free Cash Flow', def:'Operating cash flow minus capital expenditures. The cash available after maintaining the business.', cat:'Fundamentals' },
  { term:'Fundamental Analysis', def:'Evaluating a company\'s financial health, earnings, assets, and competitive position to determine intrinsic value.', cat:'Analysis' },
  { term:'Golden Cross', def:'When the 50-day moving average crosses above the 200-day MA. Considered a bullish long-term signal.', cat:'Technical' },
  { term:'Hedge', def:'An investment made to reduce the risk of adverse price movements in another asset.', cat:'Risk' },
  { term:'Index Fund', def:'A fund that passively tracks a market index (e.g., S&P 500), offering broad exposure at low cost.', cat:'Instruments' },
  { term:'Inflation', def:'The rate at which the general level of prices rises, eroding purchasing power over time.', cat:'Economy' },
  { term:'Interest Rate Risk', def:'The risk that rising interest rates will reduce the value of existing bonds and rate-sensitive stocks.', cat:'Risk' },
  { term:'Intrinsic Value', def:'The estimated true worth of a company based on its fundamentals, independent of market price.', cat:'Fundamentals' },
  { term:'IPO', def:'Initial Public Offering. The first time a private company offers shares to the public on a stock exchange.', cat:'Market' },
  { term:'Liquidity', def:'How easily an asset can be converted to cash without significantly affecting its price.', cat:'Market' },
  { term:'Long Position', def:'Owning an asset with the expectation that its price will rise.', cat:'Trading' },
  { term:'Margin of Safety', def:'Buying below intrinsic value to protect against errors in analysis. A core concept in value investing.', cat:'Strategy' },
  { term:'Market Capitalization', def:'Total value of a company\'s shares: share price × shares outstanding. Small-cap: <$2B; Large-cap: >$10B.', cat:'Fundamentals' },
  { term:'Moving Average', def:'The average price of a security over a set period. Used to identify trend direction and support/resistance.', cat:'Technical' },
  { term:'Mutual Fund', def:'A pooled investment vehicle managed by professionals. Unlike ETFs, trades once per day at the closing price.', cat:'Instruments' },
  { term:'P/E Ratio', def:'Price-to-Earnings ratio. How much investors pay per dollar of earnings. High P/E = growth expectations or overvaluation.', cat:'Fundamentals' },
  { term:'Portfolio', def:'The complete collection of an investor\'s holdings across all asset classes and accounts.', cat:'Concepts' },
  { term:'Put Option', def:'A contract giving the right to sell 100 shares at a specific strike price before expiration.', cat:'Options' },
  { term:'REIT', def:'Real Estate Investment Trust. A company owning income-producing real estate, required to pay 90%+ of income as dividends.', cat:'Income' },
  { term:'Rebalancing', def:'Periodically buying/selling assets to restore a portfolio to its target allocation.', cat:'Strategy' },
  { term:'Return on Equity (ROE)', def:'Net income divided by shareholders\' equity. Measures how efficiently a company uses investor funds.', cat:'Fundamentals' },
  { term:'RSI', def:'Relative Strength Index. A momentum oscillator (0–100). Above 70 = overbought; below 30 = oversold.', cat:'Technical' },
  { term:'S&P 500', def:'An index of 500 large U.S. companies. The most widely-used benchmark for U.S. stock market performance.', cat:'Market' },
  { term:'Short Selling', def:'Borrowing and selling shares you don\'t own, hoping to buy them back cheaper. Profits if the stock falls.', cat:'Trading' },
  { term:'Stablecoin', def:'A cryptocurrency pegged to a stable asset (usually the U.S. dollar). Used for DeFi and crypto trading.', cat:'Crypto' },
  { term:'Stop-Loss', def:'An order to sell automatically if a price falls to a set level, limiting losses.', cat:'Risk' },
  { term:'Technical Analysis', def:'Using price charts, patterns, and indicators to forecast future price direction.', cat:'Analysis' },
  { term:'Theta', def:'The daily rate of time decay in an option\'s price. Works against buyers; benefits sellers.', cat:'Options' },
  { term:'Trailing Stop', def:'A stop-loss that moves up with the stock price, locking in gains while limiting downside.', cat:'Risk' },
  { term:'Value Investing', def:'Buying undervalued stocks trading below their intrinsic value, expecting the market to eventually correct the price.', cat:'Strategy' },
  { term:'Vega', def:'An option\'s sensitivity to changes in implied volatility. Higher vega = more impact from IV changes.', cat:'Options' },
  { term:'Volatility', def:'The degree of variation in an asset\'s price. High volatility = larger swings. Measured by standard deviation or VIX.', cat:'Risk' },
  { term:'Volume', def:'The number of shares traded in a period. High volume confirms price moves; low volume suggests weak conviction.', cat:'Technical' },
  { term:'Yield Curve', def:'A graph of bond yields across different maturities. An inverted yield curve (short rates > long rates) often predicts recessions.', cat:'Economy' },
];

// ── Badges ────────────────────────────────────────────────────────────────────
const BADGES = [
  { id:'first_lesson',  icon:'🌱', name:'First Steps',       desc:'Complete your first lesson' },
  { id:'five_lessons',  icon:'📖', name:'Quick Learner',     desc:'Complete 5 lessons' },
  { id:'all_lessons',   icon:'🎓', name:'Scholar',           desc:'Complete every lesson' },
  { id:'first_quiz',    icon:'✏️', name:'Quiz Taker',        desc:'Complete your first quiz' },
  { id:'perfect_quiz',  icon:'💯', name:'Perfect Score',     desc:'Score 100% on any quiz' },
  { id:'all_quizzes',   icon:'🏆', name:'Quiz Champion',     desc:'Pass all topic quizzes' },
  { id:'streak_3',      icon:'🔥', name:'On a Roll',         desc:'3-day learning streak' },
  { id:'streak_7',      icon:'⚡', name:'Unstoppable',       desc:'7-day learning streak' },
  { id:'crypto_done',   icon:'₿',  name:'Crypto Curious',   desc:'Complete the Crypto module' },
  { id:'options_done',  icon:'📊', name:'Options Aware',     desc:'Complete the Options module' },
  { id:'full_course',   icon:'🌟', name:'Master Investor',   desc:'Complete all 11 topics' },
];

function getEarnedBadgeIds() {
  const s = learnState;
  const earned = new Set();
  let totalLessons = 0, completedLessons = 0, passedQuizzes = 0;
  LEARN_TOPICS.forEach(t => {
    totalLessons += t.lessons.length;
    const read = (s[t.id]?.lessonsRead || []).length;
    completedLessons += read;
    if (s[t.id]?.quizDone) {
      passedQuizzes++;
      if (s[t.id].quizScore === 100) earned.add('perfect_quiz');
    }
  });
  if (completedLessons >= 1) earned.add('first_lesson');
  if (completedLessons >= 5) earned.add('five_lessons');
  if (completedLessons >= totalLessons) earned.add('all_lessons');
  if (passedQuizzes >= 1) earned.add('first_quiz');
  if (passedQuizzes >= LEARN_TOPICS.length) earned.add('all_quizzes');
  if ((s._streak || 0) >= 3) earned.add('streak_3');
  if ((s._streak || 0) >= 7) earned.add('streak_7');
  if (s.crypto?.quizDone) earned.add('crypto_done');
  if (s.options?.quizDone) earned.add('options_done');
  if (passedQuizzes >= LEARN_TOPICS.length && completedLessons >= totalLessons) earned.add('full_course');
  return earned;
}

// Learning Hub state — persisted to localStorage
let learnState = JSON.parse(localStorage.getItem('ie_learn') || '{}');
function saveLearnState() {
  localStorage.setItem('ie_learn', JSON.stringify(learnState));
  saveLearnProgressToDB();
}

// ── XP & Levels ───────────────────────────────────────────────────────────────
const XP_LEVELS = [
  { name: 'Novice',    min: 0    },
  { name: 'Beginner',  min: 50   },
  { name: 'Learner',   min: 150  },
  { name: 'Investor',  min: 350  },
  { name: 'Analyst',   min: 700  },
  { name: 'Expert',    min: 1200 },
  { name: 'Master',    min: 2000 },
];

function getLevel(xp) {
  let level = XP_LEVELS[0];
  for (const l of XP_LEVELS) { if (xp >= l.min) level = l; else break; }
  const idx = XP_LEVELS.indexOf(level);
  const next = XP_LEVELS[idx + 1];
  const pct = next ? Math.round(((xp - level.min) / (next.min - level.min)) * 100) : 100;
  return { ...level, idx, next, xp, pct };
}

function awardXP(amount) {
  const before = learnState._xp || 0;
  learnState._xp = before + amount;
  saveLearnState();
  // Show XP gain toast briefly if on learn tab
  const el = document.getElementById('tab-learn');
  if (el && el.closest('.tab-content')) {
    const chip = document.createElement('div');
    chip.style.cssText = 'position:fixed;bottom:140px;right:16px;z-index:9998;background:linear-gradient(90deg,#10b981,#3b82f6);color:#fff;font-size:12px;font-weight:800;padding:6px 14px;border-radius:20px;animation:toastIn 0.3s ease,toastOut 0.3s 1.5s ease forwards;pointer-events:none';
    chip.textContent = '+' + amount + ' XP';
    document.body.appendChild(chip);
    setTimeout(() => chip.remove(), 2000);
  }
}

// ── Badge Toast Notifications ─────────────────────────────────────────────────
let _toastQueue = [];
let _toastShowing = false;

function checkNewBadges(prevIds) {
  const nowIds = getEarnedBadgeIds();
  const newlyEarned = BADGES.filter(b => nowIds.has(b.id) && !prevIds.has(b.id));
  newlyEarned.forEach(b => _toastQueue.push(b));
  if (!_toastShowing) _showNextToast();
}

function _showNextToast() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const badge = _toastQueue.shift();
  const el = document.createElement('div');
  el.className = 'badge-toast';
  el.innerHTML = `
    <div class="badge-toast-icon">${badge.icon}</div>
    <div>
      <div class="badge-toast-label">Achievement Unlocked</div>
      <div class="badge-toast-name">${escHtml(badge.name)}</div>
      <div class="badge-toast-desc">${escHtml(badge.desc)}</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => { el.remove(); _showNextToast(); }, 350);
  }, 3500);
}

// ── Daily Challenge ───────────────────────────────────────────────────────────
function getDailyChallengeData() {
  const today = new Date().toDateString();
  // Pick question deterministically by date
  const seed = new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate();
  const allQs = [];
  LEARN_TOPICS.forEach(t => t.quiz.forEach((q, qi) => allQs.push({ topicId: t.id, topicTitle: t.title, qi, q })));
  const item = allQs[seed % allQs.length];
  const state = learnState._daily || {};
  const answered = state.date === today;
  return { today, item, answered, wasCorrect: state.correct };
}

function renderDailyChallengeCard() {
  const { today, item, answered, wasCorrect } = getDailyChallengeData();
  const q = item.q;
  if (answered) {
    return `<div class="daily-card">
      <div class="daily-card-label">Daily Challenge</div>
      <h3>${escHtml(q.q)}</h3>
      <div class="daily-done-badge">${wasCorrect ? '✓ Correct! +25 XP' : '✗ Incorrect — try again tomorrow'}</div>
      <p style="font-size:11px;color:#ffffff80;margin-top:10px">${escHtml(q.explain)}</p>
    </div>`;
  }
  return `<div class="daily-card">
    <div class="daily-card-label">Daily Challenge</div>
    <h3>${escHtml(q.q)}</h3>
    <div class="daily-opts">
      ${q.opts.map((opt, i) => `<button class="daily-opt" onclick="answerDailyChallenge(${i})" id="daily-opt-${i}">${escHtml(opt)}</button>`).join('')}
    </div>
  </div>`;
}

function answerDailyChallenge(choice) {
  const { today, item } = getDailyChallengeData();
  const q = item.q;
  const correct = choice === q.ans;
  // Update state
  learnState._daily = { date: today, correct };
  saveLearnState();
  // Highlight options
  q.opts.forEach((_, i) => {
    const btn = document.getElementById('daily-opt-' + i);
    if (!btn) return;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === choice && !correct) btn.classList.add('wrong');
    else btn.classList.add('dimmed');
  });
  // Award XP if correct
  if (correct) {
    awardXP(25);
  }
  // Re-render after short delay
  setTimeout(() => renderLearn(), 1800);
}

// ── Learning Path ─────────────────────────────────────────────────────────────
const LEARN_PATH_ORDER = ['basics','strategies','analysis','technical','risk','psychology','dividends','crypto','options'];

function isTopicUnlocked(topicId) {
  const idx = LEARN_PATH_ORDER.indexOf(topicId);
  if (idx <= 0) return true; // First topic always unlocked
  const prev = LEARN_PATH_ORDER[idx - 1];
  return !!(learnState[prev]?.quizDone);
}

function renderLearningPath() {
  const el = document.getElementById('tab-learn');
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="renderLearn()">← Back to Topics</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <span style="font-size:28px">🗺️</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">Learning Path</h2>
          <p style="font-size:12px;color:var(--faint)">Complete topics in order to unlock the next level</p>
        </div>
      </div>
      <div class="learn-path">
        ${LEARN_PATH_ORDER.map((topicId, idx) => {
          const topic = LEARN_TOPICS.find(t => t.id === topicId);
          if (!topic) return '';
          const p = getTopicProgress(topicId);
          const unlocked = isTopicUnlocked(topicId);
          const done = p.pct === 100;
          const nodeClass = done ? 'done' : (unlocked ? 'active' : 'locked');
          const infoClass = unlocked ? '' : 'locked-info';
          const statusHtml = done
            ? '<span class="path-step-status status-done">✓ Completed</span>'
            : unlocked
              ? `<span class="path-step-status status-active">${p.pct}% — In Progress</span>`
              : '<span class="path-step-status status-locked">🔒 Locked</span>';
          const clickAction = unlocked ? `onclick="openTopic('${topicId}')"` : '';
          return `
            <div class="path-step" style="margin-bottom:${idx < LEARN_PATH_ORDER.length-1?'12':'0'}px">
              <div class="path-node ${nodeClass}" ${unlocked ? `onclick="openTopic('${topicId}')"` : ''}>${done ? '✓' : topic.icon}</div>
              <div class="path-info ${infoClass}" ${clickAction}>
                <div class="path-step-title">${idx + 1}. ${escHtml(topic.title)}</div>
                <div class="path-step-sub">${topic.lessons.length} lessons · <span class="learn-difficulty diff-${topic.difficulty}" style="display:inline;padding:1px 6px">${topic.difficulty}</span></div>
                ${statusHtml}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
  el.parentElement.scrollTop = 0;
}

function updateStreak() {
  const today = new Date().toDateString();
  if (learnState._streakDate === today) return;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const prevStreak = learnState._streak || 0;
  learnState._streak = (learnState._streakDate === yesterday.toDateString()) ? prevStreak + 1 : 1;
  learnState._streakDate = today;
  saveLearnState();
  // Bonus XP for streak milestones
  if (learnState._streak === 3) { const pb = new Set(getEarnedBadgeIds()); awardXP(25); checkNewBadges(pb); }
  if (learnState._streak === 7) { const pb = new Set(getEarnedBadgeIds()); awardXP(50); checkNewBadges(pb); }
}

function getTopicProgress(topicId) {
  const data = learnState[topicId] || {};
  const topic = LEARN_TOPICS.find(t => t.id === topicId);
  if (!topic) return { lessonsRead: 0, total: topic?.lessons.length || 0, quizScore: null, quizDone: false };
  const lessonsRead = (data.lessonsRead || []).length;
  return {
    lessonsRead,
    total: topic.lessons.length,
    quizScore: data.quizScore ?? null,
    quizDone: data.quizDone || false,
    pct: Math.round(((lessonsRead + (data.quizDone ? 1 : 0)) / (topic.lessons.length + 1)) * 100)
  };
}

function markLessonRead(topicId, lessonIdx) {
  if (!learnState[topicId]) learnState[topicId] = {};
  if (!learnState[topicId].lessonsRead) learnState[topicId].lessonsRead = [];
  if (!learnState[topicId].lessonsRead.includes(lessonIdx)) {
    learnState[topicId].lessonsRead.push(lessonIdx);
    saveLearnState();
    const prevBadges = new Set(getEarnedBadgeIds());
    awardXP(10);
    checkNewBadges(prevBadges);
  }
  updateStreak();
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════════════════════

// In-memory cache so switching tabs doesn't re-fetch
let _calCache = null;
let _calCacheTs = 0;
let _calView = 'list'; // 'list' | 'week' | 'month'

function renderCalendar() {
  const el = document.getElementById('tab-calendar');

  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const BADGE = { earnings: 'cal-badge-earnings', fed: 'cal-badge-fed', macro: 'cal-badge-macro', holiday: 'cal-badge-holiday' };
  const LABEL = { earnings: 'Earnings', fed: 'Fed', macro: 'Economic', holiday: 'Market Event' };
  const TYPE_ICON = {
    earnings: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
    fed:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    macro:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
    holiday:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  };
  const filterTypes = ['all', 'earnings', 'fed', 'macro'];

  // ── Grouping helpers ───────────────────────────────────────────────────────
  const todayD    = new Date(); todayD.setHours(0,0,0,0);
  const tomorrowD = new Date(todayD); tomorrowD.setDate(todayD.getDate() + 1);
  const weekEndD  = new Date(todayD); weekEndD.setDate(todayD.getDate() + 7);
  const nextWkEnd = new Date(todayD); nextWkEnd.setDate(todayD.getDate() + 14);

  function groupLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00'); d.setHours(0,0,0,0);
    if (+d === +todayD)    return 'Today';
    if (+d === +tomorrowD) return 'Tomorrow';
    if (d < weekEndD)      return 'This Week';
    if (d < nextWkEnd)     return 'Next Week';
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  // ── Shared header (view toggle + filter pills) ────────────────────────────
  function buildHeader(isLive, filter, view) {
    const statusBadge = isLive
      ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#10b981;background:#10b98115;padding:3px 10px;border-radius:20px">
           <span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block"></span>Live data</span>`
      : `<span style="font-size:11px;color:var(--muted);background:var(--border);padding:3px 10px;border-radius:20px">Demo data</span>`;

    const viewBtns = [
      { id: 'list',  label: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg> List` },
      { id: 'week',  label: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="21"/><line x1="16" y1="4" x2="16" y2="21"/></svg> Week` },
      { id: 'month', label: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="9"/><line x1="16" y1="4" x2="16" y2="9"/></svg> Month` },
    ].map(v => `<button class="cal-view-btn${v.id === view ? ' active' : ''}" onclick="renderCalendar._build('${filter}','${v.id}')">${v.label}</button>`).join('');

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <h2 style="font-size:22px;font-weight:800;color:var(--text)">Economic Calendar</h2>
            ${statusBadge}
          </div>
          <p style="font-size:13px;color:var(--muted)">Earnings dates from Yahoo Finance · Fed &amp; macro events</p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <div class="cal-view-toggle">${viewBtns}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${filterTypes.map(f => `
              <button onclick="renderCalendar._build('${f}','${view}')"
                style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;
                       background:${f === filter ? (f === 'all' ? '#10b981' : f === 'earnings' ? '#3b82f6' : f === 'fed' ? '#8b5cf6' : '#f59e0b') : 'var(--border)'};
                       color:${f === filter ? '#fff' : 'var(--muted)'};border:none;transition:all .15s">
                ${f === 'all' ? 'All Events' : LABEL[f]}
              </button>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // ── List view ──────────────────────────────────────────────────────────────
  function buildListView(events, isLive, filter) {
    const visible = filter === 'all' ? events : events.filter(e => e.type === filter);
    const grps = {};
    visible.forEach(ev => {
      const lbl = groupLabel(ev.date);
      (grps[lbl] = grps[lbl] || []).push(ev);
    });
    const groupOrder  = ['Today', 'Tomorrow', 'This Week', 'Next Week'];
    const extraKeys   = Object.keys(grps).filter(k => !groupOrder.includes(k)).sort();
    const orderedKeys = [...groupOrder.filter(k => grps[k]), ...extraKeys];

    return `
      <div style="max-width:780px">
        ${buildHeader(isLive, filter, 'list')}
        ${orderedKeys.map(label => `
          <div class="cal-group-label">${label}</div>
          ${grps[label].map(ev => {
            const d = new Date(ev.date + 'T12:00:00');
            const tChips = (ev.tickers || []).map(t => {
              const idx = MARKETS.findIndex(x => x.ticker === t);
              return `<span class="cal-ticker-chip" onclick="switchTab('markets');setTimeout(()=>openStockDetail(${idx}),80)">
                ${TYPE_ICON.earnings}${t}</span>`;
            }).join(' ');
            return `<div class="cal-event">
              <div class="cal-date-col">
                <div class="cal-day-num">${d.getDate()}</div>
                <div class="cal-day-name">${DAYS[d.getDay()]}</div>
              </div>
              <div class="cal-body">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                  <span class="cal-badge ${BADGE[ev.type]}">${TYPE_ICON[ev.type]} ${LABEL[ev.type]}</span>
                  <span class="cal-event-title">${ev.title}</span>
                </div>
                <p class="cal-event-desc">${ev.desc}</p>
                ${tChips ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${tChips}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        `).join('')}
        ${orderedKeys.length === 0 ? '<p style="color:var(--muted);padding:40px 0;text-align:center">No events match this filter.</p>' : ''}
      </div>`;
  }

  // ── Week grid view (Mon–Fri of the current week) ───────────────────────────
  function buildWeekView(events, isLive, filter) {
    const visible = filter === 'all' ? events : events.filter(e => e.type === filter);
    // Compute Mon–Fri of the week containing today
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay(); // 0=Sun
    const monday = new Date(today); monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const weekDays = Array.from({length: 7}, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
    });
    const byDate = {};
    visible.forEach(ev => { (byDate[ev.date] = byDate[ev.date] || []).push(ev); });

    const cols = weekDays.map(d => {
      const iso = d.toISOString().slice(0,10);
      const isToday = +d === +today;
      const dayEvts = byDate[iso] || [];
      const evHtml = dayEvts.map(ev => `
        <div class="cal-week-event cal-week-event-${ev.type}" title="${ev.title}">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ev.title}</div>
        </div>`).join('') || `<div style="font-size:10px;color:var(--muted);text-align:center;padding-top:8px">—</div>`;
      return `<div class="cal-week-col">
        <div class="cal-week-day-header${isToday ? ' today' : ''}">
          <div>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</div>
          <div style="font-size:16px;font-weight:800;color:${isToday ? 'var(--green)' : 'var(--text)'}">${d.getDate()}</div>
        </div>
        ${evHtml}
      </div>`;
    }).join('');

    return `
      <div style="max-width:1000px">
        ${buildHeader(isLive, filter, 'week')}
        <div class="cal-week-grid" style="grid-template-columns:repeat(7,1fr)">${cols}</div>
      </div>`;
  }

  // ── Month grid view ────────────────────────────────────────────────────────
  function buildMonthView(events, isLive, filter) {
    const visible = filter === 'all' ? events : events.filter(e => e.type === filter);
    const today = new Date(); today.setHours(0,0,0,0);
    const year  = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    // Start grid on Monday
    const startDow = firstDay.getDay();
    const startOffset = startDow === 0 ? 6 : startDow - 1;
    const gridStart = new Date(firstDay); gridStart.setDate(firstDay.getDate() - startOffset);
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

    const byDate = {};
    visible.forEach(ev => { (byDate[ev.date] = byDate[ev.date] || []).push(ev); });

    const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const dayHeaders = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
      .map(d => `<div class="cal-month-day-header">${d}</div>`).join('');

    const cells = Array.from({length: totalCells}, (_, i) => {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const iso = d.toISOString().slice(0,10);
      const isCurrentMonth = d.getMonth() === month;
      const isToday = +d === +today;
      const dayEvts = byDate[iso] || [];
      const maxShow = 3;
      const evHtml = dayEvts.slice(0, maxShow).map(ev =>
        `<div class="cal-month-event cal-month-event-${ev.type}" title="${ev.title}">${ev.title}</div>`
      ).join('');
      const overflow = dayEvts.length > maxShow
        ? `<div style="font-size:9px;color:var(--muted);font-weight:700">+${dayEvts.length - maxShow} more</div>` : '';
      return `<div class="cal-month-cell${!isCurrentMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">
        <div class="cal-month-cell-day" style="${isToday ? 'color:var(--green)' : ''}">${d.getDate()}</div>
        ${evHtml}${overflow}
      </div>`;
    }).join('');

    return `
      <div style="max-width:900px">
        ${buildHeader(isLive, filter, 'month')}
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">${monthName}</div>
        <div class="cal-month-grid">${dayHeaders}${cells}</div>
      </div>`;
  }

  // ── Master render dispatcher ───────────────────────────────────────────────
  function buildUI(events, isLive, filter, view) {
    el._calFilter = filter;
    _calView = view;
    if (view === 'week')  { el.innerHTML = buildWeekView(events, isLive, filter);  return; }
    if (view === 'month') { el.innerHTML = buildMonthView(events, isLive, filter); return; }
    el.innerHTML = buildListView(events, isLive, filter);
  }

  // ── Convert API earnings to event objects ──────────────────────────────────
  function earningsToEvents(earnings) {
    return earnings.map(e => {
      const parts = [];
      if (e.epsEst != null) parts.push(`EPS est. $${e.epsEst}`);
      if (e.epsLow != null && e.epsHigh != null) parts.push(`range $${e.epsLow}–$${e.epsHigh}`);
      if (e.revEst)         parts.push(`Revenue est. ${e.revEst}`);
      return {
        date:    e.date,
        title:   `${e.name} Earnings`,
        type:    'earnings',
        desc:    parts.length ? parts.join(' · ') : 'Consensus estimates not yet available.',
        tickers: [e.ticker],
      };
    });
  }

  // ── Active filter/view (persisted while tab stays open) ───────────────────
  renderCalendar._build = (filter, view) => {
    if (_calCache) buildUI(_calCache.events, _calCache.live, filter, view || _calView || 'list');
  };

  // Use memory cache if fresh (< 6 h)
  if (_calCache && (Date.now() - _calCacheTs) < 21_600_000) {
    buildUI(_calCache.events, _calCache.live, el._calFilter || 'all', _calView || 'list');
    return;
  }

  // Show loading skeleton
  el.innerHTML = `
    <div style="max-width:780px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div>
          <h2 style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:4px">Economic Calendar</h2>
          <p style="font-size:13px;color:var(--muted)">Loading live data…</p>
        </div>
      </div>
      ${Array(6).fill(0).map(() => `
        <div class="cal-event">
          <div class="cal-date-col">
            <div style="width:28px;height:22px;background:var(--border);border-radius:4px;margin-bottom:4px"></div>
            <div style="width:28px;height:10px;background:var(--border);border-radius:3px"></div>
          </div>
          <div class="cal-body" style="flex:1">
            <div style="width:60px;height:18px;background:var(--border);border-radius:10px;display:inline-block;margin-right:8px"></div>
            <div style="width:200px;height:14px;background:var(--border);border-radius:4px;display:inline-block"></div>
            <div style="width:280px;height:12px;background:var(--border);border-radius:3px;margin-top:6px"></div>
          </div>
        </div>`).join('')}
    </div>`;

  // Fetch from backend
  const from = new Date().toISOString().slice(0, 10);
  const to   = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  fetch(`prices.php?action=calendar&from=${from}&to=${to}`)
    .then(r => r.json())
    .then(data => {
      if (!data.success) throw new Error(data.error || 'API error');
      const events = [
        ...earningsToEvents(data.earnings || []),
        ...(data.economic || []),
      ].sort((a, b) => a.date.localeCompare(b.date));
      _calCache   = { events, live: true };
      _calCacheTs = Date.now();
      buildUI(events, true, el._calFilter || 'all', _calView || 'list');
    })
    .catch(() => {
      // Fallback: show a notice but still render (empty) so the tab isn't broken
      _calCache   = { events: [], live: false };
      _calCacheTs = Date.now();
      buildUI([], false, 'all', _calView || 'list');
    });
}

function renderLearn() {
  const el = document.getElementById('tab-learn');
  // Calculate overall stats
  let totalLessons = 0, completedLessons = 0, totalQuizzes = LEARN_TOPICS.length, completedQuizzes = 0, totalScore = 0;
  LEARN_TOPICS.forEach(t => {
    totalLessons += t.lessons.length;
    const p = getTopicProgress(t.id);
    completedLessons += p.lessonsRead;
    if (p.quizDone) { completedQuizzes++; totalScore += p.quizScore; }
  });
  const overallPct = Math.round(((completedLessons + completedQuizzes) / (totalLessons + totalQuizzes)) * 100);

  const streak = learnState._streak || 0;
  const earnedBadges = getEarnedBadgeIds();

  const xp = learnState._xp || 0;
  const lvl = getLevel(xp);

  el.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div><h2>Learning Hub</h2><p>Master investing concepts at your own pace</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="learn-nav-btn secondary" style="padding:8px 14px;font-size:12px" onclick="renderLearningPath()">🗺️ Path</button>
        <button class="learn-nav-btn secondary" style="padding:8px 14px;font-size:12px" onclick="renderGlossary()">📖 Glossary</button>
        <button class="learn-nav-btn secondary" style="padding:8px 14px;font-size:12px" onclick="renderBadgesPage()">🏅 Badges</button>
      </div>
    </div>

    <!-- XP Level Bar -->
    <div style="background:var(--card);border-radius:var(--radius-sm);padding:14px 18px;box-shadow:var(--shadow);margin-bottom:14px;display:flex;align-items:center;gap:14px">
      <span style="font-size:28px">⚡</span>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span class="xp-level-chip">${escHtml(lvl.name)}</span>
          <span style="font-size:11px;color:var(--faint);font-family:var(--mono)">${xp} XP${lvl.next ? ' / ' + lvl.next.min + ' XP' : ' — MAX'}</span>
        </div>
        <div class="xp-bar-wrap"><div class="xp-bar-fill" style="width:${lvl.pct}%"></div></div>
        ${lvl.next ? `<div style="font-size:10px;color:var(--faint);margin-top:3px">${lvl.next.min - xp} XP to <strong>${escHtml(lvl.next.name)}</strong></div>` : '<div style="font-size:10px;color:var(--green);margin-top:3px">Max level reached!</div>'}
      </div>
    </div>

    <!-- Daily Challenge -->
    ${renderDailyChallengeCard()}

    <div class="learn-stats">
      <div class="learn-stat-card">
        <div class="learn-stat-num" style="color:var(--green)">${overallPct}%</div>
        <div class="learn-stat-label">Overall Progress</div>
      </div>
      <div class="learn-stat-card">
        <div class="learn-stat-num">${completedLessons}<span style="font-size:14px;color:var(--faint)">/${totalLessons}</span></div>
        <div class="learn-stat-label">Lessons Completed</div>
      </div>
      <div class="learn-stat-card">
        <div class="learn-stat-num">${completedQuizzes}<span style="font-size:14px;color:var(--faint)">/${totalQuizzes}</span></div>
        <div class="learn-stat-label">Quizzes Passed</div>
      </div>
      <div class="learn-stat-card">
        <div class="learn-stat-num">${completedQuizzes > 0 ? Math.round(totalScore / completedQuizzes) + '%' : '—'}</div>
        <div class="learn-stat-label">Avg Quiz Score</div>
      </div>
      <div class="learn-stat-card">
        <div class="learn-stat-num"><span class="streak-flame">${streak > 0 ? '🔥' : '💤'}</span>${streak}</div>
        <div class="learn-stat-label">Day Streak</div>
      </div>
      <div class="learn-stat-card">
        <div class="learn-stat-num">${earnedBadges.size}<span style="font-size:14px;color:var(--faint)">/${BADGES.length}</span></div>
        <div class="learn-stat-label">Badges Earned</div>
      </div>
    </div>
    <div class="learn-grid">
      ${LEARN_TOPICS.map(t => {
        const p = getTopicProgress(t.id);
        return `
          <div class="learn-topic-card ${p.pct === 100 ? 'completed-card' : ''}" onclick="openTopic('${t.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div class="learn-topic-icon" style="background:${t.iconBg}">${t.icon}</div>
              ${p.pct === 100 ? '<span style="font-size:16px">✅</span>' : ''}
            </div>
            <h3 style="margin-top:10px">${t.title}</h3>
            <p>${t.desc}</p>
            <div class="learn-topic-meta">
              <span class="learn-difficulty diff-${t.difficulty}">${t.difficulty}</span>
              <span class="learn-lesson-count">${t.lessons.length} lessons + quiz</span>
            </div>
            <div class="learn-progress-bar"><div class="learn-progress-fill" style="width:${p.pct}%"></div></div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="learn-nav-btn primary" style="flex:1;padding:7px 0;font-size:11px" onclick="event.stopPropagation();openTopic('${t.id}')">
                ${p.lessonsRead === 0 ? 'Start' : p.pct === 100 ? 'Review' : 'Continue'} →
              </button>
              <button class="learn-nav-btn secondary" style="padding:7px 10px;font-size:11px" onclick="event.stopPropagation();renderFlashcards('${t.id}')" title="Flashcards">🃏</button>
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function openTopic(topicId, lessonIdx = 0) {
  const topic = LEARN_TOPICS.find(t => t.id === topicId);
  if (!topic) return;
  markLessonRead(topicId, lessonIdx);
  const lesson = topic.lessons[lessonIdx];
  const p = getTopicProgress(topicId);
  const isRead = (learnState[topicId]?.lessonsRead || []).includes(lessonIdx);

  const el = document.getElementById('tab-learn');
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="renderLearn()">← Back to Topics</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <span style="font-size:28px">${topic.icon}</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">${topic.title}</h2>
          <p style="font-size:12px;color:var(--faint)">${p.lessonsRead} of ${p.total} lessons completed</p>
        </div>
      </div>
      <div class="learn-progress-bar" style="margin:12px 0 20px"><div class="learn-progress-fill" style="width:${p.pct}%"></div></div>

      <!-- Lesson navigation -->
      <div class="filter-row" style="margin-bottom:16px">
        ${topic.lessons.map((l, i) => {
          const read = (learnState[topicId]?.lessonsRead || []).includes(i);
          return `<button class="filter-btn ${i === lessonIdx ? 'active' : ''}" onclick="openTopic('${topicId}',${i})" style="position:relative">
            ${read ? '✓ ' : ''}${i + 1}. ${l.title}
          </button>`;
        }).join('')}
        <button class="filter-btn ${false ? 'active' : ''}" onclick="startQuiz('${topicId}')" style="background:${p.quizDone ? 'var(--green-bg)' : '#f59e0b18'};color:${p.quizDone ? 'var(--green)' : 'var(--amber)'};font-weight:700">
          ${p.quizDone ? '✓ Quiz ' + p.quizScore + '%' : '📝 Take Quiz'}
        </button>
      </div>

      <!-- Lesson content -->
      <div class="learn-section">
        <h3>${lesson.title}</h3>
        ${lesson.content}
      </div>

      <!-- Navigation buttons -->
      <div class="learn-nav-btns">
        ${lessonIdx > 0 ? `<button class="learn-nav-btn secondary" onclick="openTopic('${topicId}',${lessonIdx - 1})">← Previous</button>` : ''}
        ${lessonIdx < topic.lessons.length - 1
          ? `<button class="learn-nav-btn primary" onclick="openTopic('${topicId}',${lessonIdx + 1})">Next Lesson →</button>`
          : `<button class="learn-nav-btn primary" onclick="startQuiz('${topicId}')">Take the Quiz →</button>`
        }
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
}

let quizState = {};
function startQuiz(topicId) {
  const topic = LEARN_TOPICS.find(t => t.id === topicId);
  if (!topic) return;
  quizState = { topicId, current: 0, answers: [], showingFeedback: false };
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const topic = LEARN_TOPICS.find(t => t.id === quizState.topicId);
  const el = document.getElementById('tab-learn');
  const q = topic.quiz[quizState.current];
  const total = topic.quiz.length;
  const idx = quizState.current;

  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="openTopic('${quizState.topicId}')">← Back to ${topic.title}</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:28px">📝</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">${topic.title} Quiz</h2>
          <p style="font-size:12px;color:var(--faint)">Test your knowledge</p>
        </div>
      </div>
      <div class="learn-progress-bar" style="margin-bottom:20px">
        <div class="learn-progress-fill" style="width:${Math.round((idx / total) * 100)}%"></div>
      </div>
      <div class="quiz-container">
        <div class="quiz-header">
          <span class="quiz-progress">Question ${idx + 1} of ${total}</span>
          <span style="font-size:12px;color:var(--faint)">${topic.difficulty}</span>
        </div>
        <div class="quiz-question">${q.q}</div>
        <div class="quiz-options">
          ${q.opts.map((opt, i) => `
            <button class="quiz-option" onclick="answerQuiz(${i})" id="quiz-opt-${i}">${opt}</button>
          `).join('')}
        </div>
        <div id="quiz-feedback"></div>
        <div id="quiz-next" style="margin-top:16px;display:none">
          <button class="learn-nav-btn primary" onclick="${idx < total - 1 ? 'nextQuizQuestion()' : 'finishQuiz()'}">${idx < total - 1 ? 'Next Question →' : 'See Results →'}</button>
        </div>
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
}

function answerQuiz(choice) {
  if (quizState.showingFeedback) return;
  quizState.showingFeedback = true;
  updateStreak();
  const topic = LEARN_TOPICS.find(t => t.id === quizState.topicId);
  const q = topic.quiz[quizState.current];
  const correct = choice === q.ans;
  quizState.answers.push(correct);

  // Highlight selected and correct
  q.opts.forEach((_, i) => {
    const btn = document.getElementById('quiz-opt-' + i);
    if (i === q.ans) btn.classList.add('correct');
    else if (i === choice && !correct) btn.classList.add('wrong');
    if (i !== choice && i !== q.ans) btn.classList.add('dimmed');
  });

  const fb = document.getElementById('quiz-feedback');
  fb.innerHTML = `
    <div class="quiz-feedback ${correct ? 'correct-fb' : 'wrong-fb'}">
      <strong>${correct ? '✓ Correct!' : '✗ Incorrect'}</strong><br>
      ${q.explain}
    </div>
  `;
  document.getElementById('quiz-next').style.display = 'block';
}

function nextQuizQuestion() {
  quizState.current++;
  quizState.showingFeedback = false;
  renderQuizQuestion();
}

function finishQuiz() {
  const topic = LEARN_TOPICS.find(t => t.id === quizState.topicId);
  const correct = quizState.answers.filter(a => a).length;
  const total = topic.quiz.length;
  const pct = Math.round((correct / total) * 100);
  const passed = pct >= 60;

  if (passed) {
    const prevBadges = new Set(getEarnedBadgeIds());
    if (!learnState[quizState.topicId]) learnState[quizState.topicId] = {};
    learnState[quizState.topicId].quizDone = true;
    learnState[quizState.topicId].quizScore = pct;
    saveLearnState();
    awardXP(50 + (pct === 100 ? 25 : 0));
    checkNewBadges(prevBadges);
  }

  const el = document.getElementById('tab-learn');
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="renderLearn()">← Back to Topics</button>
      <div class="quiz-container">
        <div class="quiz-score">
          <span style="font-size:48px">${passed ? '🎉' : '📚'}</span>
          <h3>${topic.title} Quiz</h3>
          <div class="score-num" style="color:${passed ? 'var(--green)' : 'var(--red)'}">${pct}%</div>
          <p>${correct} out of ${total} correct — ${passed ? 'Great job! You passed!' : 'You need 60% to pass. Review the lessons and try again!'}</p>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="learn-nav-btn secondary" onclick="openTopic('${quizState.topicId}')">Review Lessons</button>
            ${!passed ? `<button class="learn-nav-btn primary" onclick="startQuiz('${quizState.topicId}')">Retry Quiz</button>` : ''}
            <button class="learn-nav-btn primary" onclick="renderLearn()">All Topics</button>
          </div>
        </div>
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
}

// ── Glossary view ─────────────────────────────────────────────────────────────
function glossaryResults(search) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? GLOSSARY_TERMS.filter(g =>
        g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q))
    : GLOSSARY_TERMS;

  if (!filtered.length)
    return '<div style="text-align:center;padding:40px;color:var(--faint);font-size:13px">No matching terms found</div>';

  const groups = {};
  filtered.forEach(g => {
    const letter = g.term[0].toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(g);
  });

  return Object.keys(groups).sort().map(letter => `
    <div class="glossary-letter">${letter}</div>
    ${groups[letter].map(g => `
      <div class="glossary-item">
        <span class="glossary-term-name">${escHtml(g.term)}</span>
        <span class="glossary-term-def">${escHtml(g.def)}</span>
      </div>`).join('')}
  `).join('');
}

function filterGlossary() {
  const input = document.getElementById('glossary-input');
  const container = document.getElementById('glossary-results');
  if (!input || !container) return;
  container.innerHTML = glossaryResults(input.value);
}

function renderGlossary() {
  const el = document.getElementById('tab-learn');
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="renderLearn()">← Back to Topics</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:28px">📖</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">Financial Glossary</h2>
          <p style="font-size:12px;color:var(--faint)">${GLOSSARY_TERMS.length} terms defined</p>
        </div>
      </div>
      <input id="glossary-input" class="glossary-search" placeholder="Search terms or definitions…"
        oninput="filterGlossary()" autocomplete="off">
      <div id="glossary-results">${glossaryResults('')}</div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
  document.getElementById('glossary-input').focus();
}

// ── Badges page ───────────────────────────────────────────────────────────────
function renderBadgesPage() {
  const el = document.getElementById('tab-learn');
  const earned = getEarnedBadgeIds();
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="renderLearn()">← Back to Topics</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <span style="font-size:28px">🏅</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">Achievements</h2>
          <p style="font-size:12px;color:var(--faint)">${earned.size} of ${BADGES.length} earned</p>
        </div>
      </div>
      <div class="badges-grid">
        ${BADGES.map(b => `
          <div class="badge-item ${earned.has(b.id) ? 'earned' : 'locked'}">
            <div class="badge-icon">${b.icon}</div>
            <div class="badge-name">${escHtml(b.name)}</div>
            <div class="badge-desc">${escHtml(b.desc)}</div>
          </div>`).join('')}
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
}

// ── Flashcards view ───────────────────────────────────────────────────────────
// Build flashcard deck from a topic's key terms in lesson content
function buildFlashcards(topic) {
  const cards = [];
  topic.lessons.forEach(lesson => {
    const matches = [...lesson.content.matchAll(/<span class="term">([^<]+)<\/span>\s*[—–-]\s*([^<.]+[^<]*?)(?=<|$)/g)];
    matches.forEach(m => {
      const term = m[1].trim();
      const def = m[2].replace(/<[^>]+>/g, '').trim();
      if (term && def && def.length > 10) cards.push({ term, def });
    });
  });
  // Deduplicate by term
  const seen = new Set();
  return cards.filter(c => { if (seen.has(c.term)) return false; seen.add(c.term); return true; });
}

let fcState = { topicId: null, cards: [], idx: 0, flipped: false };

function renderFlashcards(topicId) {
  const topic = LEARN_TOPICS.find(t => t.id === topicId);
  if (!topic) return;
  const cards = buildFlashcards(topic);
  if (!cards.length) {
    // Fallback: use glossary terms matching topic keywords
    alert('No flashcards available for this topic yet.');
    return;
  }
  // Shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  fcState = { topicId, cards, idx: 0, flipped: false };
  renderFlashcardView();
}

function renderFlashcardView() {
  const el = document.getElementById('tab-learn');
  const topic = LEARN_TOPICS.find(t => t.id === fcState.topicId);
  const { cards, idx, flipped } = fcState;
  const card = cards[idx];
  el.innerHTML = `
    <div class="learn-detail">
      <button class="learn-back" onclick="openTopic('${fcState.topicId}')">← Back to ${escHtml(topic.title)}</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:28px">🃏</span>
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text)">${escHtml(topic.title)} Flashcards</h2>
          <p style="font-size:12px;color:var(--faint)">${cards.length} cards — tap to flip</p>
        </div>
      </div>
      <div class="fc-progress">${idx + 1} / ${cards.length}</div>
      <div class="flashcard-wrap" onclick="fcFlip()">
        <div class="flashcard ${flipped ? 'flipped' : ''}" id="fc-card">
          <div class="flashcard-face flashcard-front">
            <div class="flashcard-label">Term</div>
            <div class="flashcard-text">${escHtml(card.term)}</div>
          </div>
          <div class="flashcard-face flashcard-back">
            <div class="flashcard-label">Definition</div>
            <div class="flashcard-text">${escHtml(card.def)}</div>
          </div>
        </div>
      </div>
      <div class="fc-hint">${flipped ? 'Tap card to see the term again' : 'Tap the card to reveal the definition'}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        ${idx > 0 ? `<button class="learn-nav-btn secondary" onclick="fcNav(-1)">← Prev</button>` : ''}
        ${idx < cards.length - 1
          ? `<button class="learn-nav-btn primary" onclick="fcNav(1)">Next →</button>`
          : `<button class="learn-nav-btn primary" onclick="renderFlashcards('${fcState.topicId}')">Shuffle Again 🔀</button>`}
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
}

function fcFlip() {
  fcState.flipped = !fcState.flipped;
  renderFlashcardView();
}

function fcNav(dir) {
  fcState.idx = Math.max(0, Math.min(fcState.cards.length - 1, fcState.idx + dir));
  fcState.flipped = false;
  renderFlashcardView();
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

// Pre-render the default tab
renderNews();
// Check auth — shows login overlay if not logged in, syncs data if session exists
checkAuth();
// Render sidebar pulse widget with generated data immediately, update after live fetch
renderNavPulse();
// Fetch live prices in background (updates Markets tab when ready)
fetchLivePrices();
// Retry news after 30s if the initial fetch didn't return live articles
setTimeout(() => { if (!liveNews.length) fetchLiveNews(true); }, 30 * 1000);
// Restore alert badge on page load (in case there are persisted matches)
updateNewsAlertBadge();
const initialTabFromPath = Object.entries(TAB_PAGE_MAP).find(([, file]) => file === window.location.pathname.split('/').pop())?.[0];
const requestedInitialTab = window.__INITIAL_TAB__ || document.body.dataset.initialTab || initialTabFromPath;
if (requestedInitialTab && requestedInitialTab !== 'news') switchTab(requestedInitialTab);

