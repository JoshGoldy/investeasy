// ═══════════════════════════════════════════════════════════════════════════
// STATE — declared first to avoid temporal dead zone errors
// ═══════════════════════════════════════════════════════════════════════════

let currentUser   = null;          // {id, name, email, username, tier, finbot_credits} when logged in
const REMEMBER_ME_KEY = 'fs_remember_me';
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
let newsLoadState = 'idle';
let newsLoadError = '';
let marketsLoadError = '';
let calendarLoadError = '';
let transientErrorNotices = {};
let opsStatusState = {
  loading: false,
  error: '',
  data: null,
  loadedAt: 0,
};
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

const BILLING_PLANS = {
  basic: {
    label: 'Basic',
    priceZar: 199,
    credits: 50,
    tone: '#10b981',
    badgeBg: '#10b98122',
    desc: 'Starter AI access with monthly credits',
  },
  pro: {
    label: 'Pro',
    priceZar: 399,
    credits: 100,
    tone: '#7c3aed',
    badgeBg: '#7c3aed22',
    desc: 'Full FinBot access with a larger credit pool',
  },
  enterprise: {
    label: 'Enterprise',
    priceZar: 799,
    credits: 300,
    tone: '#d97706',
    badgeBg: '#d9770622',
    desc: 'Highest monthly credit pool and priority support',
  },
};

const TIER_ORDER = ['free', 'basic', 'pro', 'enterprise'];
let billingCheckoutInFlight = '';

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

function genPrices(base, n, vol = 0.015, trend = 0.0002, targetPct = 0) {
  if (!n || n < 2) return [parseFloat(base.toFixed(2))];
  const safeBase = Math.max(Number(base) || 0, 0.0001);
  const pct = Number.isFinite(targetPct) ? targetPct : 0;
  const start = Math.max(safeBase / (1 + pct / 100), safeBase * 0.6);
  const out = [];
  let anchor = start;

  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    const expected = start + (safeBase - start) * progress;
    const wobble = safeBase * vol * (Math.random() - 0.5) * (1 - progress * 0.65);
    anchor += (expected - anchor) * 0.38 + wobble + safeBase * trend;
    const floor = Math.min(start, safeBase) * 0.72;
    out.push(parseFloat(Math.max(anchor, floor).toFixed(2)));
  }

  out[out.length - 1] = parseFloat(safeBase.toFixed(2));
  if (out.length >= 3) {
    out[out.length - 2] = parseFloat(((out[out.length - 3] * 0.45) + (safeBase * 0.55)).toFixed(2));
  }
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
  'ALL': { pts: 120, lbl: () => yearLabels() },
};
// Seconds between each generated data point per timeframe
const TF_STEP = { '1D': 300, '1W': 3600, '1M': 86400, '3M': 86400, '1Y': 2592000, 'ALL': 2592000 };
const TIMEFRAMES = ['1D','1W','1M','3M','1Y','ALL'];

