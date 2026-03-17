/**
 * JS Unit Tests — InvestEasy utility functions (white-box)
 * Uses Node.js built-in test runner (node:test) — no npm install needed.
 *
 * Extracts and tests the pure functions from index.html.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html  = readFileSync(join(__dir, '../../index.html'), 'utf8');

// ── Extract JS functions we want to test ──────────────────────────────────────

// Pull the main (inline) <script> block (not src="" blocks)
const allScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
// Pick the largest block — that's the app's inline script
const scriptMatch = allScripts.sort((a,b) => b[1].length - a[1].length)[0];
if (!scriptMatch) throw new Error('Could not find main <script> block');

// ── DOM stub so DOM-dependent functions work in Node ─────────────────────────
// escHtml uses document.createElement; provide a minimal shim.
globalThis.document = {
  createElement(tag) {
    let _text = '';
    return {
      set textContent(v) { _text = String(v); },
      get innerHTML() {
        return _text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      },
    };
  },
};

// We can't run the full script (it references DOM), but we can extract and
// evaluate individual pure functions by matching their source.

function extractFn(source, fnName) {
  // Match "function fnName(...) { ... }" (handles nested braces)
  const start = source.indexOf(`function ${fnName}(`);
  if (start === -1) throw new Error(`Function ${fnName} not found`);
  let depth = 0, i = start, found = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; found = true; }
    else if (source[i] === '}') { depth--; if (found && depth === 0) { i++; break; } }
    i++;
  }
  return source.slice(start, i);
}

const script = scriptMatch[1];

// Evaluate one or more named functions together (handles inter-dependencies)
function loadFns(...names) {
  const src = names.map(n => extractFn(script, n)).join('\n');
  const result = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${src}; return {${names.join(',')}};`);
  return factory();
}

function loadFn(name) {
  return loadFns(name)[name];
}

// Stubs for state-dependent functions used by fmtMoney / parseMd
globalThis.loadSettings = () => ({ hideBalances: false, currency: 'USD' });
globalThis.curCfg       = () => ({ symbol: '$', rate: 1 });

// ── escHtml ───────────────────────────────────────────────────────────────────

describe('escHtml — XSS prevention', () => {
  const { escHtml } = loadFns('escHtml');

  test('escapes ampersand', () => {
    assert.equal(escHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  });

  test('escapes < and >', () => {
    assert.equal(escHtml('<script>'), '&lt;script&gt;');
  });

  test('escapes double quotes', () => {
    assert.equal(escHtml('"hello"'), '&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    assert.equal(escHtml("it's"), "it&#039;s");
  });

  test('leaves safe strings unchanged', () => {
    assert.equal(escHtml('hello world'), 'hello world');
    assert.equal(escHtml('123.45'), '123.45');
  });

  test('handles empty string', () => {
    assert.equal(escHtml(''), '');
  });

  test('neutralises a full XSS payload', () => {
    const out = escHtml('<img src=x onerror="alert(1)">');
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('&lt;img'));
  });
});

// ── fmtMoney ──────────────────────────────────────────────────────────────────

describe('fmtMoney — currency formatting', () => {
  const { fmtMoney } = loadFns('fmtMoney');

  test('formats whole thousands with comma', () => {
    const r = fmtMoney(1000);
    assert.ok(r.includes('1,000') || r.includes('1.000'), `Got: ${r}`);
  });

  test('formats zero', () => {
    const r = fmtMoney(0);
    assert.ok(r.includes('0'), `Got: ${r}`);
  });

  test('formats negative values', () => {
    const r = fmtMoney(-500);
    assert.ok(r.includes('500') && r.includes('-'), `Got: ${r}`);
  });

  test('includes currency symbol', () => {
    const r = fmtMoney(1234.56);
    assert.ok(r.includes('$') || r.includes('R') || r.includes('€'), `Got: ${r}`);
  });

  test('formats large portfolio value', () => {
    const r = fmtMoney(1_500_000);
    assert.ok(r.includes('1') && r.includes('5'), `Got: ${r}`);
  });
});

// ── parseMd — basic Markdown renderer ────────────────────────────────────────

describe('parseMd — Markdown rendering', () => {
  // parseMd calls inlineMd which calls escHtml — load all three
  const { parseMd } = loadFns('escHtml', 'inlineMd', 'parseMd');

  test('renders **bold** as <strong>', () => {
    const out = parseMd('Hello **world**');
    assert.ok(out.includes('<strong>world</strong>'), `Got: ${out}`);
  });

  test('inlineMd only supports **bold**, not *italic* (by design)', () => {
    // *italic* is NOT implemented — single asterisks pass through as-is
    const out = parseMd('Hello *world*');
    assert.ok(out.includes('*world*'), `Got: ${out}`);
  });

  test('renders # h1', () => {
    const out = parseMd('# Title');
    assert.ok(out.includes('<h1>') && out.includes('Title'), `Got: ${out}`);
  });

  test('renders ## h2', () => {
    const out = parseMd('## Subtitle');
    assert.ok(out.includes('<h2>') && out.includes('Subtitle'), `Got: ${out}`);
  });

  test('renders ### h3', () => {
    const out = parseMd('### Section');
    assert.ok(out.includes('<h3>') && out.includes('Section'), `Got: ${out}`);
  });

  test('renders - list items as bullet divs', () => {
    const out = parseMd('- item one\n- item two');
    assert.ok(out.includes('class="bullet"') && out.includes('item one'), `Got: ${out}`);
  });

  test('renders numbered list items as bullet divs', () => {
    const out = parseMd('1. First\n2. Second');
    assert.ok(out.includes('class="bullet"') && out.includes('First'), `Got: ${out}`);
  });

  test('escapes HTML in content (XSS safe)', () => {
    const out = parseMd('<script>evil()</script>');
    assert.ok(!out.includes('<script>'), `Raw <script> in output: ${out}`);
  });

  test('handles empty string without throwing', () => {
    assert.doesNotThrow(() => parseMd(''));
  });

  test('plain text wraps in <p>', () => {
    const out = parseMd('Hello world');
    assert.ok(out.includes('<p>') && out.includes('Hello world'), `Got: ${out}`);
  });

  test('blank lines produce spacer divs', () => {
    const out = parseMd('line one\n\nline two');
    assert.ok(out.includes('height:6px') || out.includes('<div'), `Got: ${out}`);
  });
});

// ── Report ID generation ──────────────────────────────────────────────────────

describe('Report ID generation — uniqueness', () => {
  // The ID formula used across the codebase:
  // Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  test('generates non-empty IDs', () => {
    assert.ok(genId().length > 0);
  });

  test('generates different IDs each call', () => {
    const ids = new Set(Array.from({ length: 1000 }, genId));
    assert.equal(ids.size, 1000);
  });

  test('ID contains only alphanumeric characters', () => {
    for (let i = 0; i < 20; i++) {
      assert.match(genId(), /^[a-z0-9]+$/);
    }
  });
});

// ── SECTOR_MAP coverage ───────────────────────────────────────────────────────

describe('SECTOR_MAP — JSE and US tickers', () => {
  // Extract the SECTOR_MAP object literal from the script
  const mapStart = script.indexOf('const SECTOR_MAP = {');
  const mapEnd   = script.indexOf('};', mapStart) + 2;
  const mapSrc   = script.slice(mapStart, mapEnd);
  // eslint-disable-next-line no-new-func
  const SECTOR_MAP = new Function(`${mapSrc}; return SECTOR_MAP;`)();

  // US stocks
  const usCases = [
    ['AAPL', 'Tech'], ['MSFT', 'Tech'], ['JPM', 'Finance'],
    ['JNJ', 'Healthcare'], ['XOM', 'Energy'], ['BTC', 'Crypto'],
    ['SPY', 'ETF'], ['WMT', 'Consumer'], ['CAT', 'Industrial'],
  ];
  for (const [ticker, sector] of usCases) {
    test(`US: ${ticker} → ${sector}`, () => {
      assert.equal(SECTOR_MAP[ticker], sector);
    });
  }

  // JSE stocks
  const jseCases = [
    ['NPN', 'Tech'], ['PRX', 'Tech'],
    ['BHG', 'Mining'], ['AGL', 'Mining'], ['GLN', 'Mining'],
    ['ANG', 'Mining'], ['IMP', 'Mining'],
    ['FSR', 'Finance'], ['SBK', 'Finance'], ['CPI', 'Finance'],
    ['ABG', 'Finance'], ['NED', 'Finance'], ['SLM', 'Finance'],
    ['DSY', 'Finance'], ['OMU', 'Finance'],
    ['MTN', 'Telecom'],
    ['SOLJ', 'Energy'],
    ['MNP', 'Industrial'],
    ['CFR', 'Consumer'], ['SHP', 'Consumer'],
  ];
  for (const [ticker, sector] of jseCases) {
    test(`JSE: ${ticker} → ${sector}`, () => {
      assert.equal(SECTOR_MAP[ticker], sector, `${ticker} should be ${sector}, got ${SECTOR_MAP[ticker]}`);
    });
  }

  test('unknown ticker returns undefined (not a crash)', () => {
    assert.equal(SECTOR_MAP['XXXXXXXXX'], undefined);
  });
});

// ── RAW_MARKETS data integrity ────────────────────────────────────────────────

describe('RAW_MARKETS — data integrity', () => {
  const mStart = script.indexOf('const RAW_MARKETS = [');
  const mEnd   = script.indexOf('];', mStart) + 2;
  const mSrc   = script.slice(mStart, mEnd);
  // eslint-disable-next-line no-new-func
  const RAW_MARKETS = new Function(`${mSrc}; return RAW_MARKETS;`)();

  test('has entries', () => {
    assert.ok(RAW_MARKETS.length > 0);
  });

  test('every entry has required fields', () => {
    for (const m of RAW_MARKETS) {
      assert.ok(m.name,   `Missing name: ${JSON.stringify(m)}`);
      assert.ok(m.ticker, `Missing ticker: ${JSON.stringify(m)}`);
      assert.ok(typeof m.val === 'number', `val not number: ${m.ticker}`);
      assert.ok(typeof m.chg === 'number', `chg not number: ${m.ticker}`);
    }
  });

  test('all JSE entries have exchange=JSE and currency=ZAR', () => {
    const jse = RAW_MARKETS.filter(m => m.exchange === 'JSE');
    assert.ok(jse.length >= 20, `Expected ≥20 JSE entries, got ${jse.length}`);
    for (const m of jse) {
      assert.equal(m.currency, 'ZAR', `${m.ticker} should have ZAR currency`);
    }
  });

  test('no JSE stock appears in US stock set (exchange field separates them)', () => {
    const jseTickers = new Set(RAW_MARKETS.filter(m => m.exchange === 'JSE').map(m => m.ticker));
    const usStocks   = RAW_MARKETS.filter(m =>
      !['Index','Crypto','Commodity'].includes(m.sector) && !m.exchange
    );
    for (const m of usStocks) {
      assert.ok(!jseTickers.has(m.ticker), `${m.ticker} appears in both US and JSE`);
    }
  });

  test('ticker values are unique', () => {
    const tickers  = RAW_MARKETS.map(m => m.ticker);
    const unique   = new Set(tickers);
    assert.equal(unique.size, tickers.length, 'Duplicate tickers found');
  });

  test('chg values are finite numbers', () => {
    for (const m of RAW_MARKETS) {
      assert.ok(isFinite(m.chg), `Non-finite chg on ${m.ticker}: ${m.chg}`);
    }
  });

  test('val values are positive', () => {
    for (const m of RAW_MARKETS) {
      assert.ok(m.val > 0, `Non-positive val on ${m.ticker}: ${m.val}`);
    }
  });
});

// ── Input sanitisation (black-box boundary tests) ────────────────────────────

describe('Input sanitisation — boundary / black-box', () => {
  const { escHtml } = loadFns('escHtml');

  const xssPayloads = [
    '<script>alert("xss")</script>',
    '"><img src=x onerror=alert(1)>',
    "'; DROP TABLE users; --",
    '<a href="javascript:void(0)" onclick="evil()">click</a>',
    '${7*7}',              // template injection
    '{{7*7}}',             // template injection
    '\u003cscript\u003e',  // unicode escape for <script>
  ];

  for (const payload of xssPayloads) {
    test(`escHtml neutralises: ${payload.slice(0, 40)}`, () => {
      const out = escHtml(payload);
      // Output must not contain raw < or > that could form a tag
      assert.ok(!/<[a-zA-Z]/.test(out), `Raw HTML tag survived in: ${out}`);
      // Script keyword must be escaped if present
      if (payload.includes('script')) {
        assert.ok(!out.toLowerCase().includes('<script'), `<script> survived in: ${out}`);
      }
    });
  }
});
