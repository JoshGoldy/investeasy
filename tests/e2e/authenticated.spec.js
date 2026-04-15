const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.TEST_USER_EMAIL || '';
const PASSWORD = process.env.TEST_USER_PASSWORD || '';

const hasCreds = !!(EMAIL && PASSWORD);

async function loginWithPassword(page) {
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');

  await page.locator('button:has-text("Log in")').first().click();
  await expect(page.locator('#auth-overlay:not(.hidden)')).toBeVisible();

  const passwordMethodBtn = page.locator('[data-auth-method="password"]').first();
  if (await passwordMethodBtn.count()) {
    await passwordMethodBtn.click();
  } else {
    await page.locator('button:has-text("Password")').first().click();
  }

  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#auth-submit').click();

  await expect(page.locator('#auth-overlay.hidden')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#header-user')).toBeVisible({ timeout: 15000 });
}

test.describe('FinScope authenticated smoke suite', () => {
  test.skip(!hasCreds, 'Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run authenticated smoke tests.');

  test('password login works and session shell updates', async ({ page }) => {
    await loginWithPassword(page);
    await expect(page.locator('#header-user')).toContainText(/@|[A-Za-z0-9]/);
  });

  test('portfolio and settings render for an authenticated user', async ({ page }) => {
    await loginWithPassword(page);

    await page.locator('nav button:has-text("Portfolio")').first().click();
    await expect(page.locator('#tab-portfolio')).toBeVisible();
    await expect(page.locator('#tab-portfolio')).toContainText(/Portfolio|holding|Add holding/i);

    await page.locator('nav button:has-text("Settings")').first().click();
    await expect(page.locator('#tab-settings')).toBeVisible();
    await expect(page.locator('#tab-settings')).toContainText(/Plan & Credits|Account|Notifications/i);
  });

  test('FinBot authenticated shell renders', async ({ page }) => {
    await loginWithPassword(page);

    await page.locator('nav button:has-text("FinBot")').first().click();
    await expect(page.locator('#tab-finbot')).toBeVisible();
    await expect(page.locator('#tab-finbot')).toContainText(/Quick Chat with FinBot|Choose Analysis Mode|Stock Screener/i);
  });
});