const MARKETS = RAW_MARKETS.map(m => {
  const charts = {};
  const nowSec = Math.floor(Date.now() / 1000);
  TIMEFRAMES.forEach(tf => {
    const c    = TF_CONFIG[tf];
    const step = TF_STEP[tf];
    const prices = genPrices(m.val, c.pts, tf === '1D' ? 0.0018 : 0.01, 0.0001, tf === '1D' ? m.chg : m.chg * 0.6);
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
let newsSourceMode = 'live';
let newsLoadDetail = '';
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
// Recent in-app notifications for missed ticker/news alerts.
let notificationCenter = JSON.parse(localStorage.getItem('ie_notifications') || '[]');

function notificationDedupeKey(note = {}) {
  if (note.dedupeKey) return note.dedupeKey;
  if (note.type === 'news') {
    return `news:${String(note.title || '').toLowerCase().trim()}:${String(note.body || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }
  return note.id || `${note.type || 'alert'}:${note.ticker || ''}:${note.title || ''}:${note.body || ''}`;
}

function normalizeNotifications() {
  if (!Array.isArray(notificationCenter)) notificationCenter = [];
  const seen = new Map();
  notificationCenter
    .filter(n => n && n.id && n.title)
    .forEach(n => {
      const key = notificationDedupeKey(n);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { ...n, dedupeKey: key });
        return;
      }
      existing.at = Math.max(Number(existing.at || 0), Number(n.at || 0));
      existing.read = !!(existing.read && n.read);
      existing.articleUuid = existing.articleUuid || n.articleUuid || '';
    });
  notificationCenter = [...seen.values()]
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 40);
}

function saveNotifications() {
  normalizeNotifications();
  try { localStorage.setItem('ie_notifications', JSON.stringify(notificationCenter)); } catch(e) {}
}

function unreadNotificationCount() {
  normalizeNotifications();
  return notificationCenter.filter(n => !n.read).length;
}

function addNotification(item = {}) {
  const id = item.id || `${item.type || 'alert'}:${item.key || Date.now()}`;
  normalizeNotifications();
  const dedupeKey = item.dedupeKey || notificationDedupeKey({ ...item, id });
  const existing = notificationCenter.find(n => n.id === id || notificationDedupeKey(n) === dedupeKey);
  if (existing) {
    if (item.forceUnread) existing.read = false;
    existing.at = Date.now();
    existing.title = item.title || existing.title;
    existing.body = item.body || existing.body;
    existing.articleUuid = item.articleUuid || existing.articleUuid || '';
    existing.dedupeKey = dedupeKey;
  } else {
    notificationCenter.unshift({
      id,
      dedupeKey,
      type: item.type || 'alert',
      title: item.title || 'New alert',
      body: item.body || '',
      ticker: item.ticker || '',
      articleUuid: item.articleUuid || '',
      read: false,
      at: Date.now()
    });
  }
  saveNotifications();
  renderNotificationCenter();
}

function formatNotificationTime(ts) {
  const minutes = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function escAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function ensureNotificationCenter() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return null;
  let center = document.getElementById('notification-center');
  if (!center) {
    center = document.createElement('div');
    center.id = 'notification-center';
    center.className = 'notification-center';
    center.innerHTML = `
      <button id="notification-bell" class="notification-bell" type="button" onclick="toggleNotificationsDropdown(event)" aria-label="Notifications" title="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span id="notification-count" class="notification-count"></span>
      </button>
      <div id="notification-dropdown" class="notification-dropdown" aria-live="polite"></div>
    `;
    const userChip = document.getElementById('header-user');
    headerRight.insertBefore(center, userChip || headerRight.firstChild);
  }
  renderNotificationCenter();
  return center;
}

function renderNotificationCenter() {
  const center = document.getElementById('notification-center') || ensureNotificationCenter();
  if (!center) return;
  normalizeNotifications();
  const count = unreadNotificationCount();
  const badge = document.getElementById('notification-count');
  if (badge) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.toggle('visible', count > 0);
  }
  const dropdown = document.getElementById('notification-dropdown');
  if (!dropdown) return;
  const items = notificationCenter.slice(0, 8);
  dropdown.innerHTML = `
    <div class="notification-head">
      <div>
        <p class="notification-title">Notifications</p>
        <p class="notification-sub">${count ? `${count} unread` : 'All caught up'}</p>
      </div>
      ${notificationCenter.length ? `<button class="notification-clear" type="button" onclick="clearNotifications(event)">Clear</button>` : ''}
    </div>
    <div class="notification-list">
      ${items.length ? items.map(n => `
        <button class="notification-item ${n.read ? '' : 'unread'}" type="button" onclick="openNotificationTarget('${escAttr(n.id)}')">
          <span class="notification-icon">${n.type === 'price' ? 'P' : 'N'}</span>
          <span class="notification-copy">
            <span class="notification-item-title">${escHtml(n.title)}</span>
            <span class="notification-item-body">${escHtml(n.body)}</span>
          </span>
          <span class="notification-time">${formatNotificationTime(n.at)}</span>
        </button>
      `).join('') : `<div class="notification-empty">No recent alerts yet.</div>`}
    </div>
  `;
}

function toggleNotificationsDropdown(event) {
  event?.stopPropagation?.();
  const center = ensureNotificationCenter();
  if (!center) return;
  const willOpen = !center.classList.contains('open');
  closeHeaderDropdown();
  center.classList.toggle('open', willOpen);
  if (willOpen) {
    notificationCenter.forEach(n => { n.read = true; });
    saveNotifications();
    renderNotificationCenter();
    center.classList.add('open');
  }
}

function closeNotificationsDropdown() {
  document.getElementById('notification-center')?.classList.remove('open');
}

function clearNotifications(event) {
  event?.stopPropagation?.();
  notificationCenter = [];
  saveNotifications();
  renderNotificationCenter();
}

function openNotificationTarget(id) {
  const note = notificationCenter.find(n => n.id === id);
  closeNotificationsDropdown();
  if (!note) return;
  note.read = true;
  saveNotifications();
  renderNotificationCenter();
  if (note.type === 'news' && note.articleUuid) {
    switchTab('news');
    setTimeout(() => {
      const idx = liveNews.findIndex(n => n.uuid === note.articleUuid);
      if (idx >= 0) openNewsArticle(idx, true);
    }, 100);
    return;
  }
  if (note.type === 'price' && note.ticker) {
    switchTab('markets');
    setTimeout(() => {
      const idx = MARKETS.findIndex(m => m.ticker === note.ticker);
      if (idx >= 0) openStockDetail(idx);
    }, 100);
  }
}

function buildStaticFallbackNews() {
  const now = Date.now();
  const hoursAgo = (hours) => {
    const date = new Date(now - hours * 60 * 60 * 1000);
    const pubTime = Math.floor(date.getTime() / 1000);
    return {
      iso: date.toISOString(),
      pubTime,
      time: hours < 1 ? 'Just now' : hours < 24 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`,
    };
  };

  return [
    {
      uuid: 'fallback-fed-rate-path',
      title: 'Markets weigh the next rate path as inflation data cools',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Investors are watching whether softer inflation is enough to support rate-cut expectations across equities, bonds, and growth stocks.',
      tickers: ['SPX', 'QQQ', 'TLT'],
      thumbnail: null,
      cat: 'Economy',
      hot: true,
      ...hoursAgo(2),
    },
    {
      uuid: 'fallback-ai-megacaps',
      title: 'AI spending stays in focus as mega-cap earnings approach',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Chip demand, cloud budgets, and margin guidance remain central themes for investors tracking large-cap tech leaders.',
      tickers: ['NVDA', 'MSFT', 'GOOGL', 'AMZN'],
      thumbnail: null,
      cat: 'Tech',
      hot: true,
      ...hoursAgo(5),
    },
    {
      uuid: 'fallback-oil-gold-dollar',
      title: 'Oil, gold, and the dollar move as traders reassess growth signals',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Commodities and currencies are reacting to shifting expectations around global demand, policy, and risk appetite.',
      tickers: ['XAU', 'CL1', 'DXY'],
      thumbnail: null,
      cat: 'Commodities',
      hot: false,
      ...hoursAgo(9),
    },
    {
      uuid: 'fallback-bank-earnings',
      title: 'Bank earnings set the tone for credit quality and consumer resilience',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Financials are being judged on loan growth, deposit trends, and whether consumer balance sheets are holding up.',
      tickers: ['JPM', 'GS', 'BAC'],
      thumbnail: null,
      cat: 'Earnings',
      hot: false,
      ...hoursAgo(18),
    },
    {
      uuid: 'fallback-bitcoin-risk',
      title: 'Bitcoin volatility rises as traders rotate between risk and safety',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Crypto remains sensitive to liquidity expectations, ETF flows, and broader appetite for speculative assets.',
      tickers: ['BTC', 'ETH', 'COIN'],
      thumbnail: null,
      cat: 'Crypto',
      hot: true,
      ...hoursAgo(28),
    },
    {
      uuid: 'fallback-housing-rates',
      title: 'Housing and REIT sentiment remain tied to long-term yield moves',
      publisher: 'FinScope Briefing',
      link: '',
      description: 'Real-estate investors continue to watch mortgage costs and financing conditions for signs of improving activity.',
      tickers: ['VNQ', 'XLRE'],
      thumbnail: null,
      cat: 'Real Estate',
      hot: false,
      ...hoursAgo(42),
    },
  ];
}

const STATIC_FALLBACK_NEWS = buildStaticFallbackNews();

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
  { id:'screener', icon:'chart', title:'Stock Screener', sub:'Jake', col:'#10b981',
    desc:"I'm Jake — been hunting stocks for 15 years. Tell me your budget and risk appetite and I'll dig through thousands of companies to hand you a shortlist worth your time." },
  { id:'dcf', icon:'calculate', title:'DCF Valuation', sub:'Emily', col:'#0f766e',
    desc:"I'm Emily — I live in spreadsheets so you don't have to. Give me a ticker and I'll build the full cash flow model and tell you exactly what it's actually worth." },
  { id:'risk', icon:'security-warning', title:'Risk Assessment', sub:'Marcus', col:'#f59e0b',
    desc:"I'm Marcus — I've seen every kind of portfolio blow up. Drop your holdings and I'll map every hidden risk before the market finds it for you." },
  { id:'earnings', icon:'search-list-02', title:'Earnings Preview', sub:'Priya', col:'#8b5cf6',
    desc:"I'm Priya — earnings season is my favourite time of year. I'll break down the history, set the bar, and tell you exactly how to play the announcement." },
  { id:'builder', icon:'briefcase-dollar', title:'Portfolio Builder', sub:'Leo', col:'#06b6d4',
    desc:"I'm Leo — I build portfolios people actually stick to. Share your goals and I'll put together a real plan with specific ETFs, a timeline, and a strategy that fits your life." },
  { id:'technical', icon:'chart-line-data-02', title:'Technical Analysis', sub:'Zoe', col:'#ec4899',
    desc:"I'm Zoe — I read charts the way others read books. Give me a ticker and I'll map the trend, the key levels, and tell you exactly where to get in and out." },
];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function fmtPrice(v) {
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

// Currency conversion. Portfolio totals are calculated in USD, while known
// exchange-local assets can keep their native unit prices for display.
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
function cfgForCurrency(currency = 'USD') { return CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD; }
function nativeToUsd(value, currency = 'USD') {
  const cfg = cfgForCurrency(currency);
  return Number(value || 0) / (cfg.rate || 1);
}

function fmtMoney(v) {
  if (loadSettings().hideBalances) return '••••••';
  const cfg = curCfg();
  return cfg.symbol + (v * cfg.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Per-unit price converted into the user's chosen display currency.
function fmtUnitPrice(v) {
  if (loadSettings().hideBalances) return '••••';
  const cfg = curCfg();
  const c = v * cfg.rate;
  if (c >= 10000) return cfg.symbol + c.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return cfg.symbol + c.toFixed(2);
}

// Per-unit price in the asset's own market currency, e.g. JSE shares in rand.
function fmtNativeUnitPrice(v, currency = 'USD') {
  if (loadSettings().hideBalances) return '••••';
  const cfg = cfgForCurrency(currency);
  const n = Number(v || 0);
  if (n >= 10000) return cfg.symbol + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n < 1 && n > 0) return cfg.symbol + n.toFixed(4);
  return cfg.symbol + n.toFixed(2);
}

function marketCurrency(market) {
  return market?.currency || 'USD';
}

function marketNativeToUsd(market, value) {
  return nativeToUsd(value, marketCurrency(market));
}

function fmtMarketUnitPrice(market, value = market?.val) {
  return fmtNativeUnitPrice(value, marketCurrency(market));
}

function marketDataTicker(market) {
  return market?.exchange ? `${market.exchange}:${market.ticker}` : market?.ticker;
}

const UI_ICON_PATHS = {
  "chart-bar": ['M4 19V10', 'M12 19V5', 'M20 19v-8'],
  "trend-up": ['M4 16l6-6 4 4 6-8', 'M14 6h6v6'],
  "trend-down": ['M4 8l6 6 4-4 6 8', 'M14 18h6v-6'],
  shield: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z'],
  clipboard: ['M9 4h6', 'M9 2h6v4H9z', 'M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2'],
  briefcase: ['M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M3 8h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z', 'M3 12h18'],
  bell: ['M15 17H9', 'M18 17H6l1.5-2.5V10a4.5 4.5 0 0 1 9 0v4.5L18 17z', 'M10 19a2 2 0 0 0 4 0'],
  bookmark: ['M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z'],
  "bookmark-add-01": ['M11 2C7.22876 2 5.34315 2 4.17157 3.12874C3 4.25748 3 6.07416 3 9.70753V17.9808C3 20.2867 3 21.4396 3.77285 21.8523C5.26947 22.6514 8.0768 19.9852 9.41 19.1824C10.1832 18.7168 10.5698 18.484 11 18.484C11.4302 18.484 11.8168 18.7168 12.59 19.1824C13.9232 19.9852 16.7305 22.6514 18.2272 21.8523C19 21.4396 19 20.2867 19 17.9808V12.5', 'M3.5 7.00005H10', 'M17 10L17 2M13 6H21'],
  "bookmark-check-01": ['M4 17.9808V9.70753C4 6.07416 4 4.25748 5.17157 3.12874C6.34315 2 8.22876 2 12 2C15.7712 2 17.6569 2 18.8284 3.12874C20 4.25748 20 6.07416 20 9.70753V17.9808C20 20.2867 20 21.4396 19.2272 21.8523C17.7305 22.6514 14.9232 19.9852 13.59 19.1824C12.8168 18.7168 12.4302 18.484 12 18.484C11.5698 18.484 11.1832 18.7168 10.41 19.1824C9.0768 19.9852 6.26947 22.6514 4.77285 21.8523C4 21.4396 4 20.2867 4 17.9808Z', 'M10 13.7143C10 13.7143 11 14.2357 11.5 15C11.5 15 13 12 15 11', 'M4 7H20'],
  newspaper: ['M5 5h12a2 2 0 0 1 2 2v12H7a2 2 0 0 1-2-2V5z', 'M8 9h8', 'M8 12h8', 'M8 15h5'],
  inbox: ['M4 5h16v11H4z', 'M4 13h4l2 3h4l2-3h4'],
  book: ['M5 4.5A2.5 2.5 0 0 1 7.5 2H19v18H7.5A2.5 2.5 0 0 0 5 22', 'M5 4.5V20'],
  globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'],
  spark: ['M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z'],
  cap: ['M3 9l9-4 9 4-9 4-9-4z', 'M7 11v4c0 1.5 2.5 3 5 3s5-1.5 5-3v-4', 'M21 10v5'],
  award: ['M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M8.5 14.5 7 21l5-2 5 2-1.5-6.5'],
  target: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 11.5v1'],
  flame: ['M12 3s4 3.2 4 7.2A4 4 0 0 1 8 10c0-2.1 1.1-3.5 2.2-4.8.4 1.7 1.5 2.6 1.8 2.8.8-1 1.4-2.5 0-5.2z', 'M8 14a4 4 0 0 0 8 0c0-1.7-1.1-3.2-2.5-4.2.1 2.3-1.3 4.2-3.5 4.2-1.2 0-2.2-.5-3-1.4A4.8 4.8 0 0 0 8 14z'],
  bolt: ['M13 2L5 13h5l-1 9 8-11h-5l1-9z'],
  star: ['M13.7276 3.44418L15.4874 6.99288C15.7274 7.48687 16.3673 7.9607 16.9073 8.05143L20.0969 8.58575C22.1367 8.92853 22.6167 10.4206 21.1468 11.8925L18.6671 14.3927C18.2471 14.8161 18.0172 15.6327 18.1471 16.2175L18.8571 19.3125C19.417 21.7623 18.1271 22.71 15.9774 21.4296L12.9877 19.6452C12.4478 19.3226 11.5579 19.3226 11.0079 19.6452L8.01827 21.4296C5.8785 22.71 4.57865 21.7522 5.13859 19.3125L5.84851 16.2175C5.97849 15.6327 5.74852 14.8161 5.32856 14.3927L2.84884 11.8925C1.389 10.4206 1.85895 8.92853 3.89872 8.58575L7.08837 8.05143C7.61831 7.9607 8.25824 7.48687 8.49821 6.99288L10.258 3.44418C11.2179 1.51861 12.7777 1.51861 13.7276 3.44418Z'],
  cards: ['M8 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M6 15H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  coin: ['M12 4c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4z', 'M4 8v8c0 2.2 3.6 4 8 4s8-1.8 8-4V8'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  "chevron-left": ['M15 18l-6-6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  bot: ['M12 4V2', 'M20 22C20 17.5817 16.4183 14 12 14C7.58172 14 4 17.5817 4 22', 'M9.375 8.25H9.25M9.5 8.25C9.5 8.38807 9.38807 8.5 9.25 8.5C9.11193 8.5 9 8.38807 9 8.25C9 8.11193 9.11193 8 9.25 8C9.38807 8 9.5 8.11193 9.5 8.25Z', 'M14.875 8.25H14.75M15 8.25C15 8.38807 14.8881 8.5 14.75 8.5C14.6119 8.5 14.5 8.38807 14.5 8.25C14.5 8.11193 14.6119 8 14.75 8C14.8881 8 15 8.11193 15 8.25Z', 'M15.1538 4H8.84615C7.59095 4 6.96334 4 6.47397 4.22025C5.91693 4.47095 5.47095 4.91693 5.22025 5.47397C5 5.96334 5 6.59095 5 7.84615C5 9.85448 5 10.8586 5.3524 11.6417C5.75353 12.5329 6.46709 13.2465 7.35835 13.6476C8.14135 14 9.14552 14 11.1538 14H12.8462C14.8545 14 15.8586 14 16.6417 13.6476C17.5329 13.2465 18.2465 12.5329 18.6476 11.6417C19 10.8586 19 9.85448 19 7.84615C19 6.59095 19 5.96334 18.7797 5.47397C18.529 4.91693 18.0831 4.47095 17.526 4.22025C17.0367 4 16.4091 4 15.1538 4Z'],
  folder: ['M3 7h5l2 2h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'],
  tag: ['M20 10l-8 8-8-8V4h6l10 10z', 'M7.5 7.5h.01'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M8 7l1 13h6l1-13'],
  mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
  wallet: ['M13 3.5H14C14.93 3.5 15.395 3.5 15.7765 3.60222C16.8117 3.87962 17.6204 4.68827 17.8978 5.72354C18 6.10504 18 6.57003 18 7.5H5C3.89543 7.5 3 6.60457 3 5.5C3 4.39543 3.89543 3.5 5 3.5H8', 'M3 5.5V15.5C3 18.3284 3 19.7426 3.87868 20.6213C4.75736 21.5 6.17157 21.5 9 21.5H15C17.8284 21.5 19.2426 21.5 20.1213 20.6213C21 19.7426 21 18.3284 21 15.5V13.5C21 10.6716 21 9.25736 20.1213 8.37868C19.2426 7.5 17.8284 7.5 15 7.5H7', 'M21 12.5H19C18.535 12.5 18.3025 12.5 18.1118 12.5511C17.5941 12.6898 17.1898 13.0941 17.0511 13.6118C17 13.8025 17 14.035 17 14.5C17 14.965 17 15.1975 17.0511 15.3882C17.1898 15.9059 17.5941 16.3102 18.1118 16.4489C18.3025 16.5 18.535 16.5 19 16.5H21', 'M10.5 2.5C12.433 2.5 14 4.067 14 6C14 6.5368 13.8792 7.04537 13.6632 7.5H7.33682C7.12085 7.04537 7 6.5368 7 6C7 4.067 8.567 2.5 10.5 2.5Z'],
  "pie-chart-09": ['M16.5557 4.61883C15.7488 4.07099 14.8724 3.64848 13.9552 3.3602C12.7981 2.99648 12.2195 2.81462 11.6098 3.2715C11 3.72839 11 4.4705 11 5.95472V10.5064C11 11.7697 11 12.4013 11.2341 12.9676C11.4683 13.534 11.9122 13.9761 12.8 14.8604L15.999 18.0466C17.0421 19.0855 17.5637 19.605 18.3116 19.4823C19.0596 19.3597 19.3367 18.8125 19.8911 17.7182C20.3153 16.881 20.6251 15.9835 20.8079 15.0499C21.1937 13.0788 20.9957 11.0358 20.2388 9.17903C19.4819 7.32232 18.2002 5.73535 16.5557 4.61883Z', 'M14 20.4184C13.0736 20.7934 12.0609 20.9999 11 20.9999C6.58172 20.9999 3 17.4182 3 12.9999C3 9.56293 5.16736 6.6322 8.20988 5.49988'],
  "chart-03": ['M3 4V14C3 16.8284 3 18.2426 3.87868 19.1213C4.75736 20 6.17157 20 9 20H21', 'M6 14L9.25 10.75C9.89405 10.1059 10.2161 9.78392 10.5927 9.67766C10.8591 9.60254 11.1409 9.60254 11.4073 9.67766C11.7839 9.78392 12.1059 10.1059 12.75 10.75C13.3941 11.3941 13.7161 11.7161 14.0927 11.8223C14.3591 11.8975 14.6409 11.8975 14.9073 11.8223C15.2839 11.7161 15.6059 11.3941 16.25 10.75L20 7'],
  "dashboard-square-01": ['M13.6903 19.4567C13.5 18.9973 13.5 18.4149 13.5 17.25C13.5 16.0851 13.5 15.5027 13.6903 15.0433C13.944 14.4307 14.4307 13.944 15.0433 13.6903C15.5027 13.5 16.0851 13.5 17.25 13.5C18.4149 13.5 18.9973 13.5 19.4567 13.6903C20.0693 13.944 20.556 14.4307 20.8097 15.0433C21 15.5027 21 16.0851 21 17.25C21 18.4149 21 18.9973 20.8097 19.4567C20.556 20.0693 20.0693 20.556 19.4567 20.8097C18.9973 21 18.4149 21 17.25 21C16.0851 21 15.5027 21 15.0433 20.8097C14.4307 20.556 13.944 20.0693 13.6903 19.4567Z', 'M13.6903 8.95671C13.5 8.49728 13.5 7.91485 13.5 6.75C13.5 5.58515 13.5 5.00272 13.6903 4.54329C13.944 3.93072 14.4307 3.44404 15.0433 3.1903C15.5027 3 16.0851 3 17.25 3C18.4149 3 18.9973 3 19.4567 3.1903C20.0693 3.44404 20.556 3.93072 20.8097 4.54329C21 5.00272 21 5.58515 21 6.75C21 7.91485 21 8.49728 20.8097 8.95671C20.556 9.56928 20.0693 10.056 19.4567 10.3097C18.9973 10.5 18.4149 10.5 17.25 10.5C16.0851 10.5 15.5027 10.5 15.0433 10.3097C14.4307 10.056 13.944 9.56928 13.6903 8.95671Z', 'M3.1903 19.4567C3 18.9973 3 18.4149 3 17.25C3 16.0851 3 15.5027 3.1903 15.0433C3.44404 14.4307 3.93072 13.944 4.54329 13.6903C5.00272 13.5 5.58515 13.5 6.75 13.5C7.91485 13.5 8.49728 13.5 8.95671 13.6903C9.56928 13.944 10.056 14.4307 10.3097 15.0433C10.5 15.5027 10.5 16.0851 10.5 17.25C10.5 18.4149 10.5 18.9973 10.3097 19.4567C10.056 20.0693 9.56928 20.556 8.95671 20.8097C8.49728 21 7.91485 21 6.75 21C5.58515 21 5.00272 21 4.54329 20.8097C3.93072 20.556 3.44404 20.0693 3.1903 19.4567Z', 'M3.1903 8.95671C3 8.49728 3 7.91485 3 6.75C3 5.58515 3 5.00272 3.1903 4.54329C3.44404 3.93072 3.93072 3.44404 4.54329 3.1903C5.00272 3 5.58515 3 6.75 3C7.91485 3 8.49728 3 8.95671 3.1903C9.56928 3.44404 10.056 3.93072 10.3097 4.54329C10.5 5.00272 10.5 5.58515 10.5 6.75C10.5 7.91485 10.5 8.49728 10.3097 8.95671C10.056 9.56928 9.56928 10.056 8.95671 10.3097C8.49728 10.5 7.91485 10.5 6.75 10.5C5.58515 10.5 5.00272 10.5 4.54329 10.3097C3.93072 10.056 3.44404 9.56928 3.1903 8.95671Z'],
  news: ['M18 15V9C18 6.17157 18 4.75736 17.1213 3.87868C16.2426 3 14.8284 3 12 3H8C5.17157 3 3.75736 3 2.87868 3.87868C2 4.75736 2 6.17157 2 9V15C2 17.8284 2 19.2426 2.87868 20.1213C3.75736 21 5.17157 21 8 21H20', 'M6 8L14 8', 'M6 12L14 12', 'M6 16L10 16', 'M18 8H19C20.4142 8 21.1213 8 21.5607 8.43934C22 8.87868 22 9.58579 22 11V19C22 20.1046 21.1046 21 20 21C18.8954 21 18 20.1046 18 19V8Z'],
  "money-exchange-03": ['M3 11C3 8.23571 5.23571 6 8 6L7 8.5', 'M21 13C21 15.7643 18.7643 18 16 18L17 15.5', 'M18.3333 10H14.6667C12.9382 10 12.0739 10 11.537 9.48744C11 8.97487 11 8.14992 11 6.5C11 4.85008 11 4.02513 11.537 3.51256C12.0739 3 12.9382 3 14.6667 3H18.3333C20.0618 3 20.9261 3 21.463 3.51256C22 4.02513 22 4.85008 22 6.5C22 8.14992 22 8.97487 21.463 9.48744C20.9261 10 20.0618 10 18.3333 10Z', 'M9.33333 21H5.66667C3.93818 21 3.07394 21 2.53697 20.4874C2 19.9749 2 19.1499 2 17.5C2 15.8501 2 15.0251 2.53697 14.5126C3.07394 14 3.93818 14 5.66667 14H9.33333C11.0618 14 11.9261 14 12.463 14.5126C13 15.0251 13 15.8501 13 17.5C13 19.1499 13 19.9749 12.463 20.4874C11.9261 21 11.0618 21 9.33333 21Z', 'M7.75 17.5H7.5M8 17.5C8 17.7761 7.77614 18 7.5 18C7.22386 18 7 17.7761 7 17.5C7 17.2239 7.22386 17 7.5 17C7.77614 17 8 17.2239 8 17.5Z', 'M16.75 6.5H16.5M17 6.5C17 6.77614 16.7761 7 16.5 7C16.2239 7 16 6.77614 16 6.5C16 6.22386 16.2239 6 16.5 6C16.7761 6 17 6.22386 17 6.5Z'],
  "view-off": ['M22 8C22 8 18 14 12 14C6 14 2 8 2 8', 'M15 13.5L16.5 16', 'M20 11L22 13', 'M2 13L4 11', 'M9 13.5L7.5 16'],
  "balance-scale": ['M12 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M10 5H4M14 5H20', 'M17 21H7', 'M12 7V21', 'M22 14C22 15.6569 20.6569 17 19 17C17.3431 17 16 15.6569 16 14M22 14L19.5 8H18.5L16 14M22 14H16', 'M8 14C8 15.6569 6.65685 17 5 17C3.34315 17 2 15.6569 2 14M8 14L5.5 8H4.5L2 14M8 14H2'],
  "time-04": ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.5 9.5L12.9999 12.9996M16 8L11 13'],
  chart: ['M15 21V6C15 5.06812 15 4.60218 14.8478 4.23463C14.6448 3.74458 14.2554 3.35523 13.7654 3.15224C13.3978 3 12.9319 3 12 3C11.0681 3 10.6022 3 10.2346 3.15224C9.74458 3.35523 9.35523 3.74458 9.15224 4.23463C9 4.60218 9 5.06812 9 6V21H15Z', 'M17 8H15V21H17C18.8856 21 19.8284 21 20.4142 20.4142C21 19.8284 21 18.8856 21 17V12C21 10.1144 21 9.17157 20.4142 8.58579C19.8284 8 18.8856 8 17 8Z', 'M9 13H7C5.11438 13 4.17157 13 3.58579 13.5858C3 14.1716 3 15.1144 3 17C3 18.8856 3 19.8284 3.58579 20.4142C4.17157 21 5.11438 21 7 21H9V13Z'],
  calculate: ['M21.5 12.95V11.05C21.5 7.01949 21.5 5.00424 20.1088 3.75212C18.7175 2.5 16.4783 2.5 12 2.5C7.52166 2.5 5.28249 2.5 3.89124 3.75212C2.5 5.00424 2.5 7.01949 2.5 11.05V12.95C2.5 16.9805 2.5 18.9958 3.89124 20.2479C5.28249 21.5 7.52166 21.5 12 21.5C16.4783 21.5 18.7175 21.5 20.1088 20.2479C21.5 18.9958 21.5 16.9805 21.5 12.95Z', 'M18 8H14M16 6L16 10', 'M18 17.5H14', 'M18 14.5H14', 'M10 17.5L8.25 15.75M8.25 15.75L6.5 14M8.25 15.75L10 14M8.25 15.75L6.5 17.5', 'M10 8H6'],
  "security-warning": ['M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z', 'M12 11V7', 'M12.125 14.75H12M12.25 14.75C12.25 14.8881 12.1381 15 12 15C11.8619 15 11.75 14.8881 11.75 14.75C11.75 14.6119 11.8619 14.5 12 14.5C12.1381 14.5 12.25 14.6119 12.25 14.75Z'],
  "search-list-02": ['M2.5 9.5H6.5', 'M2.5 14.5H6.5', 'M2.5 19.5H18.5', 'M18.5355 13.0355L21.5 16M20 9.5C20 6.73858 17.7614 4.5 15 4.5C12.2386 4.5 10 6.73858 10 9.5C10 12.2614 12.2386 14.5 15 14.5C17.7614 14.5 20 12.2614 20 9.5Z'],
  "briefcase-dollar": ['M2 14C2 10.4934 2 8.74003 2.90796 7.55992C3.07418 7.34388 3.25989 7.14579 3.46243 6.96849C4.56878 6 6.21252 6 9.5 6H14.5C17.7875 6 19.4312 6 20.5376 6.96849C20.7401 7.14579 20.9258 7.34388 21.092 7.55992C22 8.74003 22 10.4934 22 14C22 17.5066 22 19.26 21.092 20.4401C20.9258 20.6561 20.7401 20.8542 20.5376 21.0315C19.4312 22 17.7875 22 14.5 22H9.5C6.21252 22 4.56878 22 3.46243 21.0315C3.25989 20.8542 3.07418 20.6561 2.90796 20.4401C2 19.26 2 17.5066 2 14Z', 'M16 6C16 4.11438 16 3.17157 15.4142 2.58579C14.8284 2 13.8856 2 12 2C10.1144 2 9.17157 2 8.58579 2.58579C8 3.17157 8 4.11438 8 6', 'M12 11C10.8954 11 10 11.6716 10 12.5C10 13.3284 10.8954 14 12 14C13.1046 14 14 14.6716 14 15.5C14 16.3284 13.1046 17 12 17M12 11C12.8708 11 13.6116 11.4174 13.8862 12M12 11V10M12 17C11.1292 17 10.3884 16.5826 10.1138 16M12 17V18', 'M6 12H2', 'M22 12L18 12'],
  "chart-line-data-02": ['M8.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M14.5 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M18.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M15.4341 14.2963L18 9M9.58251 11.5684L13.2038 14.2963M3 19L7.58957 11.8792', 'M20 21H9C5.70017 21 4.05025 21 3.02513 19.9749C2 18.9497 2 17.2998 2 14V3'],
  "crown-03": ['M5 20.5H19', 'M16.8717 17.5H7.1283C6.10017 17.5 5.58611 17.5 5.19623 17.2234C4.80634 16.9468 4.63649 16.4616 4.29679 15.4912L2.05123 9.07668C1.93172 8.72325 2.02503 8.3336 2.29225 8.07016C2.62854 7.73864 3.15545 7.6872 3.55117 7.94727L4.78349 8.75718C6.02739 9.5747 6.64935 9.98345 7.27815 9.83488C7.90696 9.68631 8.28019 9.04241 9.02665 7.75461L11.2412 3.93412C11.3968 3.66567 11.6864 3.5 12 3.5C12.3136 3.5 12.6032 3.66567 12.7588 3.93412L14.9733 7.75461C15.7198 9.04241 16.093 9.68631 16.7218 9.83488C17.3507 9.98345 17.9726 9.5747 19.2165 8.75718L20.4488 7.94727C20.8445 7.6872 21.3715 7.73864 21.7078 8.07016C21.975 8.3336 22.0683 8.72325 21.9488 9.07668L19.7032 15.4912C19.3635 16.4616 19.1937 16.9468 18.8038 17.2234C18.4139 17.5 17.8998 17.5 16.8717 17.5Z'],
  "coins-01": ['M15.5 13a6.5 2 0 1 0 0-4 6.5 2 0 0 0 0 4z', 'M22 15.5C22 16.6046 19.0899 17.5 15.5 17.5C11.9101 17.5 9 16.6046 9 15.5', 'M22 11V19.8C22 21.015 19.0899 22 15.5 22C11.9101 22 9 21.015 9 19.8V11', 'M8.5 6a6.5 2 0 1 0 0-4 6.5 2 0 0 0 0 4z', 'M6 11C4.10819 10.7698 2.36991 10.1745 2 9M6 16C4.10819 15.7698 2.36991 15.1745 2 14', 'M6 21C4.10819 20.7698 2.36991 20.1745 2 19L2 4', 'M15 6V4'],
  "eye-off": ['M3 3l18 18', 'M10.6 10.6a3 3 0 1 0 4.2 4.2', 'M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4 10 7a18.3 18.3 0 0 1-4.3 4.9', 'M6.6 6.6A18.2 18.2 0 0 0 2 12c1 3 5 7 10 7 1.6 0 3.1-.4 4.5-1.1'],
  clock: ['M12 7v5l3 3', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  rocket: ['M5 19c1.5-1 3-1.5 4.5-1.5L18 9c.2-2.5-.5-4.5-2-6-1.5 1.5-3.5 2.2-6 2L1.5 13.5C1.5 15 1 16.5 0 18c2 0 3.5-.5 5-1.5z', 'M14 10l4 4', 'M7 17l-2 2'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z', 'M20 20l-4-4'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z', 'M9 4v14', 'M15 6v14'],
  note: ['M6 3h9l3 3v15H6z', 'M9 12h6', 'M9 16h6', 'M15 3v4h4'],
  scale: ['M12 3v18', 'M7 7h10', 'M5 7l-3 5h6l-3-5z', 'M19 7l-3 5h6l-3-5z'],
  check: ['M5 12l4 4L19 6'],
  "bell-off": ['M9 17h6', 'M18 17H6l1.5-2.5V10a4.5 4.5 0 0 1 7.6-3.2', 'M10 19a2 2 0 0 0 4 0', 'M3 3l18 18'],
  "notification-01": ['M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18', 'M19.2311 18H4.76887C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 5.63401 8.13401 2.5 12 2.5C15.866 2.5 19 5.634 19 9.5V12.2558C19 13.0514 19.3161 13.8145 19.8787 14.3771L20.4819 14.9803C20.8136 15.3121 21 15.762 21 16.2311C21 17.208 20.208 18 19.2311 18Z'],
  "notification-off-01": ['M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18', 'M2 2L22 22', 'M21 16.2311C21 15.762 20.8136 15.3121 20.4819 14.9803L19.8787 14.3771C19.3161 13.8145 19 13.0514 19 12.2558V9.5C19 5.634 15.866 2.5 12 2.5C10.4497 2.5 9.01706 3.00399 7.85707 3.85707M4.76887 18C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 8.20839 5.34981 6.99849 5.95987 5.95987L18 18H4.76887Z'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
  "external-link": ['M14 4h6v6', 'M20 4l-9 9', 'M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5'],
  compare: ['M4 7h10', 'M10 3l4 4-4 4', 'M20 17H10', 'M14 13l-4 4 4 4'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  calendar: ['M3 5h18v16H3z', 'M16 3v4', 'M8 3v4', 'M3 10h18'],
};

const UI_ICON_ALIASES = {
  '\u{1F4CA}': 'chart-bar',
  '\u{1F4C8}': 'trend-up',
  '\u{1F6E1}': 'shield',
  '\u{1F4CB}': 'clipboard',
  '\u{1F3D7}': 'briefcase',
  '\u{1F4C9}': 'trend-down',
  '\u{1F916}': 'bot',
  '\u{1F4F0}': 'newspaper',
  '\u{1F514}': 'bell',
  '\u{1F516}': 'bookmark',
  '\u{1F4E5}': 'inbox',
  '\u{1F310}': 'globe',
  '\u{1F331}': 'spark',
  '\u{1F4D6}': 'book',
  '\u{1F393}': 'cap',
  '\u{270F}': 'clipboard',
  '\u{1F4AF}': 'target',
  '\u{1F3C6}': 'award',
  '\u{1F525}': 'flame',
  '\u{26A1}': 'bolt',
  '\u{2B50}': 'star',
  '\u{1F0CF}': 'cards',
  '\u{20BF}': 'coin',
  '\u{2696}': 'scale',
  '\u{1F680}': 'rocket',
  '\u{1F4DD}': 'note',
  '\u{1F5FA}': 'map',
  '\u{1F3C5}': 'award',
  '\u{2705}': 'check',
  '\u{1F4DA}': 'book',
};

function iconMarkup(name, className = '') {
  const key = UI_ICON_ALIASES[name] || name || 'spark';
  const paths = UI_ICON_PATHS[key] || UI_ICON_PATHS.spark;
  const pathHtml = paths.map(d => `<path d="${d}" />`).join('');
  const classes = ['ui-icon', className].filter(Boolean).join(' ');
  return `<span class="${classes}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pathHtml}</svg></span>`;
}

function bookmarkNewsIcon(isSaved) {
  return iconMarkup(isSaved ? 'bookmark-check-01' : 'bookmark-add-01', 'news-bookmark-icon');
}

function marketAlertIcon(hasAlert) {
  return iconMarkup(hasAlert ? 'notification-01' : 'notification-off-01', 'market-alert-icon');
}

function starIcon(className = 'star-icon') {
  return iconMarkup('star', className);
}

function closeIcon(className = 'close-icon') {
  return iconMarkup('close', className);
}

function stripLeadingDecorativeIcon(line) {
  return line.replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?|[₿Ξ◎Ð])+[\s-]*/u, '');
}

function hydrateStaticUiIcons() {
  return;
  const exactReplacements = [
    ['#alert-dir-above', `${iconMarkup('trend-up', 'inline-icon')} Above`],
    ['#alert-dir-below', `${iconMarkup('trend-down', 'inline-icon')} Below`],
    ['.alert-save-btn', `${iconMarkup('bell', 'inline-icon')} Set Alert`],
    ['#news-alerts-modal-bg h3', `${iconMarkup('bell', 'inline-icon')} News Alerts`],
  ];
  exactReplacements.forEach(([selector, html]) => {
    document.querySelectorAll(selector).forEach((el) => { el.innerHTML = html; });
  });

  const textReplacements = new Map([
    ['📥', iconMarkup('inbox', 'modal-header-icon')],
    ['⚡', iconMarkup('bolt', 'modal-header-icon')],
    ['🤖', iconMarkup('bot', 'modal-header-icon')],
    ['📈 Popular Stocks', `${iconMarkup('trend-up', 'inline-icon')} Popular Stocks`],
    ['₿ Crypto', `${iconMarkup('coin', 'inline-icon')} Crypto`],
    ['📊 ETFs', `${iconMarkup('chart-bar', 'inline-icon')} ETFs`],
    ['🥇 Commodities', `${iconMarkup('briefcase', 'inline-icon')} Commodities`],
    ['🥇 Gold', `${iconMarkup('coin', 'inline-icon')} Gold`],
    ['🥈 Silver', `${iconMarkup('coin', 'inline-icon')} Silver`],
    ['🛢 Oil', `${iconMarkup('briefcase', 'inline-icon')} Oil`],
    ['📦 Multi', `${iconMarkup('folder', 'inline-icon')} Multi`],
    ['₿ Bitcoin', 'Bitcoin'],
    ['Ξ Ethereum', 'Ethereum'],
    ['◎ Solana', 'Solana'],
    ['Ð Doge', 'Doge'],
  ]);

  document.querySelectorAll('button, div, p, h3').forEach((el) => {
    const text = (el.textContent || '').trim();
    const replacement = textReplacements.get(text);
    if (replacement) el.innerHTML = replacement;
  });
}

const UI_TOKEN_ICON_MAP = {
  '\u{1F514}': 'bell',
  '\u{1F516}': 'bookmark',
  '\u{1F3F7}': 'tag',
  '\u{1F4F0}': 'newspaper',
  '\u{1F916}': 'bot',
  '\u{1F4CA}': 'chart-bar',
  '\u{1F4C8}': 'trend-up',
  '\u{1F4C9}': 'trend-down',
  '\u{1F4E5}': 'inbox',
  '\u{26A1}': 'bolt',
  '\u{1F3C6}': 'award',
  '\u{1F4C1}': 'folder',
  '\u{1F4DD}': 'note',
  '\u{1F5D1}': 'trash',
  '\u{1F512}': 'lock',
  '\u{1F50D}': 'search',
  '\u{1F9E0}': 'spark',
  '\u{1F4B0}': 'wallet',
  '\u{1F3E6}': 'briefcase',
  '\u{1F5D2}': 'book',
  '\u{1F4D6}': 'book',
  '\u{1F4DA}': 'book',
  '\u{1F3C5}': 'award',
  '\u{1F4AE}': 'spark',
  '\u{1F389}': 'award',
  '\u{1F0CF}': 'cards',
  '\u{1F525}': 'flame',
  '\u{1F4A4}': 'spark',
  '\u{1F680}': 'rocket',
  '\u{1F5FA}': 'map',
  '\u{2696}': 'scale',
  '\u{2705}': 'check',
  '\u{2713}': 'check',
  '\u{2714}': 'check',
  '\u{2715}': 'close',
  '\u{2716}': 'close',
  '\u{274C}': 'close',
  '\u{2606}': 'star',
  '\u{2605}': 'star',
  '\u{1F515}': 'bell-off',
  '\u{1F441}': 'eye',
};

function replaceUiEmojiTokens(root = document) {
  return root;
}

function refreshUiIcons(root = document) {
  return root;
}

function scheduleUiIconRefresh(root = document) {
  return root;
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value;
}

function cleanNewsText(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function normalizeNewsArticle(article) {
  if (!article) return article;
  const title = cleanNewsText(article.title || '');
  const description = cleanNewsText(String(article.description || '').replace(/<[^>]+>/g, ''));
  return {
    ...article,
    title,
    description,
    cat: article.cat || _newsCateg(title),
    hot: typeof article.hot === 'boolean' ? article.hot : _newsHot(title),
  };
}

function parseMd(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const gatherContinuationLines = (startIndex, initialLine) => {
    const parts = [initialLine];
    let cursor = startIndex + 1;
    while (cursor < lines.length) {
      const nextRaw = lines[cursor];
      const next = nextRaw.trim();
      if (!next) break;
      if (
        next.startsWith('|') ||
        next.startsWith('#') ||
        next.startsWith('## ') ||
        next.startsWith('### ') ||
        next.startsWith('#### ') ||
        next.startsWith('- ') ||
        next.startsWith('* ') ||
        /^\d+\. /.test(next)
      ) {
        break;
      }
      parts.push(next);
      cursor += 1;
    }
    return { text: parts.join(' '), nextIndex: cursor };
  };

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = stripLeadingDecorativeIcon(rawLine.trim());

    if (!line || line === '---') {
      out.push('<div style="height:6px"></div>');
      i += 1;
      continue;
    }

    if (line.startsWith('|')) {
      const tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim();
        const cells = row.split('|').filter(c => c.trim());
        if (cells.length && !cells.every(c => /^[-: ]+$/.test(c))) {
          tableRows.push(cells.map(c => inlineMd(c.trim())));
        }
        i += 1;
      }
      if (tableRows.length) {
        const colCount = Math.max(...tableRows.map(r => r.length));
        const first = tableRows[0];
        const bodyRows = tableRows.slice(1);
        const headerHtml = first.map(c => `<div class="th">${c}</div>`).join('');
        const bodyHtml = bodyRows.flatMap(row =>
          Array.from({ length: colCount }, (_, idx) => `<div class="td">${row[idx] || ''}</div>`)
        ).join('');
        out.push(`<div class="md-table-scroll"><div class="md-table" style="--md-cols:${colCount};grid-template-columns:repeat(${colCount},minmax(0,1fr))">${headerHtml}${bodyHtml}</div></div>`);
      }
      continue;
    }

    if (line.startsWith('#### ')) { out.push(`<h4>${inlineMd(line.slice(5))}</h4>`); i += 1; continue; }
    if (line.startsWith('### ')) { out.push(`<h3>${inlineMd(line.slice(4))}</h3>`); i += 1; continue; }
    if (line.startsWith('## '))  { out.push(`<h2>${inlineMd(line.slice(3))}</h2>`); i += 1; continue; }
    if (line.startsWith('# '))   { out.push(`<h1>${inlineMd(line.slice(2))}</h1>`); i += 1; continue; }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const merged = gatherContinuationLines(i, line.slice(2).trim());
      out.push(`<div class="bullet"><span>${inlineMd(merged.text)}</span></div>`);
      i = merged.nextIndex;
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const merged = gatherContinuationLines(i, line.replace(/^\d+\. /, '').trim());
      out.push(`<div class="bullet"><span>${inlineMd(merged.text)}</span></div>`);
      i = merged.nextIndex;
      continue;
    }
    if (line.toLowerCase().includes('legal disclaimer') || line.toLowerCase().includes('informational and educational')) {
      out.push(`<p class="disclaimer">${inlineMd(line.replace(/^\*|\*$/g, ''))}</p>`);
      i += 1;
      continue;
    }

    const merged = gatherContinuationLines(i, line);
    out.push(`<p>${inlineMd(merged.text)}</p>`);
    i = merged.nextIndex;
  }

  return out.join('');
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

function marketChartData(market, data) {
  return marketCurrency(market) === 'USD' ? convertChartData(data) : data;
}

function marketChartCurrency(market) {
  return marketCurrency(market) === 'USD' ? loadSettings().currency : marketCurrency(market);
}

function createFullChart(container, data, color, height = 300, currency = loadSettings().currency) {
  if (!container || !data.length) return null;
  container.innerHTML = '';
  const isMobileChart = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  const measuredHeight = Math.round(container.getBoundingClientRect().height || container.clientHeight || height);
  const chartHeight = isMobileChart ? 240 : (measuredHeight || height);
  container.style.height = `${chartHeight}px`;
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth, height: chartHeight,
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
    handleScroll: { mouseWheel: false, pressedMouseMove: !isMobileChart },
    handleScale:  { mouseWheel: false, pinch: !isMobileChart },
  });
  const chartCurrency = currency || loadSettings().currency;
  const cfg = cfgForCurrency(chartCurrency);
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
        const c = cfg;
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
  closeHeaderDropdown();
  closeNotificationsDropdown();
  closeMobileNav();
  if (id === 'learn' && loadSettings().uiMode === 'terminal') {
    id = 'markets';
  }
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
  scheduleUiIconRefresh(document.getElementById('tab-' + id) || document);
}

navBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function closeMobileNav() {
  document.body.classList.remove('mobile-nav-open');
}

function toggleMobileNav(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !document.body.classList.contains('mobile-nav-open');
  document.body.classList.toggle('mobile-nav-open', shouldOpen);
}

function setupMobileChrome() {
  const header = document.querySelector('.header');
  const brand = document.querySelector('.header-brand');
  if (header && !document.getElementById('mobile-nav-toggle')) {
    const toggle = document.createElement('button');
    toggle.id = 'mobile-nav-toggle';
    toggle.className = 'mobile-nav-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMobileNav();
    });
    header.insertBefore(toggle, brand || header.firstChild);
  }

  if (!document.querySelector('.mobile-nav-backdrop')) {
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.setAttribute('aria-label', 'Close navigation menu');
    backdrop.addEventListener('click', () => closeMobileNav());
    document.body.appendChild(backdrop);
  }

  if (!document.getElementById('mobile-finbot-bubble')) {
    const bubble = document.createElement('button');
    bubble.id = 'mobile-finbot-bubble';
    bubble.type = 'button';
    bubble.className = 'mobile-finbot-bubble';
    bubble.setAttribute('aria-label', 'Open FinBot');
    bubble.innerHTML = `
      ${iconMarkup('bot', 'mobile-finbot-bubble-icon')}
      <span class="mobile-finbot-bubble-label">FinBot</span>
    `;
    bubble.addEventListener('click', () => {
      bubble.classList.remove('pulse');
      void bubble.offsetWidth;
      bubble.classList.add('pulse');
      setTimeout(() => switchTab('finbot'), 120);
    });
    document.body.appendChild(bubble);
  }

  document.addEventListener('click', (event) => {
    const nav = document.querySelector('.nav');
    const toggle = document.getElementById('mobile-nav-toggle');
    if (!isMobileViewport() || !document.body.classList.contains('mobile-nav-open')) return;
    if (nav?.contains(event.target) || toggle?.contains(event.target)) return;
    closeMobileNav();
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeMobileNav();
  });
}

function closeHeaderDropdown() {
  const userEl = document.getElementById('header-user');
  if (userEl) userEl.classList.remove('open');
}

function setupHeaderDropdown() {
  const userEl = document.getElementById('header-user');
  if (!userEl || userEl.dataset.dropdownBound === '1') return;
  userEl.dataset.dropdownBound = '1';

  userEl.addEventListener('click', (event) => {
    if (!currentUser || !isMobileViewport()) return;
    if (event.target.closest('.user-dd-item')) {
      closeHeaderDropdown();
      return;
    }
    event.stopPropagation();
    closeNotificationsDropdown();
    userEl.classList.toggle('open');
  });

  document.addEventListener('click', (event) => {
    if (!userEl.contains(event.target)) closeHeaderDropdown();
    if (!event.target.closest?.('#notification-center')) closeNotificationsDropdown();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeHeaderDropdown();
      closeNotificationsDropdown();
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeHeaderDropdown();
  });
}

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
      const url = `https://content.guardianapis.com/${section}?api-key=test&show-fields=headline,trailText&page-size=40&order-by=newest`;
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      if (d.response?.status !== 'ok') return;
      for (const item of (d.response.results || [])) {
        const headline = cleanNewsText(item.fields?.headline || item.webTitle);
        const { pubTime, timeStr } = _newsTime(item.webPublicationDate);
        articles.push({
          uuid: item.id.split('/').pop().slice(0, 20),
          title: headline,
          publisher: 'The Guardian',
          link: item.webUrl,
          description: cleanNewsText((item.fields?.trailText || '').replace(/<[^>]+>/g, '')),
          time: timeStr,
          pubTime,
          tickers: [],
          thumbnail: null,
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
  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?count=40&rss_url=';
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
        const title = cleanNewsText(item.title);
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const { pubTime, timeStr } = _newsTime(item.pubDate);
        articles.push({
          uuid: btoa(encodeURIComponent(title)).slice(0, 16),
          title,
          publisher: pub,
          link: item.link || '',
          description: cleanNewsText((item.description || '').replace(/<[^>]+>/g, '')).slice(0, 400),
          time: timeStr,
          pubTime,
          tickers: [],
          thumbnail: null,
          cat: _newsCateg(title),
          hot: _newsHot(title),
        });
      }
    } catch(e) {}
  }));
  return articles;
}

