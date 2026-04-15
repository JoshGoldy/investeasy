const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8787';
const BASE_URL = BASE.endsWith('/') ? BASE : `${BASE}/`;

async function openTab(page, label) {
  const button = page.locator(`nav button:has-text("${label}")`).first();
  await expect(button).toBeVisible();
  await button.click();
  await page.waitForTimeout(250);
}

test.describe('FinScope smoke suite', () => {
  test('app boots without page errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.tab-content.active')).toBeVisible();
    expect(errors, `Page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('markets renders and stock detail opens', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await openTab(page, 'Markets');

    await expect(page.locator('#tab-markets')).toContainText('Markets');
    await expect(page.locator('.featured-card').first()).toBeVisible();

    await page.locator('.featured-card').first().click();
    await expect(page.locator('#stock-detail:not(.hidden)')).toBeVisible();
    await expect(page.locator('#sd-chart-canvas')).toBeVisible();
  });

  test('news tab renders feed shell', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await openTab(page, 'News');

    await expect(page.locator('#tab-news')).toContainText('News Feed');
    await expect(page.locator('#news-articles-container')).toBeVisible();
  });

  test('FinBot guest/auth entry renders', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await openTab(page, 'FinBot');

    await expect(page.locator('#tab-finbot')).toContainText(/FinBot/i);
    await expect(page.locator('#tab-finbot')).toContainText(/sign in|get started|quick chat|analysis/i);
  });

  test('saved tab renders without crashing', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await openTab(page, 'Saved');

    await expect(page.locator('#tab-saved')).toBeVisible();
    await expect(page.locator('#tab-saved')).toContainText(/Saved Reports|sign in/i);
  });

  test('settings page renders account controls', async ({ page }) => {
    await page.goto(new URL('settings.html', BASE_URL).toString());
    await page.waitForLoadState('domcontentloaded');
    const settingsTab = page.locator('#tab-settings');
    const authOverlay = page.locator('#auth-overlay:not(.hidden)');
    const authButtons = page.locator('#header-auth-btns');

    if (await settingsTab.isVisible()) {
      await expect(settingsTab).toContainText(/Account|Plan & Credits/i);
    } else if (await authOverlay.count()) {
      await expect(authOverlay).toBeVisible();
      await expect(authOverlay).toContainText(/log in|sign in|create account|email code/i);
    } else {
      await expect(authButtons).toBeVisible();
      await expect(authButtons).toContainText(/log in|sign up/i);
    }
  });
});
