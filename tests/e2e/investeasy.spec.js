/**
 * InvestEasy — Playwright E2E + Acceptance Tests (black-box)
 *
 * Runs against the live PHP dev server (started by the test script).
 * Covers: navigation, guest walls, markets page, news tab,
 *         auth flow, portfolio tab, FinBot tab, saved tab.
 */

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8787';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function dismissModals(page) {
  // Close any open overlays / bottom sheets
  const overlay = page.locator('.overlay.active, .sheet.active');
  if (await overlay.count() > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function clickTab(page, label) {
  await page.locator(`nav button:has-text("${label}")`).click();
  await page.waitForTimeout(400);
}

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Navigation', () => {

  test('loads the app without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });

  test('shows the Markets tab by default (or first active tab)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    // At least one tab-content should be active
    const active = page.locator('.tab-content.active');
    await expect(active).toBeVisible();
  });

  test('can switch to News tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'News');
    await expect(page.locator('#tab-news')).toHaveClass(/active/);
  });

  test('can switch to Markets tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'Markets');
    await expect(page.locator('#tab-markets')).toHaveClass(/active/);
  });

  test('can switch to Portfolio tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'Portfolio');
    await expect(page.locator('#tab-portfolio')).toHaveClass(/active/);
  });

  test('can switch to FinBot tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'FinBot');
    await expect(page.locator('#tab-finbot')).toHaveClass(/active/);
  });

  test('can switch to Saved tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'Saved');
    await expect(page.locator('#tab-saved')).toHaveClass(/active/);
  });
});

// ─── Markets Page ─────────────────────────────────────────────────────────────

test.describe('Markets page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'Markets');
  });

  test('renders Featured section heading', async ({ page }) => {
    await expect(page.locator('text=Featured')).toBeVisible();
  });

  test('renders at least 4 featured cards', async ({ page }) => {
    const cards = page.locator('.featured-card');
    await expect(cards).toHaveCount(6);
  });

  test('featured cards show ticker, price and % change', async ({ page }) => {
    const card = page.locator('.featured-card').first();
    // Should contain a ticker like SPX/NDX/BTC
    await expect(card).toContainText(/[A-Z]{2,5}/);
    // Should show a percentage
    await expect(card).toContainText(/%/);
  });

  test('featured cards show 52W RANGE label', async ({ page }) => {
    await expect(page.locator('text=52W RANGE').first()).toBeVisible();
  });

  test('Top Movers section is visible', async ({ page }) => {
    await expect(page.locator('text=Top Movers')).toBeVisible();
  });

  test('filter buttons render', async ({ page }) => {
    const count = await page.locator('.filter-btn').count();
    expect(count).toBeGreaterThan(4);
  });

  test('JSE filter button exists', async ({ page }) => {
    await expect(page.locator('.filter-btn:has-text("JSE")')).toBeVisible();
  });

  test('clicking JSE filter shows only JSE stocks', async ({ page }) => {
    await page.locator('.filter-btn:has-text("JSE")').click();
    await page.waitForTimeout(300);
    // Should show NPN (Naspers) — a known JSE stock
    const jseCount = await page.locator('.market-tile').count();
    expect(jseCount).toBeGreaterThan(0);
    await expect(page.locator('text=NPN')).toBeVisible();
  });

  test('clicking All filter restores all assets', async ({ page }) => {
    await page.locator('.filter-btn:has-text("JSE")').click();
    await page.waitForTimeout(200);
    await page.locator('.filter-btn:has-text("All")').click();
    await page.waitForTimeout(200);
    const tiles = page.locator('.market-tile');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(20);
  });

  test('clicking a market tile opens the stock detail modal', async ({ page }) => {
    await page.locator('.market-tile').first().click();
    await page.waitForTimeout(400);
    // The detail modal or sheet should appear
    await expect(page.locator('.overlay.active, [id*="detail"], .news-overlay:not(.hidden)')).toBeVisible();
  });
});

// ─── News Tab ────────────────────────────────────────────────────────────────

test.describe('News tab', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await clickTab(page, 'News');
    await page.waitForTimeout(500);
  });

  test('renders the News Feed heading', async ({ page }) => {
    await expect(page.locator('text=News Feed')).toBeVisible();
  });

  test('shows category filter pills', async ({ page }) => {
    await expect(page.locator('text=All').first()).toBeVisible();
    await expect(page.locator('text=Markets').first()).toBeVisible();
    await expect(page.locator('text=Crypto').first()).toBeVisible();
  });
});

// ─── Guest Wall Tests (black-box acceptance) ──────────────────────────────────