function summarizeNewsDiagnostics(diagnostics = []) {
  if (!Array.isArray(diagnostics) || !diagnostics.length) return '';
  const parts = diagnostics.map(d => {
    const label = d.label || d.publisher || d.id || 'source';
    if (d.status === 'error') return `${label}: error${d.error ? ` (${d.error})` : ''}`;
    if (d.status === 'empty') return `${label}: 0 recent articles`;
    if (typeof d.accepted === 'number') return `${label}: ${d.accepted} recent`;
    return `${label}: ok`;
  });
  return parts.join('; ');
}

async function fetchNewsClientSide() {
  // Run both sources in parallel; Guardian is primary, rss2json is fallback
  const [guardianResult, rssResult] = await Promise.allSettled([
    fetchGuardianNews(),
    fetchRss2JsonNews(),
  ]);

  const seen = new Set();
  const all = [];
  const diagnostics = [];
  for (const result of [guardianResult, rssResult]) {
    if (result.status !== 'fulfilled') continue;
    for (const a of result.value) {
      const article = normalizeNewsArticle(a);
      const key = article.title.trim().toLowerCase();
      if (!seen.has(key)) { seen.add(key); all.push(article); }
    }
  }
  diagnostics.push(
    guardianResult.status === 'fulfilled'
      ? { id: 'guardian-browser', label: 'Guardian browser fallback', status: resultStatusFromCount(resultRecentCount(guardianResult.value)), accepted: resultRecentCount(guardianResult.value) }
      : { id: 'guardian-browser', label: 'Guardian browser fallback', status: 'error', error: describeAppError(guardianResult.reason, 'Request failed') }
  );
  diagnostics.push(
    rssResult.status === 'fulfilled'
      ? { id: 'rss2json-browser', label: 'rss2json browser fallback', status: resultStatusFromCount(resultRecentCount(rssResult.value)), accepted: resultRecentCount(rssResult.value) }
      : { id: 'rss2json-browser', label: 'rss2json browser fallback', status: 'error', error: describeAppError(rssResult.reason, 'Request failed') }
  );
  const cutoff = Math.floor(Date.now() / 1000) - 72 * 60 * 60;
  all.sort((a, b) => b.pubTime - a.pubTime);
  return { articles: all.filter(a => a.pubTime >= cutoff).slice(0, 40), diagnostics };
}

function resultRecentCount(items = []) {
  if (!Array.isArray(items)) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - 72 * 60 * 60;
  return items.filter(item => (item?.pubTime || 0) >= cutoff).length;
}

function resultStatusFromCount(count) {
  return count > 0 ? 'ok' : 'empty';
}

function formatNewsFailureReason(serverError, fallbackError, serverReturnedEmpty = false, fallbackReturnedEmpty = false, serverDiagnostics = '', fallbackDiagnostics = '') {
  const serverMsg = serverError ? describeAppError(serverError, '') : '';
  const fallbackMsg = fallbackError ? describeAppError(fallbackError, '') : '';
  const serverExtra = serverDiagnostics ? ` Sources: ${serverDiagnostics}` : '';
  const fallbackExtra = fallbackDiagnostics ? ` Sources: ${fallbackDiagnostics}` : '';

  if (serverMsg && fallbackMsg) {
    return `Supabase news fetch failed (${serverMsg})${serverExtra} and browser feed fallback failed (${fallbackMsg})${fallbackExtra}.`;
  }
  if (serverMsg) {
    return `Supabase news fetch failed (${serverMsg}).${serverExtra}`;
  }
  if (fallbackMsg) {
    return `Browser feed fallback failed (${fallbackMsg}).${fallbackExtra}`;
  }
  if (serverReturnedEmpty && fallbackReturnedEmpty) {
    return `Both the Supabase news feed and browser fallback returned no recent articles.${serverExtra || fallbackExtra ? ` ${[serverExtra.trim(), fallbackExtra.trim()].filter(Boolean).join(' ')}` : ''}`.trim();
  }
  if (serverReturnedEmpty) {
    return `The Supabase news feed returned no recent articles.${serverExtra}`.trim();
  }
  if (fallbackReturnedEmpty) {
    return `The browser fallback returned no recent articles.${fallbackExtra}`.trim();
  }
  return `The live news providers did not return usable articles.${[serverExtra.trim(), fallbackExtra.trim()].filter(Boolean).join(' ')}`.trim();
}

