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

  const passwordMethodBtn = page.locator('#auth-login-method-password');
  await expect(passwordMethodBtn).toBeVisible({ timeout: 5000 });
  await passwordMethodBtn.click();

  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  const loginBtn = page.locator('#login-btn');
  await expect(loginBtn).toBeVisible({ timeout: 5000 });
  await loginBtn.click();
  const authOverlay = page.locator('#auth-overlay');
  const headerUser = page.locator('#header-user');
  const authError = page.locator('#auth-error');

  await Promise.race([
    expect(headerUser).toBeVisible({ timeout: 15000 }),
    expect(authError).toContainText(/\S+/, { timeout: 15000 }),
  ]);

  if (await authError.isVisible()) {
    const message = (await authError.textContent())?.trim() || 'Unknown login error';
    throw new Error(`Password login failed: ${message}`);
  }

  await expect(authOverlay).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(headerUser).toBeVisible({ timeout: 15000 });
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