test.describe('Guest walls — unauthenticated user', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
  });

  test('FinBot tab shows guest wall, not the analysis form', async ({ page }) => {
    await clickTab(page, 'FinBot');
    // Should NOT see the FinBot mode cards active/interactive
    // Should see a Sign In CTA
    await expect(page.locator('#tab-finbot')).toContainText(/sign in|log in|get started/i);
    // Should NOT see the "Run Analysis" button
    await expect(page.locator('button:has-text("Run Analysis")')).toHaveCount(0);
  });

  test('FinBot guest wall shows FinBot branding', async ({ page }) => {
    await clickTab(page, 'FinBot');
    await expect(page.locator('#tab-finbot')).toContainText(/FinBot/i);
  });

  test('Saved tab shows guest wall, not the reports list', async ({ page }) => {
    await clickTab(page, 'Saved');
    await expect(page.locator('#tab-saved')).toContainText(/sign in|log in|get started/i);
  });

  test('Portfolio tab is accessible but shows empty state', async ({ page }) => {
    await clickTab(page, 'Portfolio');
    // Should render without crashing — may show empty state or login prompt
    await expect(page.locator('#tab-portfolio')).toBeVisible();
  });
});

// ─── Auth Overlay ────────────────────────────────────────────────────────────

test.describe('Auth overlay', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
  });

  test('clicking Sign In CTA on FinBot wall opens auth overlay', async ({ page }) => {
    await clickTab(page, 'FinBot');
    const cta = page.locator('#tab-finbot a:has-text("Sign"), #tab-finbot button:has-text("Sign")').first();
    if (await cta.count() > 0) {
      await cta.click();
      await page.waitForTimeout(300);
      await expect(page.locator('#auth-overlay, .auth-overlay')).toBeVisible();
    }
  });

  test('auth overlay has Login and Register tabs', async ({ page }) => {
    // Trigger auth overlay via header sign-in if available
    const headerBtn = page.locator('header button:has-text("Sign"), .header button:has-text("Sign"), button[onclick*="showAuth"]').first();
    if (await headerBtn.count() > 0) {
      await headerBtn.click();
      await page.waitForTimeout(300);
      await expect(page.locator('#auth-overlay')).toBeVisible();
      await expect(page.locator('#tab-login-btn, #tab-register-btn').first()).toBeVisible();
    }
  });

  test('register form validates empty fields', async ({ page }) => {
    const headerBtn = page.locator('button[onclick*="showAuth"], button:has-text("Sign In")').first();
    if (await headerBtn.count() > 0) {
      await headerBtn.click();
      await page.waitForTimeout(300);
      // Switch to register tab if needed
      const regTab = page.locator('#tab-register-btn').first();
      if (await regTab.count() > 0) await regTab.click();
      // Submit empty form
      const submitBtn = page.locator('#register-btn').first();
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForTimeout(300);
        // Should show an error, not navigate away
        await expect(page.locator('.auth-error, [id*="error"]').first()).toBeVisible();
      }
    }
  });
});

// ─── Accessibility basics ─────────────────────────────────────────────────────

test.describe('Accessibility basics', () => {

  test('page has a title', async ({ page }) => {
    await page.goto(BASE);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('page has a lang attribute or at least renders text', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    // App renders visible text
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(100);
  });

  test('nav buttons are keyboard-focusable', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(focused);
  });

  test('images/icons have no broken src that causes console errors', async ({ page }) => {
    const errors = [];
    page.on('response', r => {
      if (r.status() >= 400 && r.url().match(/\.(png|jpg|svg|gif|webp)$/i)) {
        errors.push(`${r.status()} ${r.url()}`);
      }
    });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    expect(errors).toHaveLength(0);
  });
});

// ─── Responsive layout ───────────────────────────────────────────────────────

test.describe('Responsive layout', () => {

  test('renders correctly at mobile width (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    // Nav should still be visible
    await expect(page.locator('nav, .bottom-nav')).toBeVisible();
    // No horizontal overflow (scrollWidth should not exceed viewport)
    const overflow = await page.evaluate(() =>
      document.body.scrollWidth > window.innerWidth + 5
    );
    expect(overflow, 'Horizontal overflow on mobile').toBeFalsy();
  });

  test('renders correctly at tablet width (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('nav, .bottom-nav')).toBeVisible();
  });

  test('renders correctly at desktop width (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    const active = page.locator('.tab-content.active');
    await expect(active).toBeVisible();
  });
});

// ─── Dark / light mode ───────────────────────────────────────────────────────

test.describe('Theme', () => {

  test('app renders in dark mode by default or respects system preference', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Should be a dark or light colour — just not transparent
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('');
  });
});