function marketNewsSearchTerms(market = {}) {
  const terms = new Set();
  const ticker = String(market.ticker || '').trim().toUpperCase();
  const name = cleanNewsText(market.name || '');
  if (ticker && ticker.length > 1) terms.add(ticker);
  if (name) {
    terms.add(name);
    const simplified = name
      .replace(/\b(group|holdings?|inc\.?|corp\.?|corporation|plc|ltd\.?|limited|company|co\.?|class [ab])\b/gi, '')
      .replace(/[^\w\s&.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (simplified && simplified.length > 2) terms.add(simplified);
    simplified.split(/\s+/).filter(w => w.length > 4).forEach(w => terms.add(w));
  }
  const aliases = {
    SPX: ['S&P 500', 'S and P 500', 'US stocks', 'Wall Street'],
    NDX: ['Nasdaq', 'Nasdaq 100', 'tech stocks'],
    DJI: ['Dow Jones', 'Dow'],
    BTC: ['Bitcoin', 'BTC'],
    ETH: ['Ethereum', 'ETH'],
    XAU: ['Gold'],
    XAG: ['Silver'],
    CL1: ['Oil', 'Crude', 'WTI'],
    NG1: ['Natural gas'],
    HG1: ['Copper'],
  };
  (aliases[ticker] || []).forEach(term => terms.add(term));
  return [...terms].filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function newsTermMatches(text, term) {
  const cleanTerm = String(term || '').trim();
  if (cleanTerm.length <= 2) return false;
  const escaped = escapeRegExp(cleanTerm);
  const boundary = '[A-Za-z0-9]';
  if (/^[A-Za-z0-9&.-]+$/.test(cleanTerm)) {
    return new RegExp(`(^|[^${boundary.slice(1, -1)}])${escaped}([^${boundary.slice(1, -1)}]|$)`, 'i').test(text);
  }
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text);
}

function relatedNewsForMarket(market, limit = 3) {
  const source = (liveNews.length ? liveNews : STATIC_FALLBACK_NEWS).map(normalizeNewsArticle);
  const ticker = String(market?.ticker || '').toUpperCase();
  const terms = marketNewsSearchTerms(market);

  return source
    .map(article => {
      const text = `${article.title || ''} ${article.description || ''} ${(article.tickers || []).join(' ')}`;
      let score = 0;
      if ((article.tickers || []).map(t => String(t).toUpperCase()).includes(ticker)) score += 100;
      if (ticker && newsTermMatches(text, ticker)) score += 70;
      terms.forEach(term => {
        if (newsTermMatches(text, term)) score += term.includes(' ') ? 40 : 18;
      });
      return { article, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.article.pubTime || 0) - (a.article.pubTime || 0))
    .slice(0, limit)
    .map(item => item.article);
}

function renderMarketNewsSection(market) {
  const related = relatedNewsForMarket(market, 3);
  const sourceNote = newsSourceMode === 'fallback' ? 'Backup feed' : 'Recent news';
  return `
    <div class="sd-related-news" id="sd-related-news">
      <div class="sd-related-news-head">
        <div>
          <p class="sd-related-news-kicker">${sourceNote}</p>
          <h3>${escHtml(market.ticker)} news</h3>
        </div>
        ${newsLoadState === 'loading' ? '<span class="sd-related-news-state">Updating...</span>' : ''}
      </div>
      ${related.length ? `
        <div class="sd-related-news-list">
          ${related.map(article => {
            let idx = liveNews.findIndex(n => n.uuid === article.uuid);
            if (idx === -1) {
              liveNews.push(article);
              idx = liveNews.length - 1;
            }
            const catColor = CAT_COLORS[article.cat] || '#10b981';
            return `
              <button class="sd-related-news-item" onclick="openNewsArticle(${idx},true)">
                <span class="sd-related-news-cat" style="background:${catColor}22;color:${catColor}">${escHtml(article.cat || 'Markets')}</span>
                <span class="sd-related-news-title">${escHtml(article.title)}</span>
                <span class="sd-related-news-meta">${escHtml(article.publisher || 'News')} · ${escHtml(article.time || '')}</span>
              </button>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="sd-related-news-empty">
          No recent articles found for ${escHtml(market.name || market.ticker)} yet. Try the main News tab for broader market coverage.
        </div>
      `}
    </div>
  `;
}

function refreshMarketNewsSection(market) {
  const el = document.getElementById('sd-related-news');
  if (!el || !market) return;
  el.outerHTML = renderMarketNewsSection(market);
}

async function fetchLiveNews(force = false) {
  const now = Date.now();
  if (!force && liveNews.length && (now - newsLastFetched) < 5 * 60 * 1000) return;
  newsLoadState = 'loading';
  newsLoadError = '';
  newsLoadDetail = '';
  newsSourceMode = 'live';
  let serverError = null;
  let fallbackError = null;
  let serverReturnedEmpty = false;
  let fallbackReturnedEmpty = false;
  let serverDiagnostics = '';
  let fallbackDiagnostics = '';

  // 1. Try Supabase market-data function
  try {
    const d = await fetchMarketData('news', { count: 40 });
    if (d.success && d.articles && d.articles.length) {
      const cutoff72h = Math.floor(Date.now() / 1000) - 72 * 60 * 60;
      liveNews = d.articles.map(normalizeNewsArticle).filter(a => (a.pubTime || 0) >= cutoff72h).slice(0, 40);
      newsLastFetched = now;
      newsFetchedAt = new Date();
      newsLoadState = 'ready';
      newsSourceMode = 'live';
      newsLoadDetail = '';
      checkNewsAlertsForArticles(liveNews);
      renderNewsContent();
      if (currentDetailIdx !== null) refreshMarketNewsSection(MARKETS[currentDetailIdx]);
      return;
    }
    serverDiagnostics = summarizeNewsDiagnostics(d?.diagnostics?.sources);
    serverReturnedEmpty = true;
  } catch(e) {
    serverError = e;
  }

  // 2. Fall back to client-side RSS fetching (works regardless of server network)
  try {
    const fallbackResult = await fetchNewsClientSide();
    const articles = fallbackResult.articles || [];
    fallbackDiagnostics = summarizeNewsDiagnostics(fallbackResult.diagnostics);
    if (articles.length) {
      liveNews = articles.map(normalizeNewsArticle);
      newsLastFetched = now;
      newsFetchedAt = new Date();
      newsLoadState = 'ready';
      newsSourceMode = 'live';
      newsLoadDetail = serverError || serverReturnedEmpty
        ? formatNewsFailureReason(serverError, null, serverReturnedEmpty, false, serverDiagnostics, '')
        : '';
      checkNewsAlertsForArticles(liveNews);
      renderNewsContent();
      if (currentDetailIdx !== null) refreshMarketNewsSection(MARKETS[currentDetailIdx]);
      return;
    }
    fallbackReturnedEmpty = true;
  } catch(e) {
    fallbackError = e;
  }

  liveNews = STATIC_FALLBACK_NEWS.map(normalizeNewsArticle);
  newsLastFetched = now;
  newsFetchedAt = new Date();
  newsLoadState = 'ready';
  newsSourceMode = 'fallback';
  newsLoadError = 'Live news is temporarily unavailable. Showing a backup market briefing instead.';
  newsLoadDetail = formatNewsFailureReason(serverError, fallbackError, serverReturnedEmpty, fallbackReturnedEmpty, serverDiagnostics, fallbackDiagnostics);
  logAppIssue('news', `${newsLoadError} ${newsLoadDetail}`.trim(), 'warn');
  showTransientErrorNotice('news-feed', newsLoadDetail || newsLoadError, 45000);
  checkNewsAlertsForArticles(liveNews);
  renderNewsContent();
  if (currentDetailIdx !== null) refreshMarketNewsSection(MARKETS[currentDetailIdx]);
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
    <div class="section-title section-title-inline" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h2>News Feed</h2><p>Live market insights & analysis</p></div>
      <div class="news-head-actions" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <button onclick="openNewsAlertsModal()" title="Manage alerts"
          style="position:relative;display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--radius-xs);
                 background:${alertCount>0?'#ef444418':'var(--border)'};color:${alertCount>0?'var(--red)':'var(--muted)'};
                 font-size:11px;font-weight:600;border:none;cursor:pointer;transition:all .2s">
          ${iconMarkup('notification-01', 'inline-icon')} Alerts${alertCount > 0 ? ` <span style="background:#ef4444;color:#fff;border-radius:8px;padding:1px 5px;font-size:9px;font-weight:800">${alertCount}</span>` : ''}
        </button>
        <button class="news-refresh-btn" id="refresh-btn" onclick="refreshNews()" title="Refresh news">
          ${iconMarkup('refresh', 'inline-icon')} Refresh
        </button>
      </div>
    </div>
    <div class="filter-row">
      ${cats.map(c => `<button class="news-filter-btn ${newsFilter===c&&!myStocksActive&&!bookmarksActive?'active':''}" onclick="setNewsFilter('${c}')">${c}</button>`).join('')}
      <button class="news-filter-btn ${myStocksActive?'mystocks-active':''}" onclick="setNewsFilter('My Stocks')" title="Articles mentioning your portfolio & watchlist tickers">${starIcon('inline-star-icon')} My Stocks</button>
      <button class="news-filter-btn ${bookmarksActive?'bookmarks-active':''}" onclick="toggleNewsBookmarksView()">${bookmarkNewsIcon(bookmarksActive)} Bookmarks${Object.keys(bookmarkedArticles).length > 0 ? ' ('+Object.keys(bookmarkedArticles).length+')' : ''}</button>
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
  if (!liveNews.length && newsLoadState === 'error' && !newsShowBookmarks) {
    c.innerHTML = `
      <div class="error-box" style="margin-top:8px">
        <p style="font-weight:700;font-size:14px;color:#dc2626">News Unavailable</p>
        <p style="margin:6px 0 12px;font-size:13px;color:#b91c1c;line-height:1.5">${escHtml(newsLoadError)}</p>
        <button onclick="refreshNews()" style="background:var(--dark);color:#fff;border-radius:10px;padding:10px 18px;font-weight:700;font-size:13px">Retry News Feed</button>
      </div>`;
    return;
  }
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
  const sourceBadge = newsShowBookmarks ? bookmarkNewsIcon(true) : (newsSourceMode === 'fallback' ? 'Backup feed' : 'LIVE');
  const sourceNotice = newsSourceMode === 'fallback' && !newsShowBookmarks
    ? `<div style="margin-bottom:12px;padding:12px 14px;border-radius:14px;background:#f59e0b12;border:1px solid #f59e0b33;color:#9a6700;font-size:12px;line-height:1.5">
        <div>${escHtml(newsLoadError)}</div>
        ${newsLoadDetail ? `<div style="margin-top:6px;color:#8a5b00">Reason: ${escHtml(newsLoadDetail)}</div>` : ''}
      </div>`
    : '';

  const list = source;

  c.innerHTML = `
    ${sourceNotice}
    <div class="live-banner" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge">${sourceBadge}</span>
        <span style="font-weight:500;font-size:13px">${liveNews.length ? list.length + ' articles' : 'Loading…'}</span>
      </div>
      <span style="font-size:11px;color:rgba(255,255,255,0.7)">${lastUpdatedStr}</span>
    </div>
${list.length === 0 ? `<div style="text-align:center;padding:40px;color:var(--faint);font-size:13px">${newsShowBookmarks ? `No bookmarked articles yet - click ${bookmarkNewsIcon(false)} on any card to save it.` : 'No articles found'}</div>` : ''}
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
        <div class="meta">
          <span class="cat" style="background:${catColor}18;color:${catColor}">${n.cat}</span>
          <div style="display:flex;align-items:center;gap:5px">
            ${n.hot ? '<span>🔥</span>' : ''}
            <span style="font-size:11px;color:var(--faint)">${n.time}</span>
            <button class="news-bookmark-btn${isBookmarked?' saved':''}" title="${isBookmarked?'Remove bookmark':'Bookmark'}"
              onclick="event.stopPropagation();toggleNewsBookmark('${escHtml(n.uuid)}',${actualIdx})">${bookmarkNewsIcon(isBookmarked)}</button>
          </div>
        </div>
        <h3 style="${isRead?'color:var(--muted)':''}">${escHtml(n.title)}</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span class="news-source">${escHtml(n.publisher||'')}</span>
          <span style="font-size:11px;color:${isRead?'var(--faint)':'var(--green)'};font-weight:600">${isRead?'Read ✓':'Read more →'}</span>
        </div>
        <button onclick="event.stopPropagation();confirmAndAnalyzeNews(${actualIdx})"
          style="margin-top:8px;width:100%;padding:7px;border-radius:10px;background:#3b82f614;color:#2563eb;
                 font-size:11px;font-weight:700;border:1px solid #3b82f630;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s"
          onmouseenter="this.style.background='#3b82f622'" onmouseleave="this.style.background='#3b82f614'">
        ${iconMarkup('bot', 'btn-icon')} Analyze with FinBot
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
  if (!loadSettings().notifications) return;
  let changed = false;
  for (const article of articles) {
    if (!article.uuid) continue;
    const text = (article.title + ' ' + (article.description || '')).toLowerCase();
    for (const alert of newsAlerts) {
      if (text.includes(alert.keyword.toLowerCase())) {
        const articleTitle = cleanNewsText(article.title || 'A saved news alert matched a new article.');
        const dedupeKey = `news:${alert.keyword.toLowerCase().trim()}:${articleTitle.toLowerCase()}`;
        const noteId = `news:${alert.id}:${dedupeKey.replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
        if (!notificationCenter.some(n => n.id === noteId || notificationDedupeKey(n) === dedupeKey)) {
          addNotification({
            id: noteId,
            dedupeKey,
            type: 'news',
            title: `News alert: ${alert.keyword}`,
            body: articleTitle,
            articleUuid: article.uuid
          });
        }
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
            onclick="toggleNewsBookmark('${n.uuid ? escHtml(n.uuid) : ''}',${idx});this.innerHTML=bookmarkNewsIcon(!!bookmarkedArticles['${n.uuid ? escHtml(n.uuid) : ''}']);this.classList.toggle('saved',!!bookmarkedArticles['${n.uuid ? escHtml(n.uuid) : ''}']);this.title=bookmarkedArticles['${n.uuid ? escHtml(n.uuid) : ''}']?'Remove bookmark':'Bookmark this article'"
            style="font-size:18px">${bookmarkNewsIcon(isBookmarked)}</button>
        </div>
      </div>
      <div class="news-sheet-title">${escHtml(n.title)}</div>
      ${cleanTickers.length ? `<div class="news-sheet-tickers">${cleanTickers.map(t=>`<span class="news-ticker-chip">${escHtml(t)}</span>`).join('')}</div>` : ''}
      <div id="news-body-box" style="margin:14px 0 16px">${bodyHtml}</div>
      <p style="font-size:11.5px;color:var(--faint);text-align:center;margin-bottom:8px">${iconMarkup('bolt', 'inline-icon')} This analysis uses <strong style="color:var(--text)">2 credits</strong></p>
      <button onclick="confirmAndAnalyzeNews(${idx})"
        style="width:100%;padding:14px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#3b82f6,#2563eb);
               color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;margin-bottom:10px;
               display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s"
        onmouseenter="this.style.opacity='.9'" onmouseleave="this.style.opacity='1'">
        ${iconMarkup('bot', 'btn-icon')} Analyze with FinBot
      </button>
      <a class="news-btn-primary" href="${escHtml(articleLink)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">
        Read Full Article on ${escHtml(n.publisher || 'Publisher')} ${iconMarkup('external-link', 'inline-icon')}
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

  fetchMarketData('article', { url: n.link })
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
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);
                  display:flex;align-items:center;justify-content:center;font-size:24px">🤖</div>
      <p style="font-weight:800;font-size:16px;color:var(--text)">Analyzing article…</p>
      <p style="font-size:12px;color:var(--faint);text-align:center;line-height:1.6">FinBot is reading and breaking down<br>this article for you</p>
      <div class="loading-dots" style="margin-top:4px">
        ${[0,1,2].map(i=>`<span style="background:#3b82f6;animation:bd 1.4s ease-in-out ${i*0.2}s infinite"></span>`).join('')}
      </div>
    </div>`;

  try {
    const data = await invokeFinBotFunction({ prompt, request_type: 'news' });
    if (data.error) throw new Error(data.error);
    if (data.credits_remaining !== undefined && currentUser) {
      currentUser.finbot_credits = data.credits_remaining;
      updateHeaderUser();
    }
    const text = data.text ?? '';
    finbotNewsState.result = text;
    renderFinBotNewsResult(idx, text, articleLink, n);
  } catch (e) {
    const message = describeAppError(e, 'Please try again.');
    content.innerHTML = `
      <div style="padding:20px">
        <div class="error-box">
          <p style="font-weight:700;font-size:14px;color:#dc2626">Analysis Failed</p>
          <p style="margin:6px 0 12px;font-size:13px;color:#b91c1c;line-height:1.5">${escHtml(message)}</p>
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
        🤖
        <div>
          <p style="font-weight:800;font-size:14px;color:var(--text)">FinBot Analysis</p>
          <p style="font-size:11px;color:#2563eb;font-weight:600">AI Financial Analyst</p>
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
          style="width:100%;padding:13px;border-radius:12px;${isSaved ? 'background:#10b98122;color:#10b981;border:1.5px solid #10b981' : 'background:#3b82f618;color:#2563eb;border:1.5px solid #3b82f640'};
                 font-size:13px;font-weight:700;cursor:pointer;transition:all .2s">
          ${isSaved ? '🔖 View in Saved Reports →' : '🔖 Save Report'}
        </button>
        <a href="${escHtml(articleLink)}" target="_blank" rel="noopener"
          style="width:100%;padding:13px;border-radius:12px;background:var(--green);color:#fff;
                 font-size:13px;font-weight:700;text-align:center;text-decoration:none;display:block;box-sizing:border-box">
        Read Full Article on ${escHtml(n.publisher || 'Publisher')} ${iconMarkup('external-link', 'inline-icon')}
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
    modeCol:      '#2563eb',
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
      const unitUsd = mkt ? marketNativeToUsd(mkt, mkt.val) : h.avg_cost;
      return s + unitUsd * h.shares;
    }, 0);
    dbPortfolio.forEach(h => {
      const mkt = MARKETS.find(x => x.ticker === h.ticker);
      const unitUsd = mkt ? marketNativeToUsd(mkt, mkt.val) : h.avg_cost;
      const val = unitUsd * h.shares;
      portfolioMap[h.ticker] = totalValue > 0 ? (val / totalValue * 100).toFixed(1) : '0.0';
    });
  }

  document.getElementById('tab-markets').innerHTML = `
    <div class="section-title markets-title">
      <div><h2>Markets</h2><p>Tap any asset for detailed charts & stats</p></div>
      <button class="compare-toggle-btn ${compareMode?'on':'off'}" onclick="toggleCompareMode()">
        ${compareMode ? '✕ Exit Compare' : '⇄ Compare'}
      </button>
    </div>

    ${marketsLoadError ? `
      <div class="error-box" style="margin-bottom:12px;background:#f59e0b12;border-color:#f59e0b44">
        <p style="font-weight:700;font-size:14px;color:#f59e0b">Live Market Data Delayed</p>
        <p style="margin:6px 0 0;font-size:13px;color:#fbbf24;line-height:1.5">${escHtml(marketsLoadError)}</p>
      </div>
    ` : ''}

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
        <p style="font-size:32px;margin-bottom:12px">${iconMarkup('star')}</p>
        <p style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:6px">No watchlist items</p>
        <p style="font-size:12px;color:var(--faint)">Tap the ${iconMarkup('star', 'inline-icon')} star on any asset tile to add it to your watchlist.</p>
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
               class="market-star-btn ${starred ? 'active' : ''}"
               title="${starred?'Remove from watchlist':'Add to watchlist'}">${starIcon('market-star-icon')}</button>`
          : '';
        const bellBtn = currentUser && !compareMode
          ? `<button class="alert-bell${hasAlert?' active':''}" onclick="event.stopPropagation();openAlertModal('${m.ticker}','${m.name.replace(/'/g,"\\'")}',${m.val})"
               title="${hasAlert?'Manage alerts':'Set price alert'}">${marketAlertIcon(hasAlert)}</button>`
          : '';
        const overlapBadge = overlapPct
          ? `<div class="overlap-badge" title="In Portfolio · ${overlapPct}%"><span class="overlap-badge-full">In Portfolio · ${overlapPct}%</span><span class="overlap-badge-mobile">In Portfolio</span></div>`
          : '';

        return `
          <div class="market-tile${inCompare?' compare-selected':''}${overlapPct || starBtn || bellBtn ? ' has-top-meta' : ''}" onclick="${compareMode?`toggleCompareAsset('${m.ticker}')`:`openStockDetail(${globalIdx})`}" style="position:relative">
            ${overlapBadge}
            ${starBtn || bellBtn ? `<div class="market-tile-actions">${bellBtn}${starBtn}</div>` : ''}
            <p class="ticker">${m.ticker}</p>
            <p class="name">${m.name}</p>
            <p class="price">${fmtMarketUnitPrice(m)}</p>
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

function rescaleMarketCharts(market, nextPrice) {
  const oldPrice = Number(market?.val || 0);
  const newPrice = Number(nextPrice || 0);
  if (!oldPrice || !newPrice || !market?.charts) return;
  const factor = newPrice / oldPrice;
  TIMEFRAMES.forEach(tf => {
    if (!Array.isArray(market.charts[tf])) return;
    market.charts[tf] = market.charts[tf].map(point => ({ ...point, value: Number((point.value * factor).toFixed(4)) }));
  });
  market._initVal = Number((Number(market._initVal || oldPrice) * factor).toFixed(4));
}

// ── Live data helpers ─────────────────────────────────────────────────────────
async function fetchLivePrices() {
  const tickers = MARKETS.map(marketDataTicker).filter(Boolean).join(',');
  try {
    const d = await fetchMarketData('quotes', { tickers });
    if (!d.success) throw new Error(d.error || 'Live quotes are unavailable right now.');
    marketsLoadError = '';
    let updated = false;
    MARKETS.forEach(m => {
      const q = d.quotes[marketDataTicker(m)] || d.quotes[m.ticker];
      if (q && q.price) {
        // Reject if live price is implausible vs. the known initial value.
        // Catches Yahoo Finance data cross-contamination (e.g. ETH-USD returning
        // Ethan Allen ~$22 instead of Ethereum ~$3892 — a 99.4% deviation).
        const ratio = q.price / m._initVal;
        if (ratio < 0.2 || ratio > 5) return; // discard obvious cross-listed/currency contamination
        rescaleMarketCharts(m, q.price);
        m.val = q.price; m.chg = q.chg ?? m.chg;
        if (q.hi52) m.hi52 = String(q.hi52);
        if (q.lo52) m.lo52 = String(q.lo52);
        updated = true;
      }
    });
    if (updated) {
      marketsLoadError = '';
      clearAppIssues('market-data');
      const tab = document.getElementById('tab-markets');
      if (tab && tab.classList.contains('active')) renderMarkets();
      renderMarketTickerTape();
      checkAlerts();
    }
    renderNavPulse();
  } catch(e) {
    marketsLoadError = 'Live prices are temporarily unavailable. Showing the last known market snapshot.';
    logAppIssue('market-data', describeAppError(e, marketsLoadError), 'warn');
    const tab = document.getElementById('tab-markets');
    if (tab && tab.classList.contains('active')) renderMarkets();
    showTransientErrorNotice('market-prices', describeAppError(e, marketsLoadError));
  }
}

async function fetchLiveChart(ticker, tf, callback) {
  try {
    const d = await fetchMarketData('chart', { ticker, tf });
    if (d.success && d.points && d.points.length > 1) callback(sanitizeLiveChartPoints(ticker, tf, d.points));
  } catch(e) { /* silent fallback */ }
}

function shouldUseLiveDetailCharts(stock) {
  return Boolean(stock);
}

function sanitizeLiveChartPoints(ticker, tf, points) {
  if (!Array.isArray(points) || points.length < 3 || tf !== '1D') return points;
  const market = MARKETS.find(m => marketDataTicker(m) === ticker || m.ticker === ticker);
  if (!market || market.exchange !== 'JSE') return points;

  const getSaInfo = (unixTime) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false
    }).formatToParts(new Date(unixTime * 1000));
    const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return {
      dateKey: `${map.year}-${map.month}-${map.day}`,
      weekday: map.weekday,
      minutes: Number(map.hour || 0) * 60 + Number(map.minute || 0)
    };
  };

  const grouped = new Map();
  points.forEach(point => {
    const info = getSaInfo(point.time);
    if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(info.weekday)) return;
    if (info.minutes < 9 * 60 || info.minutes > 17 * 60 + 10) return;
    if (!grouped.has(info.dateKey)) grouped.set(info.dateKey, []);
    grouped.get(info.dateKey).push(point);
  });

  const latestDate = [...grouped.keys()].sort().pop();
  const cleaned = latestDate && grouped.get(latestDate)?.length > 1 ? grouped.get(latestDate).slice() : points.slice();

  while (cleaned.length >= 3) {
    const last = cleaned[cleaned.length - 1];
    const prev = cleaned[cleaned.length - 2];
    const prevPrev = cleaned[cleaned.length - 3];
    if (!last?.value || !prev?.value || !prevPrev?.value) break;

    const baselineMove = Math.abs((prev.value - prevPrev.value) / prevPrev.value);
    const lastMove = Math.abs((last.value - prev.value) / prev.value);

    if (lastMove > 0.035 && lastMove > Math.max(0.01, baselineMove * 4)) {
      cleaned.pop();
      continue;
    }
    break;
  }
  return cleaned;
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
  document.body.classList.add('stock-detail-open');
  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;

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
        <p id="sd-live-price" class="mono" style="font-size:24px;font-weight:700;color:#fff">${fmtMarketUnitPrice(stock)}</p>
        <span id="sd-live-change" style="font-size:13px;font-weight:700;color:${color}">${up?'▲':'▼'} ${Math.abs(stock.chg).toFixed(2)}% today</span>
      </div>
    </div>

    <div class="sd-chart" id="sd-chart-canvas"></div>
    <div class="sd-timeframes">
      ${TIMEFRAMES.map(tf => `<button class="tf-btn ${tf==='1D'?(up?'active-up':'active-dn'):''}" style="min-width:0;width:100%;padding:8px 4px;font-size:11px;border-radius:8px" onclick="switchDetailTF(${idx},'${tf}')">${tf}</button>`).join('')}
    </div>

    ${renderMarketNewsSection(stock)}

    <!-- 52-week range bar -->
    <div style="padding:16px 20px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">52-Week Range</span>
        <span id="sd-range-pct" style="font-size:10px;font-weight:700;color:#94a3b8;font-family:var(--mono)">${rangePct}% of range</span>
      </div>
      <div style="height:5px;background:#1e293b;border-radius:4px;position:relative">
        <div id="sd-range-fill" style="position:absolute;left:0;width:${rangePct}%;height:100%;background:linear-gradient(90deg,${color}50,${color});border-radius:4px"></div>
        <div id="sd-range-dot" style="position:absolute;left:${rangePct}%;transform:translateX(-50%);top:-4px;width:12px;height:12px;background:${color};border-radius:50%;border:2px solid #0c1320;box-shadow:0 0 6px ${color}80"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:11px;color:#64748b;font-family:var(--mono)">${fmtMarketUnitPrice(stock, parseFloat(stock.lo52))}</span>
        <span style="font-size:11px;color:#64748b;font-family:var(--mono)">${fmtMarketUnitPrice(stock, parseFloat(stock.hi52))}</span>
      </div>
    </div>

    <!-- Key stats grid -->
    <div class="sd-stats">
      ${[
        {l:'Market Cap',  v:stock.mktcap || '—', c:''},
        {l:'P/E Ratio',   v:stock.pe     || '—', c:''},
        {l:'Volume',      v:stock.vol    || '—', c:''},
        {l:'52W High',    v:fmtMarketUnitPrice(stock, parseFloat(stock.hi52)), c:'#10b981'},
        {l:'52W Low',     v:fmtMarketUnitPrice(stock, parseFloat(stock.lo52)), c:'#ef4444'},
        {l:'Day Change',  v:(stock.chg>0?'+':'')+stock.chg+'%', c:color, id:'sd-stat-day-change'},
      ].map(s => `<div class="stat-box">
        <p class="label">${s.l}</p>
        <p ${s.id ? `id="${s.id}"` : ''} class="val" style="${s.c?'color:'+s.c:''}">${s.v}</p>
      </div>`).join('')}
    </div>

    <!-- Timeframe performance -->
    <div style="padding:10px 20px 16px">
      <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Performance</p>
      <div class="sd-performance-row" style="display:flex;gap:8px">
        ${returns.map(({tf, r}) => {
          if (r === null) return '';
          const pos = parseFloat(r) >= 0;
          return `<div class="sd-performance-card" style="flex:1;background:#1e293b;border:1px solid #ffffff0a;border-radius:10px;padding:10px 6px;text-align:center">
            <p style="font-size:10px;color:#64748b;margin-bottom:4px;font-weight:600">${tf}</p>
            <p style="font-size:12px;font-weight:800;font-family:var(--mono);color:${pos?'#10b981':'#ef4444'}">${pos?'+':''}${r}%</p>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Add to watchlist + portfolio + alert -->
    <div style="padding:0 20px 28px;display:flex;flex-direction:column;gap:10px">
      ${stock.exchange === 'JSE' ? `<div style="padding:8px 12px;border-radius:10px;background:#f59e0b14;border:1px solid #f59e0b30;text-align:center">
        <p style="font-size:11px;color:#f59e0b;font-weight:700">🇿🇦 JSE Listed · Prices in ZAR (R)</p>
      </div>` : ''}
      ${currentUser ? `<div class="sd-actions-row" style="display:flex;gap:10px">
        <button onclick="toggleWatchlist('${stock.ticker}','${stock.name.replace(/'/g,"\\'")}')"
          style="flex:1;padding:13px;border-radius:13px;background:${watchlistSet.has(stock.ticker)?'#10b98118':'#1e293b'};border:1.5px solid ${watchlistSet.has(stock.ticker)?'#10b981':'#ffffff0a'};font-size:13px;font-weight:700;color:${watchlistSet.has(stock.ticker)?'#10b981':'#64748b'};cursor:pointer;transition:all .2s">
          ${starIcon('inline-star-icon')} Watchlist
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
      detailChart = createFullChart(el, marketChartData(stock, stock.charts['1D']), color, 300, marketChartCurrency(stock));
    }
    syncStockDetailSummary(stock, stock.charts['1D']);
    // Replace with live data as soon as it arrives
    if (shouldUseLiveDetailCharts(stock)) {
      fetchLiveChart(marketDataTicker(stock), '1D', points => {
        // Sanity-check against the known initial price (not stock.val which may itself be wrong).
        const last = points[points.length - 1]?.value;
        const ratio = last / stock._initVal;
        if (!last || !stock._initVal || ratio < 0.2 || ratio > 5) return;
        stock.charts['1D'] = points;
        syncStockDetailSummary(stock, points);
        const el2 = document.getElementById('sd-chart-canvas');
        if (el2) { if (detailChart) detailChart.remove(); detailChart = createFullChart(el2, marketChartData(stock, points), color, 300, marketChartCurrency(stock)); }
      });
    }
  });
  if ((!liveNews.length || (Date.now() - newsLastFetched) > 5 * 60 * 1000) && newsLoadState !== 'loading') {
    fetchLiveNews();
  }
}

function syncStockDetailSummary(stock, points) {
  if (currentDetailIdx === null || !Array.isArray(points) || points.length < 2) return;

  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const hi52n = parseFloat(stock.hi52);
  const lo52n = parseFloat(stock.lo52);
  if (!first || !last) return;

  const dayChange = ((last - first) / first) * 100;
  const up = dayChange >= 0;
  const color = up ? '#10b981' : '#ef4444';
  const rangePct = hi52n > lo52n
    ? Math.max(0, Math.min(100, Math.round((last - lo52n) / (hi52n - lo52n) * 100)))
    : 50;

  stock.val = last;
  stock.chg = parseFloat(dayChange.toFixed(2));

  const priceEl = document.getElementById('sd-live-price');
  const changeEl = document.getElementById('sd-live-change');
  const statEl = document.getElementById('sd-stat-day-change');
  const rangePctEl = document.getElementById('sd-range-pct');
  const rangeFillEl = document.getElementById('sd-range-fill');
  const rangeDotEl = document.getElementById('sd-range-dot');

  if (priceEl) priceEl.textContent = fmtMarketUnitPrice(stock, last);
  if (changeEl) {
    changeEl.textContent = `${up ? '▲' : '▼'} ${Math.abs(dayChange).toFixed(2)}% today`;
    changeEl.style.color = color;
  }
  if (statEl) {
    statEl.textContent = `${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(2)}%`;
    statEl.style.color = color;
  }
  if (rangePctEl) rangePctEl.textContent = `${rangePct}% of range`;
  if (rangeFillEl) rangeFillEl.style.width = `${rangePct}%`;
  if (rangeDotEl) rangeDotEl.style.left = `${rangePct}%`;
}

function switchDetailTF(idx, tf) {
  const stock = MARKETS[idx];
  const up = stock.chg >= 0;
  const color = up ? '#10b981' : '#ef4444';

  document.querySelectorAll('.tf-btn').forEach(b => {
    b.className = 'tf-btn' + (b.textContent === tf ? (up ? ' active-up' : ' active-dn') : '');
    b.style.minWidth = '0';
    b.style.width = '100%';
    b.style.padding = '8px 4px';
    b.style.fontSize = '11px';
    b.style.borderRadius = '8px';
  });

  requestAnimationFrame(() => {
    const el = document.getElementById('sd-chart-canvas');
    if (el) {
      if (detailChart) detailChart.remove();
      detailChart = createFullChart(el, marketChartData(stock, stock.charts[tf]), color, 300, marketChartCurrency(stock));
    }
    if (shouldUseLiveDetailCharts(stock)) {
      fetchLiveChart(marketDataTicker(stock), tf, points => {
        const last = points[points.length - 1]?.value;
        const ratio = last / stock._initVal;
        if (!last || !stock._initVal || ratio < 0.2 || ratio > 5) return;
        stock.charts[tf] = points;
        if (tf === '1D') syncStockDetailSummary(stock, points);
        const el2 = document.getElementById('sd-chart-canvas');
        if (el2) { if (detailChart) detailChart.remove(); detailChart = createFullChart(el2, marketChartData(stock, points), color, 300, marketChartCurrency(stock)); }
      });
    }
  });
}

function closeStockDetail() {
  document.getElementById('stock-detail').classList.add('hidden');
  document.body.classList.remove('stock-detail-open');
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
    const d = await dataRequest('price_alerts');
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
  const market = MARKETS.find(m => m.ticker === ticker);
  document.getElementById('alert-ticker').value = ticker;
  document.getElementById('alert-ticker-name').value = name;
  document.getElementById('alert-modal-title').innerHTML = `${iconMarkup('notification-01', 'alert-title-icon')} Alert - ${escHtml(ticker)}`;
  document.getElementById('alert-modal-sub').textContent = 'Current price: ' + fmtMarketUnitPrice(market, currentPrice);
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

function displayPriceToBasePrice(price) {
  const rate = curCfg().rate || 1;
  return Number(price) / rate;
}

function displayPriceToMarketPrice(price, ticker) {
  const market = MARKETS.find(m => m.ticker === ticker);
  if (marketCurrency(market) !== 'USD') return Number(price);
  return displayPriceToBasePrice(price);
}

function normalizedAlertTarget(alert, ticker) {
  const rawTarget = Number(alert?.target);
  if (!Number.isFinite(rawTarget) || rawTarget <= 0) return rawTarget;

  const rate = curCfg().rate || 1;
  const market = MARKETS.find(m => m.ticker === ticker);
  if (marketCurrency(market) !== 'USD') return rawTarget;
  if (rate === 1 || !market?.val) return rawTarget;

  const converted = rawTarget / rate;
  const looksLikeDisplayCurrency =
    rawTarget > market.val * 5 &&
    converted > market.val * 0.05 &&
    converted < market.val * 20;

  return looksLikeDisplayCurrency ? converted : rawTarget;
}

function renderAlertList(ticker) {
  const list = document.getElementById('alert-list');
  const alerts = alertsMap[ticker] || [];
  if (!alerts.length) { list.innerHTML = ''; return; }
  list.innerHTML = alerts.map(a => `
    <div class="alert-item">
      <span class="alert-txt">${iconMarkup(a.direction === 'above' ? 'trend-up' : 'trend-down', 'inline-icon')} ${a.direction === 'above' ? 'Above' : 'Below'} ${fmtMarketUnitPrice(MARKETS.find(m => m.ticker === ticker), normalizedAlertTarget(a, ticker))}${a.triggered ? ` ${iconMarkup('check', 'inline-icon')}` : ''}</span>
      <button class="alert-del" onclick="deleteAlert(${a.id},'${ticker}')" title="Delete">${closeIcon('inline-icon')}</button>
    </div>`).join('');
}

async function saveAlert() {
  const ticker = document.getElementById('alert-ticker').value;
  const name   = document.getElementById('alert-ticker-name').value;
  const displayTarget = parseFloat(document.getElementById('alert-target').value);
  const target = displayPriceToMarketPrice(displayTarget, ticker);
  if (!ticker || !target || isNaN(target) || target <= 0) { showToast('Enter a valid target price'); return; }
  try {
    const d = await dataRequest('price_alerts', 'POST', { ticker, name, target, direction: alertDirection });
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
    await dataRequest('price_alerts', 'DELETE', { id });
    if (alertsMap[ticker]) alertsMap[ticker] = alertsMap[ticker].filter(a => a.id !== id);
    renderAlertList(ticker);
    showToast('Alert removed');
  } catch(e) {}
}

function checkAlerts() {
  if (!currentUser || !Object.keys(alertsMap).length) return;
  if (!loadSettings().priceAlerts) return;
  MARKETS.forEach(m => {
    const alerts = alertsMap[m.ticker];
    if (!alerts) return;
    alerts.forEach(a => {
      if (a.triggered) return;
      const target = normalizedAlertTarget(a, m.ticker);
      const hit = (a.direction === 'above' && m.val >= target) || (a.direction === 'below' && m.val <= target);
      if (hit) {
        a.triggered = true;
        const alertText = `${m.ticker} ${a.direction === 'above' ? 'crossed above' : 'dropped below'} ${fmtMarketUnitPrice(m, target)}!`;
        showToast(alertText, 5000);
        addNotification({
          id: `price:${a.id}`,
          type: 'price',
          title: `${m.ticker} price alert`,
          body: alertText,
          ticker: m.ticker
        });
        dataRequest('price_alerts', 'PUT', { id: a.id }).catch(() => {});
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
      const fmt = { type:'custom', formatter: v => fmtMarketUnitPrice(stock, v) };
      [{ d: boll.upper, c: '#f59e0b60' }, { d: boll.mid, c: '#f59e0b' }, { d: boll.lower, c: '#f59e0b60' }].forEach(({d,c}) => {
        const s = detailChart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt });
        s.setData(marketChartData(stock, d));
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
// FINBOT TAB
// ═══════════════════════════════════════════════════════════════════════════

let finbotState = { mode: null, loading: false, result: null, error: null, savedId: null };
const FINBOT_CHAT_LIBRARY = {
  beginner: {
    label: 'Getting Started',
    questions: [
      'What 3 things should I check before buying a stock?',
      'Explain ETFs vs individual stocks in simple terms',
      'How should I think about diversification as a beginner?',
      'What does a good long-term portfolio usually include?',
      'How much cash should I keep before I start investing?',
      'What mistakes do first-time investors make most often?',
    ],
  },
  portfolio: {
    label: 'Portfolio Help',
    questions: [
      'How should I split money between ETFs, stocks, and cash?',
      'When should I rebalance a portfolio?',
      'How do I know if my portfolio is too concentrated?',
      'What is a simple portfolio for long-term wealth building?',
      'How can I reduce risk without killing growth?',
      'What role should international exposure play in a portfolio?',
    ],
  },
  stocks: {
    label: 'Stocks & ETFs',
    questions: [
      'How do I quickly judge whether a stock is expensive?',
      'What makes an ETF good for long-term investing?',
      'What numbers matter most in an earnings report?',
      'How should I compare two stocks in the same sector?',
      'What makes a company have a strong moat?',
      'What are good signs of financial strength in a business?',
    ],
  },
  risk: {
    label: 'Risk & Strategy',
    questions: [
      'How do I think about downside risk before buying?',
      'What is the difference between volatility and real risk?',
      'How should I manage position sizing?',
      'What is a sensible stop-loss strategy for beginners?',
      'How do I invest during uncertain markets?',
      'What should I do if one holding grows too large?',
    ],
  },
  market: {
    label: 'Market & News',
    questions: [
      'How should I read market news without overreacting?',
      'What actually moves stock prices in the short term?',
      'How do interest rates affect stocks and bonds?',
      'Why does inflation matter for investors?',
      'What should I watch when markets are very volatile?',
      'How do macro events affect my portfolio?',
    ],
  },
};
const FINBOT_CHAT_WELCOME = `Hi, I'm FinBot. Ask me a market, investing, or portfolio question and I'll give you a quick educational take.`;
let finbotChatState = {
  messages: [{ role: 'assistant', text: FINBOT_CHAT_WELCOME }],
  input: '',
  loading: false,
  error: null,
  category: 'beginner',
};
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
      const priceData = await fetchMarketData('quotes', { tickers: finbotForm.techTicker });
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
    const data = await invokeFinBotFunction({ ...buildFinBotPrompt(modeId), mode: modeId, request_type: 'finbot' });
    if (data.error) {
      if (data.code === 'upgrade_required') { finbotState.error = 'upgrade_required'; finbotState.loading = false; renderFinBot(); return; }
      if (data.code === 'no_credits')       { if (currentUser) currentUser.finbot_credits = 0; finbotState.error = 'no_credits'; finbotState.loading = false; renderFinBot(); return; }
      throw new Error(data.error || 'FinBot could not complete the analysis.');
    }
    if (data.credits_remaining !== undefined && currentUser) {
      currentUser.finbot_credits = data.credits_remaining;
      updateHeaderUser();
    }
    finbotState.result = data.text ?? '';
  } catch (e) {
    finbotState.error = describeAppError(e, 'Analysis failed. Please try again.');
  }

  finbotState.loading = false;
  renderFinBot();
}

function setFinbotMode(id) { finbotState.mode = id; finbotState.fromSaved = false; renderFinBot(); }
function resetFinBot() { finbotState = { mode: null, loading: false, result: null, error: null, savedId: null, fromSaved: false }; renderFinBot(); }
function backFromFinBotResult() {
  if (finbotState.fromSaved) {
    finbotState.result = null; finbotState.error = null; finbotState.savedId = null; finbotState.fromSaved = false;
    switchTab('saved');
  } else {
    finbotState.result = null; finbotState.error = null;
    renderFinBot();
  }
}

function updateFormField(field, value) { finbotForm[field] = value; renderFinBot(); }

function resetFinBotChat() {
  finbotChatState = {
    messages: [{ role: 'assistant', text: FINBOT_CHAT_WELCOME }],
    input: '',
    loading: false,
    error: null,
    category: 'beginner',
  };
}

function setFinBotChatInput(value) {
  finbotChatState.input = value;
}

function setFinBotChatCategory(category) {
  if (!FINBOT_CHAT_LIBRARY[category]) return;
  finbotChatState.category = category;
  renderFinBot();
}

function finBotChatHistoryPayload() {
  const history = finbotChatState.messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.text && m.text !== FINBOT_CHAT_WELCOME)
    .slice(-8)
    .map(m => ({ role: m.role, content: m.text }));
  return history;
}

async function sendFinBotChat(prefilled = '') {
  if (!currentUser) {
    document.getElementById('auth-overlay')?.classList.remove('hidden');
    showAuthTab('login');
    return;
  }
  if ((currentUser.finbot_credits ?? 0) <= 0) {
    showToast('⚡ You need at least 1 credit to chat with FinBot.');
    renderFinBot();
    return;
  }
  if (finbotChatState.loading) return;

  const message = String(prefilled || finbotChatState.input || '').trim();
  if (!message) {
    showToast('Type a question for FinBot first.');
    return;
  }
  const historyPayload = finBotChatHistoryPayload();

  finbotChatState.error = null;
  finbotChatState.loading = true;
  finbotChatState.input = '';
  finbotChatState.messages.push({ role: 'user', text: message });
  renderFinBot();

  try {
    const data = await invokeFinBotFunction({
      request_type: 'chat',
      mode: 'chat',
      prompt: message,
      history: historyPayload,
    });
    if (data.error) {
      if (data.code === 'upgrade_required') {
        throw new Error('FinBot chat requires a Pro or Enterprise plan.');
      }
      if (data.code === 'no_credits') {
        if (currentUser) currentUser.finbot_credits = Number(data.credits_remaining ?? 0);
        throw new Error('You are out of FinBot credits.');
      }
      throw new Error(data.error || 'FinBot chat is unavailable right now.');
    }
    if (data.credits_remaining !== undefined && currentUser) {
      currentUser.finbot_credits = data.credits_remaining;
      updateHeaderUser();
    }
    finbotChatState.messages.push({
      role: 'assistant',
      text: String(data.text || 'I could not generate a response just now.'),
    });
  } catch (e) {
    finbotChatState.error = e.message || 'FinBot chat failed. Please try again.';
  }

  finbotChatState.loading = false;
  renderFinBot();
  requestAnimationFrame(() => {
    const body = document.getElementById('finbot-chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  });
}

function onFinBotChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendFinBotChat();
  }
}

function renderFinBotChatPanel() {
  const credits = currentUser?.finbot_credits ?? 0;
  const activeCategory = FINBOT_CHAT_LIBRARY[finbotChatState.category] ? finbotChatState.category : 'beginner';
  const activeGroup = FINBOT_CHAT_LIBRARY[activeCategory];
  return `
    <div class="finbot-chat-card">
      <div class="finbot-chat-head">
        <div>
          <p class="finbot-chat-kicker">New</p>
          <h3>Quick Chat with FinBot</h3>
          <p class="finbot-chat-sub">Pick a category, tap a ready-made question, or type your own. Most people should be able to start without writing from scratch.</p>
        </div>
        <div class="finbot-chat-credit">⚡ 1 credit / message</div>
      </div>
      <div class="finbot-chat-categories">
        ${Object.entries(FINBOT_CHAT_LIBRARY).map(([key, group]) => `
          <button class="finbot-chat-category ${key === activeCategory ? 'active' : ''}" onclick="setFinBotChatCategory('${key}')">${group.label}</button>
        `).join('')}
      </div>
      <div class="finbot-chat-starters">
        ${activeGroup.questions.map(prompt => `
          <button class="finbot-chat-starter" onclick="sendFinBotChat(${JSON.stringify(prompt).replace(/"/g, '&quot;')})">${escHtml(prompt)}</button>
        `).join('')}
      </div>
      <div class="finbot-chat-body" id="finbot-chat-body">
        ${finbotChatState.messages.map(m => `
          <div class="finbot-chat-msg ${m.role}">
            <div class="finbot-chat-avatar">${m.role === 'assistant' ? iconMarkup('bot', 'finbot-avatar-icon') : 'You'}</div>
            <div class="finbot-chat-bubble">
              ${m.role === 'assistant' ? parseMd(m.text) : `<p>${escHtml(m.text)}</p>`}
            </div>
          </div>
        `).join('')}
        ${finbotChatState.loading ? `
          <div class="finbot-chat-msg assistant">
            <div class="finbot-chat-avatar">${iconMarkup('bot', 'finbot-avatar-icon')}</div>
            <div class="finbot-chat-bubble finbot-chat-thinking">
              <span></span><span></span><span></span>
            </div>
          </div>
        ` : ''}
      </div>
      ${finbotChatState.error ? `<div class="finbot-chat-error">${escHtml(finbotChatState.error)}</div>` : ''}
      <div class="finbot-chat-compose">
        <textarea id="finbot-chat-input" class="finbot-chat-input" rows="2"
          placeholder="Ask about diversification, stock research, risk, ETFs, market terms..."
          oninput="setFinBotChatInput(this.value)"
          onkeydown="onFinBotChatKeydown(event)">${escHtml(finbotChatState.input)}</textarea>
        <div class="finbot-chat-actions">
          <span class="finbot-chat-credits-left">${credits} credit${credits === 1 ? '' : 's'} left</span>
          <button class="finbot-chat-send" onclick="sendFinBotChat()" ${finbotChatState.loading || credits <= 0 ? 'disabled' : ''}>
            ${finbotChatState.loading ? 'Thinking…' : 'Send →'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderFinBot() {
  const el = document.getElementById('tab-finbot');
  const mode = finbotState.mode;
  const modeObj = FINBOT_MODES.find(m => m.id === mode);

  // ── Guest wall ──
  if (!currentUser) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 24px">
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#3b82f6,#2563eb);
                    display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:16px">${iconMarkup('bot', 'finbot-hero-icon')}</div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Meet FinBot</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:300px;margin-bottom:24px">
          Your personal AI financial analyst. Run deep analysis on stocks, portfolios, news, and more — all in seconds.
        </p>
        <button onclick="document.getElementById('auth-overlay').classList.remove('hidden');showAuthTab('login')"
          style="padding:14px 32px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;
                 font-size:14px;font-weight:800;border:none;cursor:pointer;margin-bottom:32px;width:100%;max-width:320px">
          Sign In to Use FinBot
        </button>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;padding:0 4px">6 Analysis Modes</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" style="opacity:.6;cursor:default;border-color:var(--border);pointer-events:none">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${iconMarkup(m.icon, 'mode-icon-glyph')}</div>
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
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#3b82f6,#2563eb);
                    display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:16px">${iconMarkup('bot', 'finbot-hero-icon')}</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:#64748b22;margin-bottom:12px">
          <span style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">Free Plan</span>
        </div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Upgrade to Unlock FinBot</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:320px;margin-bottom:24px">
          FinBot is available on paid plans. Start with <strong style="color:#10b981">Basic</strong>, or move up to <strong style="color:#7c3aed">Pro</strong> and <strong style="color:#d97706">Enterprise</strong> for larger monthly credit pools.
        </p>
        <div style="width:100%;max-width:720px;margin-bottom:20px">${renderBillingPlanCards(userTier)}</div>
        <button onclick="openBillingSupport()" style="width:100%;max-width:360px;padding:13px 20px;border-radius:14px;background:var(--card);color:var(--text);font-size:13px;font-weight:800;border:1px solid var(--border);cursor:pointer;margin-bottom:8px">
          Need help choosing a plan?
        </button>
        <div style="display:none;grid-template-columns:1fr 1fr;gap:12px;width:100%;max-width:360px;margin-bottom:28px">
          <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#7c3aed18,#6d28d918);border:1px solid #7c3aed44">
            <div style="font-size:20px;margin-bottom:6px">⚡</div>
            <p style="font-weight:800;font-size:13px;color:#a78bfa;margin-bottom:4px">Pro</p>
            <p style="font-size:11.5px;color:var(--faint);line-height:1.5">100 credits<br>News AI: 2 credits<br>Analysis: 5 credits</p>
          </div>
          <div style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#d9770618,#b4530918);border:1px solid #d9770644">
            <div style="font-size:20px;margin-bottom:6px">🏆</div>
            <p style="font-weight:800;font-size:13px;color:#fbbf24;margin-bottom:4px">Enterprise</p>
            <p style="font-size:11.5px;color:var(--faint);line-height:1.5">300 credits<br>News AI: 2 credits<br>Analysis: 5 credits</p>
          </div>
        </div>
        <div style="display:none;width:100%;max-width:360px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border);margin-bottom:8px">
          <p style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
            Contact your administrator to upgrade your plan, or reach out at <strong style="color:var(--text)">support@investeasy.app</strong>
          </p>
        </div>
      </div>
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;padding:0 4px">6 Analysis Modes — Pro & Enterprise</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" style="opacity:.5;cursor:default;border-color:var(--border);pointer-events:none">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${iconMarkup(m.icon, 'mode-icon-glyph')}</div>
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
                    display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">${iconMarkup('bolt')}</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:#dc262622;margin-bottom:12px">
          <span style="font-size:11px;font-weight:800;color:#f87171;text-transform:uppercase;letter-spacing:0.06em">0 Credits Remaining</span>
        </div>
        <h2 style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:8px">Out of FinBot Credits</h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.65;max-width:320px;margin-bottom:20px">
          You've used all your monthly FinBot credits. Upgrade your plan or contact support if you need billing help.
        </p>
        <div style="width:100%;max-width:720px;margin-bottom:16px">${renderBillingPlanCards(userTier)}</div>
        <button onclick="openBillingSupport()" style="width:100%;max-width:360px;padding:13px 20px;border-radius:14px;background:var(--card);color:var(--text);font-size:13px;font-weight:800;border:1px solid var(--border);cursor:pointer;margin-bottom:8px">
          Contact Billing Support
        </button>
        <div style="display:none;width:100%;max-width:360px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--border)">
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
          <div class="finbot-icon">${iconMarkup('bot', 'finbot-main-icon')}</div>
          <div style="flex:1">
            <h2>FinBot</h2>
            <p style="font-size:11px;color:var(--faint)">Quick chat + 6 elite analysis modes</p>
          </div>
          <div class="finbot-account-pills" style="display:flex;align-items:center;gap:6px">
            <span style="font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:0.05em;background:${getTierPresentation(currentUser.tier).chipBg};color:${getTierPresentation(currentUser.tier).chipColor}">${getTierPresentation(currentUser.tier).label}</span>
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
      ${renderFinBotChatPanel()}
      <p style="font-weight:700;font-size:11px;color:var(--faint);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px">Choose Analysis Mode</p>
      ${FINBOT_MODES.map(m => `
        <div class="mode-card" onclick="setFinbotMode('${m.id}')" style="border-color:var(--border)"
          onmouseenter="this.style.borderColor='${m.col}'" onmouseleave="this.style.borderColor='var(--border)'">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="mode-icon" style="background:linear-gradient(135deg,${m.col},${m.col}dd)">${iconMarkup(m.icon, 'mode-icon-glyph')}</div>
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
        <div class="loading-icon" style="background:linear-gradient(135deg,${modeObj.col},${modeObj.col}dd)">${iconMarkup(modeObj.icon, 'loading-icon-glyph')}</div>
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
          <button class="back-btn" onclick="backFromFinBotResult()">←</button>
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
        <div class="error-box" style="background:#3b82f614;border-color:#3b82f644">
          <p style="font-weight:700;font-size:14px;color:#2563eb">Upgrade Required</p>
          <p style="margin:6px 0 16px;font-size:13px;color:#3b82f6;line-height:1.5">FinBot is only available on paid plans. Choose Basic, Pro, or Enterprise to continue.</p>
          ${renderBillingPlanCards(currentUser?.tier || 'free')}
        </div>
      ` : finbotState.error === 'no_credits' ? `
        <div class="error-box" style="background:#dc262614;border-color:#dc262644">
          <p style="font-weight:700;font-size:14px;color:#f87171">Out of Credits</p>
          <p style="margin:6px 0 16px;font-size:13px;color:#fca5a5;line-height:1.5">You have no FinBot credits remaining. Upgrade your plan or contact support for billing help.</p>
          ${renderBillingPlanCards(currentUser?.tier || 'free')}
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
      </div>
      ${!isLive && calendarLoadError ? `
        <div class="error-box" style="margin-bottom:14px;background:#f59e0b12;border-color:#f59e0b44">
          <p style="font-weight:700;font-size:14px;color:#f59e0b">Calendar Data Delayed</p>
          <p style="margin:6px 0 0;font-size:13px;color:#fbbf24;line-height:1.5">${escHtml(calendarLoadError)}</p>
        </div>
      ` : ''}`;
  }
  scheduleUiIconRefresh(el);
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
    const d = await dataRequest('saved_reports');
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
      const d = await dataRequest('saved_reports', 'POST', {
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
      const d = await dataRequest('saved_reports', 'DELETE', { id });
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
    await Promise.all(ids.map(id => dataRequest('saved_reports', 'DELETE', { id }).catch(() => {})));
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
function _srArg(value) { return JSON.stringify(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

async function deleteSavedTag(tag) {
  const reports = getSavedReports();
  const affected = reports.filter(r => Array.isArray(r.tags) && r.tags.includes(tag));
  if (!affected.length) return;
  const confirmed = await showConfirmModal(
    `Delete tag "${tag}"?`,
    `This removes the tag from ${affected.length} saved report${affected.length !== 1 ? 's' : ''}. Reports will not be deleted.`,
    'Delete tag'
  );
  if (!confirmed) return;
  const results = await Promise.all(affected.map(r => updateReport(r.id, { tags: r.tags.filter(t => t !== tag) })));
  if (results.every(Boolean)) {
    if (savedTagFilter === tag) savedTagFilter = '';
    renderSaved();
    showToast('Tag deleted');
  }
}

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
                      display:flex;align-items:center;justify-content:center;font-size:18px">${iconMarkup(f.icon, 'saved-feature-icon')}</div>
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
    <div class="section-title section-title-inline" style="display:flex;justify-content:space-between;align-items:center">
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
        <option value="starred" ${savedSort==='starred'?'selected':''}>Starred First</option>
      </select>
    </div>

    <!-- Segmented type filter -->
    <div style="background:var(--border);border-radius:13px;padding:4px;display:flex;gap:2px;margin-bottom:12px">
      ${filterBtn('all',    'All',       allReports.length, 'var(--green)')}
      ${filterBtn('finbot', iconMarkup('bot', 'inline-icon') + ' FinBot', finbotCount,       '#6366f1')}
      ${filterBtn('news',   '📰 News',   newsCount,         '#7c3aed')}
      ${starCount ? filterBtn('starred', starIcon('inline-star-icon') + ' Starred', starCount, '#f59e0b') : ''}
    </div>

    <!-- Folders + Tags panel -->
    ${(folders.length || allTags.length) ? `
    <div style="margin-bottom:14px;border-radius:12px;border:1.5px solid var(--border);overflow:hidden">
      ${folders.length ? `
      <div style="display:flex;align-items:center;gap:2px;padding:6px 8px;overflow-x:auto;scrollbar-width:none">
        <span style="font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;padding:0 6px">📁 Folder</span>
        <div style="width:1px;height:14px;background:var(--border);flex-shrink:0;margin:0 4px"></div>
        <button class="saved-folder-tab ${!savedFolderFilter?'active':''}" onclick="savedFolderFilter='';renderSaved()">All</button>
        ${folders.map(f => `<button class="saved-folder-tab ${savedFolderFilter===f?'active':''}" onclick="_srFolder(${_srArg(f)})">${escHtml(f)}</button>`).join('')}
      </div>` : ''}
      ${folders.length && allTags.length ? `<div style="height:1px;background:var(--border)"></div>` : ''}
      ${allTags.length ? `
      <div style="display:flex;align-items:center;gap:2px;padding:6px 8px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;padding:0 6px">🏷 Tags</span>
        <div style="width:1px;height:14px;background:var(--border);flex-shrink:0;margin:0 4px"></div>
        ${allTags.map(t => `<span class="saved-tag-chip saved-tag-manage ${savedTagFilter===t?'active':''}">
          <button class="saved-tag-label" onclick="_srTag(${_srArg(t)})" title="Filter by tag">${escHtml(t)}</button>
          <button class="saved-tag-delete" onclick="event.stopPropagation();deleteSavedTag(${_srArg(t)})" title="Delete tag">×</button>
        </span>`).join('')}
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
              <div class="saved-card-icon" style="background:${r.modeCol}22">${iconMarkup(r.modeIcon, 'saved-card-icon-glyph')}</div>
              <div>
                <div class="saved-card-title">${escHtml(r.modeTitle)}</div>
                <div class="saved-card-sub">${r.modeId === 'news' ? '📰 News Analysis' : 'by ' + escHtml(r.modeSub)} &nbsp;·&nbsp; ${dateStr}, ${timeStr}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button class="saved-card-star ${r.starred?'starred':''}" onclick="toggleReportStar('${r.id}')" title="${r.starred?'Unstar':'Star'}">${starIcon('saved-star-icon')}</button>
              <button onclick="deleteSavedReport('${r.id}')"
                style="background:#ef4444;border:none;cursor:pointer;color:#fff;padding:6px 8px;border-radius:8px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </div>
          ${r.folder ? `<div class="saved-card-folder">📁 ${escHtml(r.folder)}</div>` : ''}
          ${tags.length ? `<div class="saved-card-tags">${tags.map(t => `<span class="saved-tag-chip" onclick="_srTag(${_srArg(t)})" title="Filter by tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
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
      const d = await dataRequest('saved_reports', 'POST', { id, ...fields });
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
    await Promise.all(ids.map(id => dataRequest('saved_reports', 'DELETE', { id }).catch(() => {})));
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
        <span style="font-size:13px;font-weight:600;color:var(--text);display:inline-flex;align-items:center;gap:6px">${starIcon('inline-star-icon')} Starred</span>
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

function showConfirmModal(title, message, okLabel = 'Clear all') {
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
    document.getElementById('ie-confirm-ok').textContent = okLabel;
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
let portfolioImportRows = [];

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
    const styles = getComputedStyle(document.body);
    const textCol = styles.getPropertyValue('--text').trim() || '#1e293b';
    const mutedCol = styles.getPropertyValue('--muted').trim() || '#64748b';
    const faintCol = styles.getPropertyValue('--faint').trim() || '#94a3b8';
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
    if (hov >= 0) {
      const s = segments[hov];
      ctx.fillStyle = textCol;
      ctx.font = 'bold 13px system-ui,sans-serif';
      ctx.fillText(s.label, cx, cy - 7);
      ctx.fillStyle = mutedCol;
      ctx.font = '11px system-ui,sans-serif';
      ctx.fillText(s.pct.toFixed(1) + '%', cx, cy + 9);
    } else {
      ctx.fillStyle = faintCol;
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

function makePortfolioMiniDonut(canvasEl, segments, centerLabel = 'EXPOSURE') {
  if (!canvasEl || !segments?.length) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvasEl.parentElement?.getBoundingClientRect();
  const SIZE = Math.max(150, Math.min(230, Math.floor(rect?.width || 220)));
  const cx = SIZE / 2, cy = SIZE / 2, outer = SIZE * 0.36, inner = SIZE * 0.22;
  canvasEl.width = SIZE * dpr;
  canvasEl.height = SIZE * dpr;
  canvasEl.style.width = SIZE + 'px';
  canvasEl.style.height = SIZE + 'px';
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  const styles = getComputedStyle(document.body);
  const labelCol = styles.getPropertyValue('--faint').trim() || '#94a3b8';
  const valueCol = styles.getPropertyValue('--muted').trim() || '#64748b';
  let start = -Math.PI / 2;
  segments.forEach(seg => {
    const sweep = (Math.max(0, seg.pct) / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, start, start + sweep);
    ctx.arc(cx, cy, inner, start + sweep, start, true);
    ctx.closePath();
    ctx.fillStyle = seg.color || '#287a55';
    ctx.globalAlpha = 0.9;
    ctx.fill();
    start += sweep;
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = labelCol;
  ctx.font = '800 10px system-ui,sans-serif';
  ctx.fillText(centerLabel, cx, cy - 6);
  ctx.fillStyle = valueCol;
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillText(segments.length + ' groups', cx, cy + 8);
}

function makePortfolioConcentrationChart(canvasEl, rows) {
  if (!canvasEl || !rows?.length) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvasEl.parentElement?.getBoundingClientRect();
  const W = Math.max(280, Math.floor(rect?.width || 420));
  const H = 180;
  canvasEl.width = W * dpr;
  canvasEl.height = H * dpr;
  canvasEl.style.width = '100%';
  canvasEl.style.height = H + 'px';
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const styles = getComputedStyle(document.documentElement);
  const text = styles.getPropertyValue('--text').trim() || '#17231d';
  const muted = styles.getPropertyValue('--muted').trim() || '#647266';
  const grid = styles.getPropertyValue('--border').trim() || '#e3d9c8';
  const green = styles.getPropertyValue('--green').trim() || '#287a55';
  const amber = styles.getPropertyValue('--amber').trim() || '#b9842f';
  const red = styles.getPropertyValue('--red').trim() || '#d94a4a';
  const pad = { left: 26, right: 18, top: 20, bottom: 38 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach(tick => {
    const y = pad.top + chartH - (tick / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  });
  const gap = 14;
  const barW = (chartW - gap * (rows.length - 1)) / rows.length;
  rows.forEach((row, i) => {
    const x = pad.left + i * (barW + gap);
    const h = Math.max(2, (Math.min(row.pct, 100) / 100) * chartH);
    const y = pad.top + chartH - h;
    ctx.fillStyle = row.tone === 'bad' ? red : row.tone === 'warn' ? amber : green;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, 8);
    ctx.fill();
    ctx.fillStyle = text;
    ctx.font = '800 12px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(row.pct.toFixed(0) + '%', x + barW / 2, Math.max(14, y - 7));
    ctx.fillStyle = muted;
    ctx.font = '700 10px system-ui,sans-serif';
    ctx.fillText(i === 0 ? 'Top 1' : i === 1 ? 'Top 2' : 'Top 3', x + barW / 2, H - 16);
  });
}

// Portfolio allocation summary chart
function portfolioAllocationMidChart(items) {
  const max = Math.max(...items.map(item => item.value), 1);
  return `
    <div class="portfolio-allocation-chart" aria-label="Value by holding chart">
      <div class="portfolio-allocation-chart-title">Value by holding</div>
      ${items.map(item => {
        const width = Math.min(100, Math.max((item.value / max) * 100, item.value > 0 ? 5 : 0));
        return `
          <div class="portfolio-allocation-chart-row">
            <span>${item.label}</span>
            <div class="portfolio-allocation-chart-track">
              <div class="portfolio-allocation-chart-fill" style="width:${width.toFixed(1)}%;background:${item.color}"></div>
            </div>
            <strong>${item.pct}</strong>
          </div>
        `;
      }).join('')}
    </div>
  `;
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
    localization: {
      timeFormatter: time => {
        const date = typeof time === 'string' ? new Date(`${time}T00:00:00`) : new Date(time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: false,
      tickMarkFormatter: time => {
        const date = typeof time === 'string' ? new Date(`${time}T00:00:00`) : new Date(time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      },
    },
    handleScroll: false, handleScale: false,
  });
  const series = chart.addAreaSeries({
    lineColor: color, lineWidth: 2.5,
    topColor: color + '35', bottomColor: color + '00',
    priceLineVisible: false, lastValueVisible: true,
    crosshairMarkerRadius: 5, crosshairMarkerBackgroundColor: color,
  });
  series.setData(data.map(d => ({ time: d.time, value: d.value })));
  chart.timeScale().fitContent();
  return chart;
}

function perfHistoryDate(index, totalPoints) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const pointDate = new Date(monthStart);
  pointDate.setMonth(monthStart.getMonth() - (totalPoints - 1 - index));
  return pointDate.toISOString().slice(0, 10);
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
    portPerfChart = createPerfChart(chartEl, slice.map(p => {
      const sourceIndex = allData.indexOf(p);
      return {
        time: p.time || perfHistoryDate(sourceIndex >= 0 ? sourceIndex : 0, allData.length),
        value: p.v * rate,
      };
    }), color, 170);
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
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return Array.from({ length: 12 }, (_, i) => {
    const t    = i / 11;
    const ease = t * t * (3 - 2 * t);
    const noise = (Math.sin(i * 2.3) * 0.03 + Math.cos(i * 1.7) * 0.02) * base;
    const pointDate = new Date(monthStart);
    pointDate.setMonth(monthStart.getMonth() - (11 - i));
    return {
      time: pointDate.toISOString().slice(0, 10),
      t: i,
      v: Math.max(0, base + range * ease + noise),
    };
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

function portfolioActionGroup(isEmpty = false) {
  return `
    <div class="portfolio-action-group">
      <button onclick="openImportPortfolioModal()" class="portfolio-action portfolio-action-secondary">Import</button>
      <button onclick="openAddHoldingModal()" class="portfolio-action">${isEmpty ? '+ Add first holding' : '+ Add holding'}</button>
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
  const demoAllocations = HOLDINGS
    .map((h, i) => ({
      ...h,
      val: h.shares * h.cur,
      allocPct: h.alloc,
      color: ALLOC_COLORS[i % ALLOC_COLORS.length],
      sector: h.ticker === 'BTC' || h.ticker === 'ETH' ? 'Crypto' : 'Global equities',
    }))
    .sort((a, b) => b.allocPct - a.allocPct);
  const top1Pct = demoAllocations[0]?.allocPct || 0;
  const top2Pct = demoAllocations.slice(0, 2).reduce((s, h) => s + h.allocPct, 0);
  const top3Pct = demoAllocations.slice(0, 3).reduce((s, h) => s + h.allocPct, 0);
  const cryptoPct = demoAllocations.filter(h => h.sector === 'Crypto').reduce((s, h) => s + h.allocPct, 0);
  const demoHoldingCountScore = Math.min(100, HOLDINGS.length * 12);
  const demoAssetMixScore = cryptoPct > 25 ? 35 : 72;
  const demoConcentrationScore = Math.max(0, 100 - top1Pct * 1.7 - top2Pct * 0.45);
  const divScore = Math.round(demoHoldingCountScore * 0.30 + demoAssetMixScore * 0.25 + demoConcentrationScore * 0.45);
  const concentrationRows = [
    { label: `Top holding (${demoAllocations[0]?.ticker || '-'})`, pct: top1Pct, value: top1Pct.toFixed(1) + '%', tone: top1Pct > 35 ? 'bad' : top1Pct > 25 ? 'warn' : 'good', sub: 'Shows single-name dependency' },
    { label: 'Top 2 holdings', pct: top2Pct, value: top2Pct.toFixed(1) + '%', tone: top2Pct > 60 ? 'bad' : top2Pct > 45 ? 'warn' : 'good', sub: 'How concentrated your biggest pair is' },
    { label: 'Top 3 holdings', pct: top3Pct, value: top3Pct.toFixed(1) + '%', tone: top3Pct > 75 ? 'bad' : top3Pct > 60 ? 'warn' : 'good', sub: 'How much the top group controls' },
  ];
  const exposureRows = [
    { label: 'Global equities', pct: Math.max(0, 100 - cryptoPct), value: Math.max(0, 100 - cryptoPct).toFixed(1) + '%', color: '#287a55' },
    { label: 'Crypto', pct: cryptoPct, value: cryptoPct.toFixed(1) + '%', color: '#f59e0b' },
  ].filter(row => row.pct > 0.1);
  const geographyRows = exposureRows;
  const riskFactors = [
    { label: 'Holdings count', pct: demoHoldingCountScore, value: `${HOLDINGS.length} holdings`, tone: riskTone(demoHoldingCountScore), sub: 'More holdings can reduce single-name risk' },
    { label: 'Asset mix', pct: demoAssetMixScore, value: `${cryptoPct.toFixed(1)}% crypto`, tone: cryptoPct > 25 ? 'warn' : 'good', sub: cryptoPct > 25 ? 'Crypto is a large driver' : 'Speculative exposure is contained' },
    { label: 'Concentration', pct: demoConcentrationScore, value: top1Pct.toFixed(1) + '% top holding', tone: riskTone(demoConcentrationScore), sub: 'Lower top weights improve resilience' },
  ];
  const insightCards = [
    { tone: top1Pct > 30 ? 'warn' : 'good', label: 'Concentration', title: top1Pct > 30 ? 'Top holding needs watching' : 'Top holding looks reasonable', body: `Your largest holding is ${top1Pct.toFixed(1)}% of the demo portfolio.` },
    { tone: cryptoPct > 20 ? 'warn' : 'good', label: 'Volatility', title: cryptoPct > 20 ? 'Crypto can move the result' : 'Crypto is contained', body: `Crypto makes up ${cryptoPct.toFixed(1)}%, which changes how volatile the portfolio feels.` },
    { tone: divScore >= 60 ? 'good' : 'warn', label: 'Next step', title: 'Improve the spread', body: 'Adding different sectors or asset classes would raise the diversification score.' },
  ];

  document.getElementById('tab-portfolio').innerHTML = `
    ${portfolioDashboardHeading('Your demo portfolio', 'See your holdings, returns, and allocation at a glance before adding your own investments.')}

    ${portCurrencyBar()}

    <div class="dashboard-stats">
      ${portfolioStatCard(`${iconMarkup('wallet', 'portfolio-stat-icon')}`, fmtMoney(total), 'Portfolio value')}
      ${portfolioStatCard(`${iconMarkup('pie-chart-09', 'portfolio-stat-icon')}`, HOLDINGS.length, 'Active holdings')}
      ${portfolioStatCard(`${iconMarkup('chart-03', 'portfolio-stat-icon')}`, `${up?'+':''}${pnlP}%`, 'Total return')}
      ${portfolioStatCard(`${iconMarkup('dashboard-square-01', 'portfolio-stat-icon')}`, HOLDINGS.length, 'Tracked assets')}
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Holdings over time</div>
            <div class="dashboard-panel-subtitle">See how your portfolio has grown as you add more positions.</div>
          </div>
        </div>
        ${portfolioBars(monthBars)}
      </div>
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Top allocations</div>
            <div class="dashboard-panel-subtitle">Shows which holdings take up the biggest share of your money.</div>
          </div>
        </div>
        ${portfolioCategoryRows(categories)}
      </div>
    </div>

    <div class="port-perf-card" id="port-perf-wrap">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Performance</div>
          <div class="dashboard-panel-subtitle">See how your portfolio value has changed across the selected period.</div>
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
          <div class="dashboard-panel-subtitle">See how your money is split across each holding.</div>
        </div>
        <div style="font-size:12px;color:${up?'var(--green)':'var(--red)'};font-weight:700">${up?'▲':'▼'} ${fmtMoney(Math.abs(pnl))}</div>
      </div>
      <div class="portfolio-allocation-wrap">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        ${portfolioAllocationMidChart(HOLDINGS.map((h, i) => ({
          label: h.ticker,
          value: h.shares * h.cur,
          pct: h.alloc + '%',
          color: ALLOC_COLORS[i % ALLOC_COLORS.length],
        })))}
        <div class="portfolio-allocation-list">
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
      <div class="portfolio-insight-grid">
        ${insightCards.map(card => `
          <div class="portfolio-insight-card tone-${card.tone}">
            <p class="portfolio-insight-label">${card.label}</p>
            <h4>${card.title}</h4>
            <p>${card.body}</p>
          </div>
        `).join('')}
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
          <div class="dashboard-panel-subtitle">Compare which holdings are helping or hurting your return.</div>
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
        <div class="dashboard-panel-subtitle">Review each position, its value, and its share of your portfolio.</div>
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
    ${portfolioDashboardHeading('Your portfolio', 'Add your first holding to start tracking value, returns, and allocation.', portfolioActionGroup(true))}
    <div class="dashboard-panel" style="text-align:center;padding:60px 20px 40px">
      <div style="font-size:52px;margin-bottom:16px">ðŸ“Š</div>
      <p style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px">No holdings yet</p>
      <p style="font-size:13px;color:var(--faint);line-height:1.6;margin-bottom:24px">
        Add your first stock, ETF or crypto holding to start tracking your portfolio.
      </p>
      <div class="portfolio-action-group" style="justify-content:center">
        <button onclick="openImportPortfolioModal()" class="portfolio-action portfolio-action-secondary">Import Holdings</button>
        <button onclick="openAddHoldingModal()" class="portfolio-action">+ Add First Holding</button>
      </div>
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
    const currency = mkt?.currency || h.currency || 'USD';
    return s + h.shares * nativeToUsd(mkt ? mkt.val : h.avg_cost, currency);
  }, 0);
  finbotForm.portfolio = dbPortfolio.map(h => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    const currency = mkt?.currency || h.currency || 'USD';
    const val = h.shares * nativeToUsd(mkt ? mkt.val : h.avg_cost, currency);
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
    FSR:'Finance',SBK:'Finance',CPI:'Finance',ABG:'Finance',NED:'Finance',SLM:'Finance',DSY:'Healthcare',OMU:'Finance',
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
    const nativeCurrency = mkt?.currency || h.currency || 'USD';
    const curNative = mkt ? mkt.val : h.avg_cost;
    const avgCostUsd = nativeToUsd(h.avg_cost, nativeCurrency);
    const curUsd = nativeToUsd(curNative, nativeCurrency);
    const val  = h.shares * curUsd;
    const cost = h.shares * avgCostUsd;
    const pnl  = val - cost;
    const pnlP = avgCostUsd > 0 ? ((curUsd - avgCostUsd) / avgCostUsd * 100) : 0;
    const sector = mkt?.sector || SECTOR_MAP[h.ticker] || 'Other';
    return { ...h, cur: curUsd, curNative, nativeCurrency, exchange: mkt?.exchange || '', sector, val, cost, pnl, pnlP };
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
  const sectors = new Set(holdings.map(h => h.sector || 'Other'));

  // Sector breakdown
  const sectorTotals = {};
  holdings.forEach(h => {
    const sec = h.sector || 'Other';
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
  const allocations = holdings
    .map((h, i) => ({
      ...h,
      allocPct: total > 0 ? (h.val / total * 100) : 0,
      color: COLORS[i % COLORS.length],
      sector: h.sector || 'Other',
    }))
    .sort((a, b) => b.allocPct - a.allocPct);
  const top1Pct = allocations[0]?.allocPct || 0;
  const top2Pct = allocations.slice(0, 2).reduce((s, h) => s + h.allocPct, 0);
  const top3Pct = allocations.slice(0, 3).reduce((s, h) => s + h.allocPct, 0);
  const cryptoPct = allocations.filter(h => h.sector === 'Crypto').reduce((s, h) => s + h.allocPct, 0);
  const jsePct = allocations.filter(h => h.exchange === 'JSE' || h.nativeCurrency === 'ZAR').reduce((s, h) => s + h.allocPct, 0);
  const topSector = sectorList[0] || { name: 'None', pct: 0 };
  const concentrationTone = top1Pct > 35 || top2Pct > 60 ? 'bad' : top1Pct > 25 || top2Pct > 45 ? 'warn' : 'good';
  const cryptoTone = cryptoPct > 25 ? 'bad' : cryptoPct > 10 ? 'warn' : 'good';
  const sectorTone = topSector.pct > 55 ? 'bad' : topSector.pct > 35 ? 'warn' : 'good';
  const holdingCountScore = Math.min(100, holdings.length * 12);
  const sectorSpreadScore = Math.min(100, sectors.size * 22);
  const concentrationScore = Math.max(0, 100 - top1Pct * 1.7 - top2Pct * 0.45);
  const cryptoBalanceScore = Math.max(0, 100 - cryptoPct * 2.3);
  const divScore = Math.round(
    holdingCountScore * 0.25 +
    sectorSpreadScore * 0.25 +
    concentrationScore * 0.30 +
    cryptoBalanceScore * 0.20
  );
  const riskFactors = [
    { label: 'Holdings count', pct: holdingCountScore, value: `${holdings.length} holding${holdings.length === 1 ? '' : 's'}`, tone: riskTone(holdingCountScore), sub: holdings.length >= 8 ? 'Good spread across positions' : 'Add more positions to reduce single-name risk' },
    { label: 'Sector spread', pct: sectorSpreadScore, value: `${sectors.size} sector${sectors.size === 1 ? '' : 's'}`, tone: riskTone(sectorSpreadScore), sub: sectors.size >= 4 ? 'Healthy sector variety' : 'More sectors would smooth portfolio swings' },
    { label: 'Concentration', pct: concentrationScore, value: `${top1Pct.toFixed(1)}% top holding`, tone: riskTone(concentrationScore), sub: top1Pct > 30 ? `${allocations[0]?.ticker || 'Top holding'} is doing a lot of work` : 'No single holding dominates the portfolio' },
    { label: 'Crypto balance', pct: cryptoBalanceScore, value: `${cryptoPct.toFixed(1)}%`, tone: riskTone(cryptoBalanceScore), sub: cryptoPct > 20 ? 'Crypto can lift volatility quickly' : 'Crypto exposure is contained' },
  ];
  const exposureTotals = {};
  allocations.forEach(h => {
    const key = h.sector === 'Crypto' ? 'Crypto'
      : h.sector === 'ETF' ? 'ETFs'
      : h.sector === 'Commodities' ? 'Commodities'
      : (h.exchange === 'JSE' || h.nativeCurrency === 'ZAR') ? 'JSE equities'
      : 'Global equities';
    exposureTotals[key] = (exposureTotals[key] || 0) + h.allocPct;
  });
  const exposureColors = {
    'Global equities':'#287a55',
    'JSE equities':'#3e73a8',
    'Crypto':'#f59e0b',
    'ETFs':'#7562c8',
    'Commodities':'#84cc16',
  };
  const exposureRows = Object.entries(exposureTotals)
    .map(([label, pct]) => ({ label, pct, color: exposureColors[label] || '#94a3b8', value: pct.toFixed(1) + '%' }))
    .sort((a, b) => b.pct - a.pct);
  const geographyRows = [
    { label: 'South Africa', pct: jsePct, color: '#3e73a8', value: jsePct.toFixed(1) + '%' },
    { label: 'Crypto', pct: cryptoPct, color: '#f59e0b', value: cryptoPct.toFixed(1) + '%' },
    { label: 'Global / US', pct: Math.max(0, 100 - jsePct - cryptoPct), color: '#287a55', value: Math.max(0, 100 - jsePct - cryptoPct).toFixed(1) + '%' },
  ].filter(row => row.pct > 0.1);
  const concentrationRows = [
    { label: `Top holding${allocations[0] ? ' (' + allocations[0].ticker + ')' : ''}`, pct: top1Pct, value: top1Pct.toFixed(1) + '%', tone: top1Pct > 35 ? 'bad' : top1Pct > 25 ? 'warn' : 'good', sub: top1Pct > 30 ? 'A large move here will strongly affect the portfolio' : 'Single holding risk is manageable' },
    { label: 'Top 2 holdings', pct: top2Pct, value: top2Pct.toFixed(1) + '%', tone: top2Pct > 60 ? 'bad' : top2Pct > 45 ? 'warn' : 'good', sub: top2Pct > 50 ? 'Returns depend heavily on two assets' : 'Top two holdings are not overly dominant' },
    { label: 'Top 3 holdings', pct: top3Pct, value: top3Pct.toFixed(1) + '%', tone: top3Pct > 75 ? 'bad' : top3Pct > 60 ? 'warn' : 'good', sub: top3Pct > 65 ? 'Consider whether this is intentional conviction' : 'Top three exposure looks balanced enough' },
  ];
  const insightCards = [
    {
      tone: concentrationTone,
      label: 'Concentration',
      title: top1Pct > 30 ? `${allocations[0]?.ticker || 'Top holding'} needs watching` : 'Single-name risk looks controlled',
      body: top1Pct > 30 ? `Your largest holding is ${top1Pct.toFixed(1)}% of the portfolio. A simple target is keeping one position below 25-30%.` : `Your largest holding is ${top1Pct.toFixed(1)}%, so no single asset is carrying the whole portfolio.`,
    },
    {
      tone: cryptoTone,
      label: 'Volatility',
      title: cryptoPct > 20 ? 'Crypto is a major swing factor' : 'Crypto exposure is contained',
      body: cryptoPct > 20 ? `Crypto is ${cryptoPct.toFixed(1)}% of the portfolio, so drawdowns may feel sharper in risk-off markets.` : `Crypto is ${cryptoPct.toFixed(1)}%, which keeps speculative exposure from dominating your result.`,
    },
    {
      tone: sectorTone,
      label: 'Exposure',
      title: `${topSector.name} is your biggest theme`,
      body: topSector.pct > 40 ? `${topSector.name} is ${topSector.pct.toFixed(1)}% of the portfolio. Adding a different sector could improve balance.` : `${topSector.name} leads at ${topSector.pct.toFixed(1)}%, but sector concentration is not extreme.`,
    },
    {
      tone: divScore >= 60 ? 'good' : divScore >= 35 ? 'warn' : 'bad',
      label: 'Next step',
      title: divScore >= 60 ? 'Keep rebalancing deliberately' : 'Improve diversification first',
      body: divScore >= 60 ? 'Your spread is improving. The main job is keeping weights from drifting too far.' : 'The easiest improvement is adding holdings from different sectors or asset classes.',
    },
  ];

  document.getElementById('tab-portfolio').innerHTML = `
    ${portfolioDashboardHeading('Your money at a glance', 'See what you own, how it is performing, and where your risk is concentrated.', portfolioActionGroup(false))}

    ${portCurrencyBar()}

    <div class="dashboard-stats">
      ${portfolioStatCard(`${iconMarkup('wallet', 'portfolio-stat-icon')}`, fmtMoney(total), 'Portfolio value')}
      ${portfolioStatCard(`${iconMarkup('pie-chart-09', 'portfolio-stat-icon')}`, holdings.length, 'Active holdings')}
      ${portfolioStatCard(`${iconMarkup('chart-03', 'portfolio-stat-icon')}`, `${up?'+':''}${totalPnlP}%`, 'Portfolio return')}
      ${portfolioStatCard(`${iconMarkup('dashboard-square-01', 'portfolio-stat-icon')}`, sectors.size, 'Sectors covered')}
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Holdings over time</div>
            <div class="dashboard-panel-subtitle">See how your portfolio has grown as you add more positions.</div>
          </div>
        </div>
        ${portfolioBars(monthBars)}
      </div>
      <div class="dashboard-panel">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Top categories</div>
            <div class="dashboard-panel-subtitle">Shows where the biggest parts of your money are invested.</div>
          </div>
        </div>
        ${portfolioCategoryRows(topCategories)}
      </div>
    </div>

    <button onclick="analyzePortfolioWithFinBot()"
      style="width:100%;padding:13px 16px;border-radius:16px;background:#3b82f614;color:#2563eb;font-size:13px;font-weight:700;border:1px solid #3b82f630;cursor:pointer;margin-bottom:18px">
      Analyze portfolio with FinBot →
    </button>

    <div class="port-perf-card" id="port-perf-wrap">
      <div class="dashboard-panel-header">
        <div>
          <div class="dashboard-panel-title">Performance</div>
          <div class="dashboard-panel-subtitle">See how your portfolio value has changed across the selected period.</div>
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
          <div class="dashboard-panel-subtitle">A quick health check of winners, losers, and diversification.</div>
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
      <div class="portfolio-allocation-wrap">
        <canvas id="port-donut" style="flex-shrink:0"></canvas>
        ${portfolioAllocationMidChart(holdings.map((h, i) => ({
          label: h.ticker,
          value: h.val,
          pct: total > 0 ? ((h.val / total) * 100).toFixed(1) + '%' : '0.0%',
          color: COLORS[i % COLORS.length],
        })))}
        <div class="portfolio-allocation-list">
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
      <div class="portfolio-insight-grid">
        ${insightCards.map(card => `
          <div class="portfolio-insight-card tone-${card.tone}">
            <p class="portfolio-insight-label">${card.label}</p>
            <h4>${card.title}</h4>
            <p>${card.body}</p>
          </div>
        `).join('')}
      </div>
    </div>

    ${sectorList.length > 1 ? `
      <div class="pnl-bars-card">
        <div class="dashboard-panel-header">
          <div>
            <div class="dashboard-panel-title">Sector breakdown</div>
            <div class="dashboard-panel-subtitle">See which industries your money depends on most.</div>
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
          <div class="dashboard-panel-subtitle">Compare which holdings are helping or hurting your return.</div>
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
        <div class="dashboard-panel-subtitle">Review each position, its value, and its share of your portfolio.</div>
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
              ${h.sector && h.sector !== 'Other' ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${SECTOR_COLORS[h.sector] || '#94a3b8'}18;color:${SECTOR_COLORS[h.sector] || '#94a3b8'}">${h.sector}</span>` : ''}
              ${h.nativeCurrency !== 'USD' ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef1fb;color:#6b5bd2">${h.exchange || h.nativeCurrency} / ${h.nativeCurrency}</span>` : ''}
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
            {l:'Avg Cost',v:fmtNativeUnitPrice(h.avg_cost, h.nativeCurrency)},
            {l:'Current', v:fmtNativeUnitPrice(h.curNative, h.nativeCurrency)},
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
      style="width:100%;padding:13px;border-radius:14px;background:linear-gradient(135deg,#3b82f618,#2563eb18);
             color:#2563eb;font-size:13px;font-weight:700;border:1.5px solid #3b82f630;cursor:pointer;
             margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s"
      onmouseenter="this.style.background='linear-gradient(135deg,#3b82f628,#2563eb28)'"
      onmouseleave="this.style.background='linear-gradient(135deg,#3b82f618,#2563eb18)'">
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
              ${h.sector && h.sector !== 'Other' ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
                background:${SECTOR_COLORS[h.sector] || '#94a3b8'}18;
                color:${SECTOR_COLORS[h.sector] || '#94a3b8'}">${h.sector}</span>` : ''}
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
  uiMode: 'standard',
  defaultRisk: 'Moderate', defaultHorizon: '1–5 years', defaultSectors: 'Tech, Finance',
};

const UI_MODES = {
  standard: {
    label: 'Standard',
    level: 'Everyday',
    sub: 'The current FinScope experience with balanced tools and detail.',
  },
  terminal: {
    label: 'Advanced',
    level: 'Advanced',
    sub: 'Dense professional workspace with a live market ticker tape.',
  },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('ie_settings') || '{}');
    const settings = Object.assign({}, SETTINGS_DEFAULTS, saved);
    if (!UI_MODES[settings.uiMode]) settings.uiMode = SETTINGS_DEFAULTS.uiMode;
    return settings;
  } catch(e) { return Object.assign({}, SETTINGS_DEFAULTS); }
}

function applyUiMode(mode = loadSettings().uiMode) {
  const nextMode = UI_MODES[mode] ? mode : SETTINGS_DEFAULTS.uiMode;
  document.body.dataset.uiMode = nextMode;
  document.documentElement.dataset.uiMode = nextMode;
  document.querySelectorAll('.nav button[data-tab="learn"]').forEach(btn => {
    const hideLearn = nextMode === 'terminal';
    btn.hidden = hideLearn;
    btn.style.display = hideLearn ? 'none' : '';
  });
  renderMarketTickerTape();
  if (nextMode === 'terminal') {
    const learnPanel = document.getElementById('tab-learn');
    if (learnPanel && learnPanel.classList.contains('active')) switchTab('markets');
  }
}

function renderMarketTickerTape() {
  const shell = document.querySelector('.shell');
  if (!shell) return;

  const mode = UI_MODES[loadSettings().uiMode] ? loadSettings().uiMode : SETTINGS_DEFAULTS.uiMode;
  let tape = document.getElementById('market-ticker-tape');
  if (mode !== 'terminal') {
    if (tape) tape.remove();
    return;
  }

  if (!tape) {
    tape = document.createElement('div');
    tape.id = 'market-ticker-tape';
    tape.className = 'market-ticker-tape';
    shell.prepend(tape);
  }

  const tickers = ['SPX','NDX','DJI','DAX','XAU','CL1','BTC','ETH','NVDA','AAPL','MSFT','TSLA','NPN','BHG'];
  const items = tickers.map(t => MARKETS.find(m => m.ticker === t)).filter(Boolean);
  const tapeItems = [...items, ...items].map(m => {
    const up = m.chg >= 0;
    return `<button class="ticker-tape-item" onclick="switchTab('markets');setTimeout(()=>openStockDetail(${MARKETS.indexOf(m)}),80)">
      <span class="ticker-tape-symbol">${m.ticker}</span>
      <span class="ticker-tape-price">${fmtMarketUnitPrice(m)}</span>
      <span class="ticker-tape-change ${up ? 'up' : 'dn'}">${up ? '+' : ''}${m.chg.toFixed(2)}%</span>
    </button>`;
  }).join('');

  tape.innerHTML = `
    <div class="ticker-tape-status"><span class="live-dot"></span>LIVE</div>
    <div class="ticker-tape-track" aria-label="Live market ticker">
      <div class="ticker-tape-loop">${tapeItems}</div>
    </div>
  `;
}

function portfolioMetricMiniCard(label, value, detail = '', tone = '') {
  return `
    <div class="portfolio-metric-mini ${tone ? 'tone-' + tone : ''}">
      <p class="portfolio-metric-label">${label}</p>
      <p class="portfolio-metric-value">${value}</p>
      ${detail ? `<p class="portfolio-metric-detail">${detail}</p>` : ''}
    </div>
  `;
}

function portfolioHorizontalBars(items, opts = {}) {
  const max = Math.max(...items.map(item => item.pct), opts.fullScale ? 100 : 1);
  return `
    <div class="portfolio-analytics-bars">
      ${items.map(item => `
        <div class="portfolio-analytics-row">
          <div class="portfolio-analytics-row-head">
            <span>${item.label}</span>
            <strong>${item.value || item.pct.toFixed(1) + '%'}</strong>
          </div>
          <div class="portfolio-analytics-track">
            <div class="portfolio-analytics-fill ${item.tone ? 'tone-' + item.tone : ''}"
              style="width:${Math.min(100, Math.max((item.pct / max) * 100, item.pct > 0 ? 4 : 0))}%;background:${item.color || ''}"></div>
          </div>
          ${item.sub ? `<div class="portfolio-analytics-sub">${item.sub}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function portfolioAnalyticsCard(title, subtitle, bodyHtml) {
  return `
    <div class="portfolio-analytics-card">
      <div class="portfolio-analytics-head">
        <div>
          <div class="portfolio-analytics-title">${title}</div>
          <div class="portfolio-analytics-subtitle">${subtitle}</div>
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function riskTone(score, inverse = false) {
  const value = inverse ? 100 - score : score;
  if (value >= 70) return 'good';
  if (value >= 40) return 'warn';
  return 'bad';
}

function saveSettings(updates) {
  const current = loadSettings();
  const next = Object.assign(current, updates);
  localStorage.setItem('ie_settings', JSON.stringify(next));
  saveSettingsToDB(updates);
  if ('uiMode' in updates) applyUiMode(next.uiMode);
  renderSettings();
  // Re-render all price-displaying views when display-affecting settings change
  if ('currency' in updates || 'hideBalances' in updates || 'uiMode' in updates) {
    const portTab = document.getElementById('tab-portfolio');
    if (portTab && portTab.classList.contains('active')) renderPortfolio();
    const mktTab = document.getElementById('tab-markets');
    if (mktTab && mktTab.classList.contains('active')) renderMarkets();
    if (currentDetailIdx !== null) openStockDetail(currentDetailIdx);
  }
  if ('currency' in updates || 'hideBalances' in updates) renderMarketTickerTape();
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
  const diagnostics = getDiagnosticsLog();
  const recentIssues = diagnostics.slice(0, 5);
  const opsData = opsStatusState.data;
  const activeDiagnostics = getActiveDiagnosticsLog();
  const latestByService = activeDiagnostics.reduce((acc, entry) => {
    if (!acc[entry.service]) acc[entry.service] = entry;
    return acc;
  }, {});
  const serviceStatus = [
    {
      label: 'Supabase',
      state: isSupabaseConfigured() ? 'Healthy' : 'Needs setup',
      tone: isSupabaseConfigured() ? '#10b981' : '#f59e0b',
      sub: isSupabaseConfigured() ? 'Client configured and available' : 'Missing project URL or anon key',
    },
    {
      label: 'Session',
      state: currentUser ? 'Active' : 'Signed out',
      tone: currentUser ? '#3b82f6' : '#64748b',
      sub: currentUser ? `Signed in as @${currentUser.username}` : 'No active authenticated session',
    },
    {
      label: 'FinBot',
      state: latestByService.finbot ? 'Attention' : 'Healthy',
      tone: latestByService.finbot ? '#ef4444' : '#10b981',
      sub: latestByService.finbot ? latestByService.finbot.message : 'No recent function issues',
    },
    {
      label: 'Markets',
      state: latestByService['market-data'] ? 'Attention' : 'Healthy',
      tone: latestByService['market-data'] ? '#ef4444' : '#10b981',
      sub: latestByService['market-data'] ? latestByService['market-data'].message : 'Live prices and charts responding',
    },
    {
      label: 'News',
      state: latestByService.news ? 'Attention' : 'Healthy',
      tone: latestByService.news ? '#f59e0b' : '#10b981',
      sub: latestByService.news ? latestByService.news.message : 'News feed loading normally',
    },
    {
      label: 'Calendar',
      state: latestByService.calendar ? 'Attention' : 'Healthy',
      tone: latestByService.calendar ? '#f59e0b' : '#10b981',
      sub: latestByService.calendar ? latestByService.calendar.message : 'Calendar data loading normally',
    },
  ];
  // Use live DB user data for name/email when logged in
  const displayName  = currentUser ? currentUser.name     : s.name;
  const displayEmail = currentUser ? currentUser.email    : s.email;
  const displayUser  = currentUser ? '@' + currentUser.username : s.username;
  const initials  = getInitials(displayName);
  const avatarCol = getAvatarColor(displayName);
  const canViewOps = currentUser?.tier === 'enterprise';

  if (canViewOps && !opsStatusState.loading && !opsStatusState.data && !opsStatusState.error) {
    loadOpsStatus().catch(() => {});
  }

  document.getElementById('tab-settings').innerHTML = `
    <div class="settings-page">
    <div class="section-title"><h2>Settings</h2><p>Manage your profile, plan, preferences, and diagnostics.</p></div>

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
            <div class="settings-row-icon" style="background:#3b82f614;color:#2f7d5a">${iconMarkup('notification-01', 'settings-icon-glyph')}</div>
            <div><p class="settings-row-title">Push Notifications</p><p class="settings-row-sub">Market updates & news alerts</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.notifications?'checked':''} onchange="saveSettings({notifications:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#10b98114;color:#2f7d5a">${iconMarkup('chart-03', 'settings-icon-glyph')}</div>
            <div><p class="settings-row-title">Price Alerts</p><p class="settings-row-sub">Notify when watchlist moves ±5%</p></div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${s.priceAlerts?'checked':''} onchange="saveSettings({priceAlerts:this.checked})">
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#8b5cf614;color:#7c3aed">${iconMarkup('chart', 'settings-icon-glyph')}</div>
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
        <div class="settings-row settings-row-stack">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#06b6d414">UI</div>
            <div><p class="settings-row-title">Workspace Style</p><p class="settings-row-sub">Choose the experience level and visual density for the app.</p></div>
          </div>
          <div class="ui-mode-grid">
            ${Object.entries(UI_MODES).map(([key, mode]) => `
              <button class="ui-mode-card ${s.uiMode === key ? 'active' : ''}" onclick="saveSettings({uiMode:'${key}'})">
                <span class="ui-mode-kicker">${escHtml(mode.level)}</span>
                <span class="ui-mode-title">${escHtml(mode.label)}</span>
                <span class="ui-mode-sub">${escHtml(mode.sub)}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#f59e0b14;color:#3b82f6">${iconMarkup('money-exchange-03', 'settings-icon-glyph')}</div>
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
            <div class="settings-row-icon" style="background:#ef444414;color:#8b5cf6">${iconMarkup('view-off', 'settings-icon-glyph')}</div>
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
            <div class="settings-row-icon" style="background:#10b98114;color:#06b6d4">${iconMarkup('balance-scale', 'settings-icon-glyph')}</div>
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
            <div class="settings-row-icon" style="background:#3b82f614;color:#64748b">${iconMarkup('time-04', 'settings-icon-glyph')}</div>
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
            <div class="settings-row-icon" style="background:#8b5cf614;color:#7c3aed">${iconMarkup('chart', 'settings-icon-glyph')}</div>
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
      <div class="settings-group settings-group-pad settings-group-stack settings-billing-group" style="overflow:hidden">
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:${tierInfo.iconBg};color:${tierInfo.chipColor}">${iconMarkup('crown-03', 'settings-icon-glyph')}</div>
            <div>
              <p class="settings-row-title">Current Plan</p>
              <p class="settings-row-sub">${tierInfo.sub}</p>
            </div>
          </div>
          <span class="settings-plan-chip" style="background:${tierInfo.chipBg};color:${tierInfo.chipColor}">${tierInfo.label}</span>
        </div>
        <div class="settings-row">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:#10b98114;color:#10b981">${iconMarkup('coins-01', 'settings-icon-glyph')}</div>
            <div>
              <p class="settings-row-title">Credits Remaining</p>
              <p class="settings-row-sub">Resets monthly · 5 per analysis, 2 per news AI</p>
            </div>
          </div>
          <span class="settings-credit-pill">${currentUser.finbot_credits??0}</span>
        </div>
        <div style="padding:14px 16px 16px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:12px">
          <div class="settings-toolbar">
            <div>
              <p style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px">Upgrade or manage your plan</p>
              <p style="font-size:12px;color:var(--muted);line-height:1.55">Basic is ideal for lighter monthly use, while Pro and Enterprise give you more FinBot credits every month.</p>
            </div>
            <button class="settings-select" onclick="openBillingSupport()" style="cursor:pointer;min-width:150px">Billing Support</button>
          </div>
          ${renderBillingPlanCards(currentUser.tier || 'free')}
          ${currentUser.billing_status ? `
            <div class="settings-note-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
              <div>
                <p style="font-size:12px;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:0.05em">Billing Status</p>
                <p style="font-size:12px;color:var(--muted);margin-top:3px">${escHtml(currentUser.billing_status)}</p>
              </div>
              ${currentUser.current_period_end ? `<span style="font-size:12px;color:var(--muted)">Renews ${new Date(currentUser.current_period_end).toLocaleDateString()}</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- System Status -->
    <div class="settings-section">
      <p class="settings-section-label">System Status</p>
      <div class="settings-group settings-group-pad settings-group-stack settings-status-group">
        <div class="settings-status-grid">
          ${serviceStatus.map(item => `
            <div class="settings-status-card">
              <div class="settings-status-head">
                <span class="settings-status-title">${item.label}</span>
                <span class="settings-status-pill" style="background:${item.tone}18;color:${item.tone}">${item.state}</span>
              </div>
              <p class="settings-status-sub">${escHtml(item.sub)}</p>
            </div>
          `).join('')}
        </div>

        <div class="settings-toolbar">
          <div>
            <p class="settings-panel-title">Recent diagnostics</p>
            <p class="settings-panel-sub">Last 5 captured runtime issues from auth, FinBot, markets, news, and calendar.</p>
          </div>
          <button class="settings-select" onclick="clearDiagnosticsLog()" style="cursor:pointer;min-width:140px">Clear Diagnostics</button>
        </div>

        ${recentIssues.length ? `
          <div class="settings-log-list">
            ${recentIssues.map(issue => `
              <div class="settings-log-card">
                <div class="settings-log-head">
                  <div class="settings-log-meta">
                    <span class="settings-status-pill" style="background:${issue.severity === 'error' ? '#ef444418' : '#f59e0b18'};color:${issue.severity === 'error' ? '#ef4444' : '#f59e0b'}">${issue.severity}</span>
                    <span class="settings-log-service">${escHtml(issue.service)}</span>
                  </div>
                  <span class="settings-log-time">${formatDiagnosticsTime(issue.at)}</span>
                </div>
                <p class="settings-log-body">${escHtml(issue.message)}</p>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="settings-note-card">
            <p class="settings-note-sub">No runtime issues have been captured recently. Once the app hits a real auth, function, or market-data problem, it will appear here.</p>
          </div>
        `}
      </div>
    </div>

    ${canViewOps ? `
    <div class="settings-section">
      <p class="settings-section-label">Server Health</p>
      <div class="settings-group settings-group-pad settings-group-stack settings-ops-group">
        <div class="settings-toolbar">
          <div>
            <p class="settings-panel-title">Supabase function activity</p>
            <p class="settings-panel-sub">Recent backend signals from FinBot and market-data.</p>
          </div>
          <button class="settings-select" onclick="loadOpsStatus(true)" style="cursor:pointer;min-width:140px">${opsStatusState.loading ? 'Refreshing…' : 'Refresh Health'}</button>
        </div>

        ${opsStatusState.loading && !opsData ? `
          <div class="settings-note-card">
            <p class="settings-note-sub">Loading server-side health data…</p>
          </div>
        ` : ''}

        ${opsStatusState.error ? `
          <div class="error-box" style="margin:0">
            <p style="font-weight:700;font-size:14px;color:var(--red)">Server diagnostics unavailable</p>
            <p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#b91c1c">${escHtml(opsStatusState.error)}</p>
          </div>
        ` : ''}

        ${opsData ? `
          <div class="settings-status-grid">
            ${Object.entries(opsData.plan_counts || {}).map(([plan, count]) => `
              <div class="settings-status-card">
                <p class="settings-status-label">${escHtml(plan)} users</p>
                <p class="settings-metric-value">${Number(count || 0)}</p>
              </div>
            `).join('')}
            <div class="settings-status-card">
              <p class="settings-status-label">Low credits</p>
              <p class="settings-metric-value" style="color:${Number(opsData.low_credit_users || 0) > 0 ? '#f59e0b' : 'var(--text)'}">${Number(opsData.low_credit_users || 0)}</p>
            </div>
          </div>

          <div class="settings-status-grid settings-status-grid-wide">
            ${Object.entries(opsData.service_summary || {}).map(([service, info]) => `
              <div class="settings-status-card">
                <div class="settings-status-head">
                  <span class="settings-status-title">${escHtml(service)}</span>
                  <span class="settings-log-time">${formatDiagnosticsTime(info.lastAt)}</span>
                </div>
                <p class="settings-status-sub">Last event: ${escHtml(info.lastEvent || 'none')}</p>
                <div class="settings-chip-row">
                  <span class="settings-status-pill" style="background:#ef444418;color:#ef4444">Errors ${Number(info.errors || 0)}</span>
                  <span class="settings-status-pill" style="background:#f59e0b18;color:#f59e0b">Warns ${Number(info.warns || 0)}</span>
                </div>
              </div>
            `).join('') || `
              <div class="settings-note-card">
                <p class="settings-note-sub">No server-side events captured in the last 24 hours.</p>
              </div>
            `}
          </div>

          <div class="settings-log-list">
            ${(opsData.recent_events || []).map(event => `
              <div class="settings-log-card">
                <div class="settings-log-head">
                  <div class="settings-log-meta">
                    <span class="settings-status-pill" style="background:${event.level === 'error' ? '#ef444418' : event.level === 'warn' ? '#f59e0b18' : '#10b98118'};color:${event.level === 'error' ? '#ef4444' : event.level === 'warn' ? '#f59e0b' : '#10b981'}">${escHtml(event.level)}</span>
                    <span class="settings-log-service">${escHtml(event.service)} · ${escHtml(event.event)}</span>
                  </div>
                  <span class="settings-log-time">${formatDiagnosticsTime(event.created_at)}</span>
                </div>
                ${event.detail ? `<p class="settings-log-body">${escHtml(event.detail)}</p>` : ''}
                ${event.meta?.estimatedCost ? `<p class="settings-log-body">Tokens: ${Number(event.meta?.usage?.inputTokens || 0).toLocaleString()} in / ${Number(event.meta?.usage?.outputTokens || 0).toLocaleString()} out · Est cost: $${escHtml(String(event.meta.estimatedCost.totalUsd ?? '0'))} / R${escHtml(String(event.meta.estimatedCost.totalZar ?? '0'))}</p>` : ''}
              </div>
            `).join('') || `
              <div class="settings-note-card">
                <p class="settings-note-sub">No recent server-side events yet.</p>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    </div>
    ` : ''}


    <!-- Account -->
    <div class="settings-section">
      <p class="settings-section-label">Account</p>
      <div class="settings-group settings-group-pad settings-group-stack settings-account-group">
        ${currentUser ? `
          <button class="modal-save-btn" style="background:#3b82f6" onclick="manageSignInEmail()">Manage Sign-In Email</button>
          <button class="modal-save-btn" style="background:#1e293b" onclick="doLogout()">Sign Out</button>
        ` : `<button class="modal-save-btn" onclick="document.getElementById('auth-overlay').classList.remove('hidden')">Sign In / Create Account</button>`}
        <button class="danger-btn" onclick="resetAllSettings()">Reset All Settings</button>
      </div>
    </div>

    <div style="height:8px"></div>
    </div>
  `;
  scheduleUiIconRefresh(document.getElementById('tab-settings'));
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
    const d = await authRequest('change-password', 'POST', {
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
  ensurePreferredSectorsModal();
  const s = loadSettings();
  const input = document.getElementById('preferred-sectors-input');
  if (input) input.value = s.defaultSectors || '';
  document.getElementById('preferred-sectors-modal')?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 30);
}

function ensurePreferredSectorsModal() {
  if (document.getElementById('preferred-sectors-modal')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="preferred-sectors-modal" class="modal-overlay hidden" onclick="if(event.target===this)closePreferredSectorsModal()">
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <p class="modal-title">Preferred Sectors</p>
        <div class="modal-field">
          <label class="form-label">Tell FinBot what you like to focus on</label>
          <textarea id="preferred-sectors-input" class="form-textarea" rows="4"
            placeholder="Tech, Finance, Healthcare"
            onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter')savePreferredSectors()"></textarea>
          <p class="form-hint">Use commas to separate sectors. Example: Tech, Finance, Healthcare</p>
        </div>
        <div id="preferred-sectors-error" class="auth-error"></div>
        <button class="modal-save-btn" onclick="savePreferredSectors()">Save Sectors</button>
        <button class="modal-cancel" onclick="closePreferredSectorsModal()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);
}

function closePreferredSectorsModal() {
  document.getElementById('preferred-sectors-modal')?.classList.add('hidden');
}

function savePreferredSectors() {
  const input = document.getElementById('preferred-sectors-input');
  const errorEl = document.getElementById('preferred-sectors-error');
  const value = (input?.value || '').trim();
  if (value.length > 160) {
    if (errorEl) {
      errorEl.textContent = 'Please keep preferred sectors under 160 characters.';
      errorEl.classList.add('show');
    }
    return;
  }
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }
  saveSettings({ defaultSectors: value });
  closePreferredSectorsModal();
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
let authLoginMethod = 'otp';

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

async function invokeFinBotFunction(payload) {
  const sb = getSupabase();
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) {
    const message = sessionError.message || 'Could not verify your session.';
    logAppIssue('auth', message, 'error');
    throw new Error(message);
  }
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    logAppIssue('auth', 'Please sign in again to use FinBot.', 'warn');
    throw new Error('Please sign in again to use FinBot.');
  }
  const { data, error } = await sb.functions.invoke('finbot', {
    body: payload,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    let contextMessage = '';
    const ctx = error.context;
    if (ctx && typeof ctx === 'object') {
      try {
        if (typeof ctx.clone === 'function') {
          const cloned = ctx.clone();
          const parsed = await cloned.json().catch(() => null);
          if (parsed && typeof parsed === 'object') {
            contextMessage = parsed.error || parsed.message || JSON.stringify(parsed);
          } else if (typeof cloned.text === 'function') {
            contextMessage = (await cloned.text()).trim();
          }
        }
      } catch (_) {}
    }
    const rawMessage = [error.message, contextMessage].filter(Boolean).join(' ').trim();
    const lowered = rawMessage.toLowerCase();
    if (lowered.includes('404') || lowered.includes('failed to send a request')) {
      const message = 'FinBot is not deployed yet. Deploy the Supabase "finbot" Edge Function first.';
      logAppIssue('finbot', message, 'error');
      throw new Error(message);
    }
    const message = describeAppError(rawMessage, 'FinBot is unavailable right now.');
    logAppIssue('finbot', message, 'error');
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') {
    logAppIssue('finbot', 'FinBot returned an invalid response.', 'error');
    throw new Error('FinBot returned an invalid response.');
  }
  return data;
}

async function invokeMarketDataFunction(payload) {
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke('market-data', { body: payload });
  if (error) {
    let contextMessage = '';
    const ctx = error.context;
    if (ctx && typeof ctx === 'object') {
      try {
        if (typeof ctx.clone === 'function') {
          const cloned = ctx.clone();
          const parsed = await cloned.json().catch(() => null);
          if (parsed && typeof parsed === 'object') {
            contextMessage = parsed.error || parsed.message || JSON.stringify(parsed);
          } else if (typeof cloned.text === 'function') {
            contextMessage = (await cloned.text()).trim();
          }
        }
      } catch (_) {}
    }
    const message = describeAppError([error.message, contextMessage].filter(Boolean).join(' ').trim(), 'Market data is unavailable right now.');
    throw new Error(message);
  }
  return data;
}

async function invokeOpsStatusFunction() {
  const sb = getSupabase();
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error(sessionError.message || 'Could not verify your session.');
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Please sign in again to view system diagnostics.');

  const { data, error } = await sb.functions.invoke('ops-status', {
    body: {},
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    let contextMessage = '';
    const ctx = error.context;
    if (ctx && typeof ctx === 'object') {
      try {
        if (typeof ctx.clone === 'function') {
          const cloned = ctx.clone();
          const parsed = await cloned.json().catch(() => null);
          if (parsed && typeof parsed === 'object') {
            contextMessage = parsed.error || parsed.message || JSON.stringify(parsed);
          } else if (typeof cloned.text === 'function') {
            contextMessage = (await cloned.text()).trim();
          }
        }
      } catch (_) {}
    }
    throw new Error(describeAppError([error.message, contextMessage].filter(Boolean).join(' ').trim(), 'System diagnostics are unavailable right now.'));
  }
  return data;
}

async function invokeBillingFunction(payload) {
  const sb = getSupabase();
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error(sessionError.message || 'Could not verify your session.');
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Please sign in again to manage billing.');

  const { data, error } = await sb.functions.invoke('paystack-billing', {
    body: payload,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    let contextMessage = '';
    const ctx = error.context;
    if (ctx && typeof ctx === 'object') {
      try {
        if (typeof ctx.clone === 'function') {
          const cloned = ctx.clone();
          const parsed = await cloned.json().catch(() => null);
          if (parsed && typeof parsed === 'object') {
            contextMessage = parsed.error || parsed.message || JSON.stringify(parsed);
          } else if (typeof cloned.text === 'function') {
            contextMessage = (await cloned.text()).trim();
          }
        }
      } catch (_) {}
    }
    throw new Error(describeAppError([error.message, contextMessage].filter(Boolean).join(' ').trim(), 'Billing is unavailable right now.'));
  }
  return data;
}

function openBillingSupport() {
  window.location.href = 'mailto:support@investeasy.app?subject=FinScope billing help';
}

async function startTierCheckout(targetTier) {
  if (!currentUser) {
    document.getElementById('auth-overlay')?.classList.remove('hidden');
    showAuthTab('login');
    return;
  }
  if (!BILLING_PLANS[targetTier]) {
    showToast('That plan is not available right now.');
    return;
  }
  billingCheckoutInFlight = targetTier;
  if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
  if (document.getElementById('tab-finbot')?.classList.contains('active')) renderFinBot();
  try {
    const data = await invokeBillingFunction({ action: 'create_checkout', tier: targetTier });
    if (!data?.authorization_url) throw new Error('Paystack checkout did not return a redirect URL.');
    window.location.href = data.authorization_url;
  } catch (error) {
    showToast(describeAppError(error, 'Could not start checkout right now.'));
    billingCheckoutInFlight = '';
    if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
    if (document.getElementById('tab-finbot')?.classList.contains('active')) renderFinBot();
  }
}

async function processBillingReturnState() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  if (!reference || !currentUser) return;
  try {
    const data = await invokeBillingFunction({ action: 'verify_checkout', reference });
    if (data?.tier) {
      await checkAuth();
      const label = getTierPresentation(data.tier).label;
      showToast(`${label} plan activated.`);
    }
  } catch (error) {
    showToast(describeAppError(error, 'We could not confirm your payment yet.'));
  } finally {
    params.delete('reference');
    params.delete('trxref');
    params.delete('billing');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
    billingCheckoutInFlight = '';
    if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
    if (document.getElementById('tab-finbot')?.classList.contains('active')) renderFinBot();
  }
}

async function loadOpsStatus(force = false) {
  if (!currentUser) return null;
  if (!force && opsStatusState.data && (Date.now() - opsStatusState.loadedAt) < 60 * 1000) {
    return opsStatusState.data;
  }
  opsStatusState.loading = true;
  opsStatusState.error = '';
  if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
  try {
    const data = await invokeOpsStatusFunction();
    opsStatusState = {
      loading: false,
      error: '',
      data,
      loadedAt: Date.now(),
    };
    return data;
  } catch (error) {
    opsStatusState = {
      loading: false,
      error: describeAppError(error, 'System diagnostics are unavailable right now.'),
      data: null,
      loadedAt: Date.now(),
    };
    return null;
  } finally {
    if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
  }
}

async function fetchMarketData(action, params = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Market data requires the Supabase "market-data" function.');
  }
  return invokeMarketDataFunction({ action, ...params });
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
    billing_status: profile.billing_status || 'inactive',
    current_period_end: profile.current_period_end ?? null,
    billing_provider: profile.billing_provider || null,
    billing_customer_code: profile.billing_customer_code || null,
    billing_subscription_code: profile.billing_subscription_code || null,
    age: profile.age ?? meta.age ?? null,
    created_at: profile.created_at || authUser.created_at || null,
  };
}

function getTierPresentation(tier = 'free') {
  if (tier === 'enterprise') {
    return {
      label: 'Enterprise',
      sub: '300 credits/month - Full access',
      chipBg: '#d9770622',
      chipColor: '#fbbf24',
      iconBg: '#d9770614',
      icon: iconMarkup('award')
    };
  }
  if (tier === 'pro') {
    return {
      label: 'Pro',
      sub: '100 credits/month - Full access',
      chipBg: '#7c3aed22',
      chipColor: '#a78bfa',
      iconBg: '#7c3aed14',
      icon: iconMarkup('bolt')
    };
  }
  if (tier === 'basic') {
    return {
      label: 'Basic',
      sub: '50 credits/month - Starter AI access',
      chipBg: '#10b98122',
      chipColor: '#10b981',
      iconBg: '#10b98114',
      icon: iconMarkup('spark')
    };
  }
  return {
    label: 'Free',
    sub: '0 credits/month - Core access',
    chipBg: '#64748b22',
    chipColor: '#64748b',
    iconBg: '#64748b14',
    icon: iconMarkup('spark')
  };
}

function tierRank(tier = 'free') {
  const idx = TIER_ORDER.indexOf(String(tier || 'free').toLowerCase());
  return idx >= 0 ? idx : 0;
}

function renderBillingPlanCards(currentTier = currentUser?.tier || 'free') {
  return Object.entries(BILLING_PLANS).map(([tier, plan]) => {
    const isCurrent = currentTier === tier;
    const canUpgrade = tierRank(tier) > tierRank(currentTier);
    const buttonLabel = isCurrent ? 'Current plan' : canUpgrade ? `Upgrade to ${plan.label}` : 'Contact support';
    const buttonAction = isCurrent
      ? ''
      : canUpgrade
        ? `onclick="startTierCheckout('${tier}')"`
        : `onclick="openBillingSupport()"`;
    const disabledAttr = isCurrent ? 'disabled' : '';
    return `
      <div class="billing-plan-card" style="padding:14px;border-radius:16px;border:1px solid ${plan.tone}33;background:linear-gradient(135deg,${plan.badgeBg},#ffffff);display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <p class="billing-plan-title" style="font-size:14px;font-weight:800;color:${plan.tone};margin-bottom:4px">${plan.label}</p>
            <p class="billing-plan-desc" style="font-size:12px;color:var(--muted);line-height:1.5">${plan.desc}</p>
          </div>
          <span class="billing-plan-price" style="font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;background:${plan.badgeBg};color:${plan.tone}">R${plan.priceZar}/mo</span>
        </div>
        <div class="billing-plan-detail" style="font-size:12px;color:var(--text);line-height:1.6">
          <strong>${plan.credits} credits/month</strong><br>
          FinBot news uses 2 credits - Analysis uses 5 credits
        </div>
        <button ${buttonAction} ${disabledAttr}
          style="padding:10px 12px;border-radius:12px;border:${isCurrent ? '1px solid var(--border)' : 'none'};background:${isCurrent ? 'var(--border)' : plan.tone};color:${isCurrent ? 'var(--muted)' : '#fff'};font-size:12px;font-weight:800;cursor:${isCurrent ? 'default' : 'pointer'};opacity:${billingCheckoutInFlight && billingCheckoutInFlight !== tier ? '.75' : '1'}">
          ${billingCheckoutInFlight === tier ? 'Redirecting...' : buttonLabel}
        </button>
      </div>
    `;
  }).join('');
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

function describeAppError(error, fallback = 'Something went wrong. Please try again.') {
  const raw = typeof error === 'string' ? error : (error?.message || '');
  if (!raw) return fallback;
  const msg = raw.trim();
  const lower = msg.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Network connection issue. Please check your internet connection and try again.';
  }
  if (lower.includes('invalid jwt') || lower.includes('jwt')) {
    return 'Your session has expired. Please sign in again and retry.';
  }
  if (lower.includes('not configured')) {
    return 'This feature is not configured correctly yet. Please try again later.';
  }
  if (lower.includes('rate limit')) {
    return 'That request is being rate limited right now. Please wait a moment and try again.';
  }
  return msg || fallback;
}

function showTransientErrorNotice(key, message, cooldownMs = 120000) {
  const now = Date.now();
  if ((transientErrorNotices[key] || 0) + cooldownMs > now) return;
  transientErrorNotices[key] = now;
  showToast(message, 3200);
}

const DIAGNOSTICS_KEY = 'fs_diagnostics';
const DIAGNOSTICS_ACTIVE_MS = 15 * 60 * 1000;

function getDiagnosticsLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function logAppIssue(service, error, severity = 'error') {
  const message = describeAppError(error);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    service,
    severity,
    message,
    at: Date.now(),
  };
  const next = [entry, ...getDiagnosticsLog()].slice(0, 20);
  try { localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next)); } catch (_) {}
}

function clearAppIssues(service) {
  if (!service) return;
  const next = getDiagnosticsLog().filter(entry => entry.service !== service);
  try { localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next)); } catch (_) {}
}

function getActiveDiagnosticsLog() {
  const cutoff = Date.now() - DIAGNOSTICS_ACTIVE_MS;
  return getDiagnosticsLog().filter(entry => Number(entry.at || 0) >= cutoff);
}

function clearDiagnosticsLog() {
  localStorage.removeItem(DIAGNOSTICS_KEY);
  if (document.getElementById('tab-settings')?.classList.contains('active')) renderSettings();
}

function formatDiagnosticsTime(ts) {
  if (!ts) return 'Unknown time';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60 * 1000) return 'Just now';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 60 * 1000))}h ago`;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function handleAuthAction(action, method, body) {
  const sb = getSupabase();
  switch (action) {
    case 'me': {
      const user = await loadCurrentUserFromSupabase();
      return user ? { success: true, user } : { success: false, error: 'Not logged in' };
    }
    case 'login': {
      const loginMethod = body.method === 'password' ? 'password' : 'otp';
      if (loginMethod === 'password') {
        const { data, error } = await sb.auth.signInWithPassword({
          email: body.email,
          password: body.password || ''
        });
        if (error) return { success: false, error: error.message };
        const mapped = await loadCurrentUserFromSupabase();
        currentUser = mapped || normalizeCurrentUser(data.user, {});
        return { success: true, user: currentUser, message: 'Signed in successfully.' };
      }
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
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      currentUser = null;
      updateHeaderUser();
      return;
    }
    window.setTimeout(async () => {
      let profile = null;
      try {
        profile = await ensureProfileRow(session.user);
      } catch (e) {}
      currentUser = normalizeCurrentUser(session.user, profile || {});
      updateHeaderUser();
    }, 0);
  });
  supabaseAuthListenerBound = true;
}

async function authRequest(action, method = 'GET', body = {}) {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured. Add your project URL and anon key to supabase-config.js.' };
  }
  bindSupabaseAuthListener();
  return handleAuthAction(action, method, body);
}

async function dataRequest(action, method = 'GET', body = {}) {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured. Add your project URL and anon key to supabase-config.js.' };
  }
  bindSupabaseAuthListener();
  return handleDataAction(action, method, body);
}


// ── Auth overlay helpers ──────────────────────────────────────────────────────
function setAuthLoginMethod(method = 'otp') {
  authLoginMethod = method === 'password' ? 'password' : 'otp';
  const otpBtn = document.getElementById('auth-login-method-otp');
  const passwordBtn = document.getElementById('auth-login-method-password');
  otpBtn?.classList.toggle('active', authLoginMethod === 'otp');
  passwordBtn?.classList.toggle('active', authLoginMethod === 'password');

  const passwordField = document.getElementById('login-password-field');
  const passwordInput = document.getElementById('login-password');
  const loginBtn = document.getElementById('login-btn');
  const loginNote = document.getElementById('login-otp-note');

  if (passwordField) passwordField.style.display = authLoginMethod === 'password' ? '' : 'none';
  if (loginBtn) loginBtn.textContent = authLoginMethod === 'password' ? 'Sign In with Password' : 'Send Sign-In Code';
  if (loginNote) {
    loginNote.textContent = authLoginMethod === 'password'
      ? 'Use your account password to sign in instantly.'
      : "We'll email you a 6-digit code to sign in securely.";
  }
  if (passwordInput && authLoginMethod !== 'password') passwordInput.value = '';
}

function toggleLoginPasswordVisibility() {
  const input = document.getElementById('login-password');
  const toggle = document.getElementById('login-password-toggle');
  if (!input || !toggle) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  toggle.textContent = showing ? 'Show' : 'Hide';
  toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

function showAuthTab(mode) {
  ensureOtpAuthUi();
  ['remember-login', 'remember-register'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = shouldRememberSession();
  });
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
  const loginForm = document.getElementById('auth-login-form');
  const regPassword = document.getElementById('reg-password');
  if (regPassword && regPassword.closest('.auth-field')) regPassword.closest('.auth-field').style.display = 'none';

  let loginSwitch = document.getElementById('auth-login-method-switch');
  if (!loginSwitch && loginForm) {
    loginSwitch = document.createElement('div');
    loginSwitch.id = 'auth-login-method-switch';
    loginSwitch.className = 'auth-method-switch';
    loginSwitch.innerHTML = `
      <button type="button" class="auth-method-btn active" id="auth-login-method-otp" onclick="setAuthLoginMethod('otp')">Email Code</button>
      <button type="button" class="auth-method-btn" id="auth-login-method-password" onclick="setAuthLoginMethod('password')">Password</button>
    `;
    loginForm.insertBefore(loginSwitch, loginForm.firstElementChild);
  }

  const loginInput = document.getElementById('login-email');
  let passwordField = document.getElementById('login-password-field');
  if (!passwordField && loginInput && loginInput.parentElement) {
    passwordField = document.createElement('div');
    passwordField.className = 'auth-field';
    passwordField.id = 'login-password-field';
    passwordField.style.display = 'none';
    passwordField.innerHTML = `
      <label class="form-label">Password</label>
      <div class="auth-password-wrap">
        <input id="login-password" class="form-input" type="password" placeholder="Enter your password" autocomplete="current-password"
          onkeydown="if(event.key==='Enter')doLogin()">
        <button type="button" id="login-password-toggle" class="auth-password-toggle" onclick="toggleLoginPasswordVisibility()" aria-label="Show password">Show</button>
      </div>
    `;
    loginInput.parentElement.insertAdjacentElement('afterend', passwordField);
  }

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
  setAuthLoginMethod(authLoginMethod);
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
function shouldRememberSession() {
  return localStorage.getItem(REMEMBER_ME_KEY) !== '0';
}
function setRememberPreference(remember) {
  localStorage.setItem(REMEMBER_ME_KEY, remember ? '1' : '0');
}
function getRememberChoice(mode = 'login') {
  const id = mode === 'register' ? 'remember-register' : 'remember-login';
  const el = document.getElementById(id);
  return el ? !!el.checked : true;
}
function setAuthLoading(loading, activeAction = 'all') {
  ensureOtpAuthUi();
  const loginIdleText = authLoginMethod === 'password' ? 'Sign In with Password' : 'Send Sign-In Code';
  const loginBusyText = authLoginMethod === 'password' ? 'Signing In…' : 'Sending Code…';
  const buttonStates = {
    'login-btn': [loginIdleText, loginBusyText],
    'register-btn': ['Send Sign-Up Code', 'Sending Code…'],
    'otp-btn': ['Verify Code', 'Verifying…'],
    'otp-resend-btn': ['Resend Code', 'Resending…'],
  };
  Object.entries(buttonStates).forEach(([id, [idleText, busyText]]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const shouldShowBusy = loading && (activeAction === 'all' || activeAction === id);
    el.disabled = loading;
    el.textContent = shouldShowBusy ? busyText : idleText;
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
  if (!shouldRememberSession() && isSupabaseConfigured()) {
    try { await getSupabase().auth.signOut(); } catch (e) {}
    currentUser = null;
    updateHeaderUser();
    return;
  }
  try {
    const d = await authRequest('me');
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
  const password = document.getElementById('login-password')?.value || '';
  const remember = getRememberChoice('login');
  if (!email) { showAuthError('Please enter your email address.'); return; }
  if (authLoginMethod === 'password' && !password) { showAuthError('Please enter your password.'); return; }
  clearAuthError();
  setAuthLoading(true, 'login-btn');
  try {
    const d = await authRequest('login', 'POST', { email, password, method: authLoginMethod });
    if (d.success) {
      setRememberPreference(remember);
      if (authLoginMethod === 'password') {
        pendingOtp = null;
        currentUser = d.user || currentUser;
        await syncAfterLogin();
        document.getElementById('auth-overlay').classList.add('hidden');
      } else {
        setPendingOtp({ mode: 'login', email, remember });
        showAuthTab('otp');
        showAuthSuccess(d.message || 'We sent your sign-in code.');
      }
    } else {
      const message = describeAppError(d.error, 'Login failed. Please try again.');
      logAppIssue('auth', message, 'warn');
      showAuthError(message);
    }
  } catch(e) {
    const message = describeAppError(e, 'Connection error. Please try again.');
    logAppIssue('auth', message, 'error');
    showAuthError(message);
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
  const remember = getRememberChoice('register');
  if (!name || !email || !username) { showAuthError('Name, email, and username are required.'); return; }
  if (age !== null && (isNaN(age) || age < 13 || age > 120)) { showAuthError('Please enter a valid age (13–120).'); return; }
  clearAuthError();
  setAuthLoading(true, 'register-btn');
  try {
    const d = await authRequest('register', 'POST', { name, email, username, age });
    if (d.success) {
      setRememberPreference(remember);
      setPendingOtp({ mode: 'register', email, name, username, age, remember });
      showAuthTab('otp');
      showAuthSuccess(d.message || 'We sent your sign-up code.');
    } else {
      const message = describeAppError(d.error, 'Registration failed. Please try again.');
      logAppIssue('auth', message, 'warn');
      showAuthError(message);
    }
  } catch(e) {
    const message = describeAppError(e, 'Connection error. Please try again.');
    logAppIssue('auth', message, 'error');
    showAuthError(message);
  }
  setAuthLoading(false);
}

// ── Forgot Password — send reset link via email ───────────────────────────────
async function verifyOtpCode() {
  const code = document.getElementById('otp-code').value.trim();
  if (!pendingOtp?.email) { showAuthError('Start by requesting a sign-in code first.'); return; }
  if (!/^\d{6}$/.test(code)) { showAuthError('Enter the full 6-digit code.'); return; }
  clearAuthError();
  setAuthLoading(true, 'otp-btn');
  try {
    const sb = getSupabase();
    const verifyTypes = pendingOtp.mode === 'register'
      ? ['email', 'signup']
      : ['email', 'magiclink'];
    let data = null;
    let error = null;

    for (const type of verifyTypes) {
      const result = await sb.auth.verifyOtp({
        email: pendingOtp.email,
        token: code,
        type
      });
      if (!result.error && result.data?.user) {
        data = result.data;
        error = null;
        break;
      }
      error = result.error || new Error('Verification failed.');
    }

    if (error || !data?.user) {
      const message = describeAppError(error, 'Verification failed. Please try again.');
      logAppIssue('auth', message, 'warn');
      showAuthError(message);
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
    const message = describeAppError(e, 'Connection error. Please try again.');
    logAppIssue('auth', message, 'error');
    showAuthError(message);
  }
  setAuthLoading(false);
}

async function resendOtpCode() {
  if (!pendingOtp?.email) { showAuthError('Start by requesting a code first.'); return; }
  clearAuthError();
  setAuthLoading(true, 'otp-resend-btn');
  try {
    const action = pendingOtp.mode === 'register' ? 'register' : 'login';
    const d = await authRequest(action, 'POST', {
      email: pendingOtp.email,
      name: pendingOtp.name,
      username: pendingOtp.username,
      age: pendingOtp.age
    });
    if (d.success) {
      showAuthSuccess(d.message || 'A fresh code is on the way.');
    } else {
      const message = describeAppError(d.error, 'Failed to resend the code.');
      logAppIssue('auth', message, 'warn');
      showAuthError(message);
    }
  } catch(e) {
    const message = describeAppError(e, 'Connection error. Please try again.');
    logAppIssue('auth', message, 'error');
    showAuthError(message);
  }
  setAuthLoading(false);
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function doLogout() {
  try { await authRequest('logout', 'POST'); } catch(e) {}
  localStorage.removeItem('ie_auth_token');
  pendingOtp              = null;
  currentUser            = null;
  opsStatusState         = { loading: false, error: '', data: null, loadedAt: 0 };
  resetFinBotChat();
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
  setupHeaderDropdown();
  ensureNotificationCenter();
  document.querySelectorAll('nav.nav .auth-only').forEach(b => {
    b.style.display = currentUser ? '' : 'none';
  });
  if (currentUser) {
    authBtns.style.display = 'none';
    userEl.style.display = 'flex';
    un.textContent = String(currentUser.username || '').replace(/^@+/, '');
    av.textContent = (currentUser.name || currentUser.username)[0].toUpperCase();
    const ddName  = document.getElementById('dd-name');
    const ddEmail = document.getElementById('dd-email');
    if (ddName)  ddName.textContent  = currentUser.name || currentUser.username;
    if (ddEmail) ddEmail.textContent = currentUser.email || ('@' + currentUser.username);
    // Tier badge
    const tierColors = { free: '#64748b', basic: '#10b981', pro: '#7c3aed', enterprise: '#d97706' };
    const tierLabels = { free: 'Free', basic: 'Basic', pro: 'Pro', enterprise: 'Enterprise' };
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
      credEl.textContent = `⚡ ${currentUser.finbot_credits ?? 0} credits`;
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
    const d = await dataRequest('settings');
    if (d.success && d.settings) {
      // Merge into localStorage so existing helpers keep working
      const merged = Object.assign(loadSettings(), d.settings);
      localStorage.setItem('ie_settings', JSON.stringify(merged));
    }
  } catch(e) {}
}

async function loadWatchlistFromDB() {
  try {
    const d = await dataRequest('watchlist');
    if (d.success) {
      watchlistSet = new Set(d.watchlist.map(w => w.ticker));
    }
  } catch(e) {}
}

async function loadPortfolioFromDB() {
  try {
    const d = await dataRequest('portfolio');
    if (d.success) dbPortfolio = d.portfolio;
  } catch(e) {}
}

// ── Settings DB save (called by saveSettings in background) ──────────────────
function saveSettingsToDB(updates) {
  if (!currentUser) return;
  dataRequest('settings', 'POST', updates).catch(() => {});
}

// ── Learn progress DB sync ────────────────────────────────────────────────────
let _learnSaveTimer = null;
function saveLearnProgressToDB() {
  if (!currentUser) return;
  clearTimeout(_learnSaveTimer);
  _learnSaveTimer = setTimeout(() => {
    dataRequest('learn_progress', 'POST', { state: learnState }).catch(() => {});
  }, 1500);
}

async function loadLearnProgressFromDB() {
  try {
    const d = await dataRequest('learn_progress');
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
    const d = await authRequest('update-profile', 'POST', { name, email, username });
    if (d.success) { currentUser = Object.assign(currentUser, d.user); return true; }
    return d.error || 'Failed to update profile.';
  } catch(e) { return 'Connection error.'; }
}

// ── Watchlist helpers ─────────────────────────────────────────────────────────
async function toggleWatchlist(ticker, name) {
  if (!currentUser) return;
  if (watchlistSet.has(ticker)) {
    watchlistSet.delete(ticker);
    dataRequest('watchlist', 'DELETE', { ticker }).catch(() => {});
  } else {
    watchlistSet.add(ticker);
    dataRequest('watchlist', 'POST', { ticker, name }).catch(() => {});
  }
  renderMarkets(currentMarketsFilter);
}

// ── Add / Remove Portfolio Holdings ──────────────────────────────────────────
const QUICK_HOLDING_PRICES = {
  SPY: { name: 'SPDR S&P 500 ETF', val: 543.24 },
  QQQ: { name: 'Invesco QQQ Trust', val: 463.11 },
  VOO: { name: 'Vanguard S&P 500 ETF', val: 500.62 },
  VTI: { name: 'Vanguard Total Stock Market ETF', val: 268.35 },
  ARKK: { name: 'ARK Innovation ETF', val: 44.82 },
  GLD: { name: 'SPDR Gold Shares', val: 214.18 },
  SLV: { name: 'iShares Silver Trust', val: 25.06 },
  USO: { name: 'United States Oil Fund', val: 78.34 },
  PDBC: { name: 'Invesco Diversified Commodity Strategy', val: 13.72 },
  PLTM: { name: 'GraniteShares Platinum Trust', val: 9.15 },
};

function getQuickHoldingAsset(ticker, name = '') {
  const symbol = String(ticker || '').trim().toUpperCase();
  const market = RAW_MARKETS.find(m => m.ticker === symbol);
  const fallback = QUICK_HOLDING_PRICES[symbol];
  return {
    ticker: symbol,
    name: name || market?.name || fallback?.name || symbol,
    val: market?.val ?? fallback?.val ?? null,
    currency: market?.currency || fallback?.currency || 'USD',
  };
}

function holdingQuickPick(ticker, name, chipEl) {
  // Decode HTML entities (e.g. &amp; → &) for display
  const txt = document.createElement('textarea');
  txt.innerHTML = name;
  const asset = getQuickHoldingAsset(ticker, txt.value);
  document.getElementById('holding-ticker').value = asset.ticker;
  document.getElementById('holding-name').value   = asset.name;

  // Highlight selected chip, clear others
  document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('selected'));
  if (chipEl) chipEl.classList.add('selected');

  // Show current market price as a hint
  const hintEl   = document.getElementById('holding-price-hint');
  if (hintEl) {
    if (asset.val !== null) {
      hintEl.textContent = 'Market price: ' + fmtNativeUnitPrice(asset.val, asset.currency);
      hintEl.style.display = 'block';
    } else {
      hintEl.textContent = '';
    }
  }

  // Clear stale values and move focus to quantity
  document.getElementById('holding-shares').value = '';
  document.getElementById('holding-cost').value   = asset.val !== null ? Number(asset.val).toFixed(asset.val < 10 ? 4 : 2) : '';
  document.getElementById('holding-error').textContent = '';
  document.getElementById('holding-error').classList.remove('show');
  document.getElementById('holding-shares').focus();
}

function importPortfolioToFinBot(field, textareaId) {
  if (!currentUser || !dbPortfolio.length) return;
  const enriched = dbPortfolio.map(h => {
    const mkt = RAW_MARKETS.find(m => m.ticker === h.ticker);
    const currency = mkt?.currency || h.currency || 'USD';
    const cur  = nativeToUsd(mkt ? mkt.val : h.avg_cost, currency);
    return { ...h, val: h.shares * cur };
  });
  const total = enriched.reduce((s, h) => s + h.val, 0);
  const str   = enriched.map(h => {
    const pct = total > 0 ? Math.round(h.val / total * 100) : 0;
    return `${h.ticker} ${pct}%`;
  }).join(', ');
  finbotForm[field] = str;
  if (field === 'portfolio' && total > 0) finbotForm.portVal = fmtMoney(total);
  const ta = document.getElementById(textareaId);
  if (ta) { ta.value = str; ta.dispatchEvent(new Event('input')); }
  // Flash button feedback
  const btn = document.querySelector(`[data-import="${field}"]`);
  if (btn) { btn.textContent = '✓ Imported'; setTimeout(() => btn.textContent = '↓ Import portfolio', 1500); }
}

function ensurePortfolioImportModal() {
  let modal = document.getElementById('portfolio-import-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'portfolio-import-modal';
  modal.className = 'modal-overlay hidden';
  modal.onclick = e => { if (e.target === modal) closeImportPortfolioModal(); };
  modal.innerHTML = `
    <div class="modal-sheet portfolio-import-sheet" onclick="event.stopPropagation()">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px">
        <div>
          <p class="modal-title" style="margin-bottom:4px">Import Holdings</p>
          <p style="font-size:12px;color:var(--muted);line-height:1.5">Upload a CSV or paste rows from a spreadsheet. You can review everything before it touches your portfolio.</p>
        </div>
        <button onclick="closeImportPortfolioModal()" class="import-close-btn">x</button>
      </div>

      <div class="import-tabs">
        <button id="import-tab-paste" class="import-tab active" onclick="setImportMode('paste')">Paste</button>
        <button id="import-tab-file" class="import-tab" onclick="setImportMode('file')">CSV File</button>
      </div>

      <div id="import-pane-paste">
        <label class="form-label">Paste holdings</label>
        <textarea id="portfolio-import-text" class="form-textarea import-textarea" rows="8" placeholder="Ticker,Shares,Average Cost,Name&#10;AAPL,12,185.50,Apple&#10;BTC,0.08,62000,Bitcoin&#10;NPN,5,3180,Naspers"></textarea>
        <p class="form-hint">Works with comma, tab, or semicolon separated rows. Headers are optional.</p>
      </div>

      <div id="import-pane-file" style="display:none">
        <label class="form-label">Upload CSV</label>
        <input id="portfolio-import-file" class="form-input" type="file" accept=".csv,.txt,text/csv">
        <p class="form-hint">Export your holdings from your broker, then upload the CSV here.</p>
      </div>

      <div class="import-help">
        <strong>Supported columns:</strong> ticker/symbol, shares/quantity/units, avg cost/average price/cost, name/security.
      </div>

      <div id="portfolio-import-error" class="auth-error"></div>
      <div id="portfolio-import-preview" class="portfolio-import-preview"></div>

      <div class="import-actions">
        <button class="modal-cancel" onclick="closeImportPortfolioModal()">Cancel</button>
        <button class="modal-save-btn" id="portfolio-import-parse-btn" onclick="parsePortfolioImportInput()">Preview Import</button>
        <button class="modal-save-btn hidden" id="portfolio-import-save-btn" onclick="savePortfolioImportRows()">Import Valid Rows</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('portfolio-import-file').addEventListener('change', handlePortfolioImportFile);
  return modal;
}

function openImportPortfolioModal() {
  if (!currentUser) {
    document.getElementById('auth-overlay').classList.remove('hidden');
    showAuthTab('login');
    return;
  }
  const modal = ensurePortfolioImportModal();
  portfolioImportRows = [];
  document.getElementById('portfolio-import-text').value = '';
  document.getElementById('portfolio-import-file').value = '';
  document.getElementById('portfolio-import-error').classList.remove('show');
  document.getElementById('portfolio-import-error').textContent = '';
  document.getElementById('portfolio-import-preview').innerHTML = '';
  document.getElementById('portfolio-import-parse-btn').classList.remove('hidden');
  document.getElementById('portfolio-import-save-btn').classList.add('hidden');
  setImportMode('paste');
  modal.classList.remove('hidden');
}

function closeImportPortfolioModal() {
  document.getElementById('portfolio-import-modal')?.classList.add('hidden');
}

function setImportMode(mode) {
  document.getElementById('import-tab-paste')?.classList.toggle('active', mode === 'paste');
  document.getElementById('import-tab-file')?.classList.toggle('active', mode === 'file');
  document.getElementById('import-pane-paste').style.display = mode === 'paste' ? '' : 'none';
  document.getElementById('import-pane-file').style.display = mode === 'file' ? '' : 'none';
}

function handlePortfolioImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('portfolio-import-text').value = String(reader.result || '');
    parsePortfolioImportInput();
  };
  reader.onerror = () => showPortfolioImportError('Could not read that file.');
  reader.readAsText(file);
}

function showPortfolioImportError(message) {
  const el = document.getElementById('portfolio-import-error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
}

function splitImportLine(line) {
  const delimiter = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseImportNumber(value) {
  const cleaned = String(value || '')
    .replace(/[^\d.,-]/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeImportHeader(cell) {
  return String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapImportColumns(cells) {
  const keys = cells.map(normalizeImportHeader);
  const find = names => keys.findIndex(k => names.some(name => k === name || k.includes(name)));
  const ticker = find(['ticker', 'symbol', 'code', 'instrument']);
  const shares = find(['shares', 'quantity', 'qty', 'units', 'holding']);
  const cost = find(['averagecost', 'avgcost', 'averageprice', 'avgprice', 'costbasis', 'cost', 'price']);
  const name = find(['name', 'asset', 'security', 'description', 'company']);
  return { ticker, shares, cost, name, hasHeader: ticker >= 0 && shares >= 0 };
}

function buildImportRows(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const firstCells = splitImportLine(lines[0]);
  const mapped = mapImportColumns(firstCells);
  const start = mapped.hasHeader ? 1 : 0;
  const idx = mapped.hasHeader ? mapped : { ticker: 0, shares: 1, cost: 2, name: 3 };
  const rows = [];

  for (let i = start; i < lines.length; i++) {
    const cells = splitImportLine(lines[i]);
    const ticker = String(cells[idx.ticker] || '').trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, '');
    const shares = parseImportNumber(cells[idx.shares]);
    const avgCost = parseImportNumber(cells[idx.cost]);
    const market = RAW_MARKETS.find(m => m.ticker === ticker);
    const name = String(cells[idx.name] || market?.name || ticker).trim() || ticker;
    const errors = [];
    if (!ticker) errors.push('Missing ticker');
    if (!Number.isFinite(shares) || shares <= 0) errors.push('Invalid shares');
    if (!Number.isFinite(avgCost) || avgCost < 0) errors.push('Invalid average cost');
    rows.push({ ticker, name, shares, avg_cost: avgCost, currency: market?.currency || 'USD', sourceLine: i + 1, errors });
  }

  const merged = new Map();
  rows.forEach(row => {
    if (row.errors.length) {
      merged.set(`__invalid_${row.sourceLine}`, row);
      return;
    }
    const existing = merged.get(row.ticker);
    if (!existing) {
      merged.set(row.ticker, { ...row, sourceLines: [row.sourceLine], duplicateCount: 0 });
      return;
    }
    const totalShares = existing.shares + row.shares;
    const totalCost = existing.shares * existing.avg_cost + row.shares * row.avg_cost;
    existing.shares = totalShares;
    existing.avg_cost = totalShares > 0 ? totalCost / totalShares : existing.avg_cost;
    existing.name = existing.name || row.name;
    existing.sourceLines.push(row.sourceLine);
    existing.duplicateCount += 1;
  });
  return [...merged.values()];
}

function parsePortfolioImportInput() {
  const text = document.getElementById('portfolio-import-text')?.value || '';
  const errorEl = document.getElementById('portfolio-import-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
  portfolioImportRows = buildImportRows(text);
  renderPortfolioImportPreview();
}

function renderPortfolioImportPreview() {
  const box = document.getElementById('portfolio-import-preview');
  const saveBtn = document.getElementById('portfolio-import-save-btn');
  const parseBtn = document.getElementById('portfolio-import-parse-btn');
  if (!box) return;
  if (!portfolioImportRows.length) {
    box.innerHTML = '';
    saveBtn?.classList.add('hidden');
    parseBtn?.classList.remove('hidden');
    showPortfolioImportError('Paste holdings or upload a CSV first.');
    return;
  }
  const valid = portfolioImportRows.filter(r => !r.errors.length);
  const invalid = portfolioImportRows.length - valid.length;
  const existingTickers = new Set(dbPortfolio.map(h => h.ticker));
  box.innerHTML = `
    <div class="import-summary">
      <span>${valid.length} valid</span>
      ${invalid ? `<span class="import-bad">${invalid} need review</span>` : ''}
      <span>${valid.filter(r => existingTickers.has(r.ticker)).length} will update existing</span>
    </div>
    <div class="import-preview-table">
      <div class="import-preview-head">Ticker</div>
      <div class="import-preview-head">Name</div>
      <div class="import-preview-head">Shares</div>
      <div class="import-preview-head">Avg cost</div>
      <div class="import-preview-head">Status</div>
      ${portfolioImportRows.map(r => `
        <div>${escHtml(r.ticker || '-')}</div>
        <div>${escHtml(r.name || '-')}</div>
        <div class="mono">${Number.isFinite(r.shares) ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}</div>
        <div class="mono">${Number.isFinite(r.avg_cost) ? fmtNativeUnitPrice(r.avg_cost, r.currency) : '-'}</div>
        <div class="${r.errors.length ? 'import-bad' : 'import-good'}">${r.errors.length ? escHtml(r.errors.join(', ')) : `${existingTickers.has(r.ticker) ? 'Update' : 'New'}${r.duplicateCount ? `, merged ${r.duplicateCount + 1} rows` : ''}`}</div>
      `).join('')}
    </div>
  `;
  if (valid.length) {
    saveBtn?.classList.remove('hidden');
    parseBtn?.classList.add('hidden');
    saveBtn.textContent = `Import ${valid.length} Holding${valid.length === 1 ? '' : 's'}`;
  } else {
    saveBtn?.classList.add('hidden');
    parseBtn?.classList.remove('hidden');
  }
}

async function savePortfolioImportRows() {
  const rows = portfolioImportRows.filter(r => !r.errors.length);
  if (!rows.length) { showPortfolioImportError('No valid rows to import.'); return; }
  const btn = document.getElementById('portfolio-import-save-btn');
  const original = btn?.textContent || 'Import';
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  try {
    for (const row of rows) {
      const existing = dbPortfolio.find(h => h.ticker === row.ticker);
      let payload = {
        ticker: row.ticker,
        name: row.name || row.ticker,
        shares: row.shares,
        avg_cost: row.avg_cost,
      };
      if (existing) {
        const totalShares = Number(existing.shares) + row.shares;
        const totalCost = Number(existing.shares) * Number(existing.avg_cost) + row.shares * row.avg_cost;
        payload = {
          ticker: row.ticker,
          name: row.name || existing.name || row.ticker,
          shares: totalShares,
          avg_cost: totalShares > 0 ? totalCost / totalShares : row.avg_cost,
        };
      }
      const d = await dataRequest('portfolio', 'POST', payload);
      if (!d.success) throw new Error(d.error || `Could not import ${row.ticker}`);
    }
    await loadPortfolioFromDB();
    closeImportPortfolioModal();
    renderPortfolio();
    showToast(`Imported ${rows.length} holding${rows.length === 1 ? '' : 's'}`);
  } catch (e) {
    showPortfolioImportError(e.message || 'Import failed.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function openAddHoldingModal(ticker = '', name = '') {
  const asset = getQuickHoldingAsset(ticker, name);
  const existing = asset.ticker ? dbPortfolio.find(h => h.ticker === asset.ticker) : null;
  const sharesValue = existing ? Number(existing.shares) : '';
  const costValue = existing
    ? Number(existing.avg_cost)
    : (asset.val !== null ? Number(asset.val) : null);
  document.getElementById('holding-ticker').value = asset.ticker;
  document.getElementById('holding-name').value   = existing?.name || asset.name;
  document.getElementById('holding-shares').value = Number.isFinite(sharesValue) ? String(sharesValue) : '';
  document.getElementById('holding-cost').value   = Number.isFinite(costValue) ? costValue.toFixed(costValue < 10 ? 4 : 2) : '';
  const e = document.getElementById('holding-error');
  e.textContent = ''; e.classList.remove('show');

  // Sync currency symbol prefix
  const sym = cfgForCurrency(asset.currency).symbol;
  const symEl = document.getElementById('holding-cost-sym');
  if (symEl) symEl.textContent = sym;

  // Clear any previous chip selection + price hint
  document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('selected'));
  const hint = document.getElementById('holding-price-hint');
  if (hint) hint.textContent = '';

  // If pre-filled from a quick-pick context (e.g. stock detail), show market price hint
  if (asset.ticker && asset.val !== null && hint) {
    hint.textContent = existing
      ? `Editing existing holding · Market price: ${fmtNativeUnitPrice(asset.val, asset.currency)}`
      : 'Market price: ' + fmtNativeUnitPrice(asset.val, asset.currency);
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
    const d = await dataRequest('portfolio', 'POST', { ticker, name, shares, avg_cost: avgCost });
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
    await dataRequest('portfolio', 'DELETE', { ticker });
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
    <div class="badge-toast-icon">${iconMarkup(badge.icon, 'badge-icon-glyph')}</div>
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
        <div class="path-node ${nodeClass}" ${unlocked ? `onclick="openTopic('${topicId}')"` : ''}>${done ? iconMarkup('award', 'path-node-icon') : `<span class="path-node-emoji">${escHtml(topic.icon)}</span>`}</div>
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
  scheduleUiIconRefresh(el);
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

  fetchMarketData('calendar', { from, to })
    .then(data => {
      if (!data.success) throw new Error(data.error || 'API error');
      const events = [
        ...earningsToEvents(data.earnings || []),
        ...(data.economic || []),
      ].sort((a, b) => a.date.localeCompare(b.date));
      calendarLoadError = '';
      _calCache   = { events, live: true };
      _calCacheTs = Date.now();
      buildUI(events, true, el._calFilter || 'all', _calView || 'list');
    })
    .catch((error) => {
      // Fallback: show a notice but still render (empty) so the tab isn't broken
      calendarLoadError = describeAppError(error, 'Calendar data is temporarily unavailable.');
      logAppIssue('calendar', calendarLoadError, 'warn');
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
          <div class="learn-topic-icon" style="background:${t.iconBg}"><span class="learn-topic-emoji">${escHtml(t.icon)}</span></div>
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
  scheduleUiIconRefresh(el);
}
const _renderCalendarOriginal = renderCalendar;
renderCalendar = function(...args) {
  return _renderCalendarOriginal.apply(this, args);
};

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
        <span class="learn-detail-emoji">${escHtml(topic.icon)}</span>
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
  scheduleUiIconRefresh(el);
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
  scheduleUiIconRefresh(el);
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
  scheduleUiIconRefresh(el);
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
  scheduleUiIconRefresh(el);
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
            <div class="badge-icon"><span class="badge-emoji">${escHtml(b.icon)}</span></div>
            <div class="badge-name">${escHtml(b.name)}</div>
            <div class="badge-desc">${escHtml(b.desc)}</div>
          </div>`).join('')}
      </div>
    </div>
  `;
  el.parentElement.scrollTop = 0;
  scheduleUiIconRefresh(el);
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

hydrateStaticUiIcons();
setupMobileChrome();
applyUiMode();
ensureNotificationCenter();
// Pre-render the default tab
renderNews();
// Check auth — shows login overlay if not logged in, syncs data if session exists
checkAuth().then(() => processBillingReturnState()).catch(() => {});
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
