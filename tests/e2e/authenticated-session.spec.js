const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.TEST_USER_EMAIL || '';
const PASSWORD = process.env.TEST_USER_PASSWORD || '';

const hasCreds = !!(EMAIL && PASSWORD);

async function loginWithPassword(page, { remember = true } = {}) {
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');

  await page.locator('button:has-text("Log in")').first().click();
  await expect(page.locator('#auth-overlay:not(.hidden)')).toBeVisible();

  const passwordMethodBtn = page.locator('#auth-login-method-password');
  await expect(passwordMethodBtn).toBeVisible({ timeout: 5000 });
  await passwordMethodBtn.click();

  const rememberToggle = page.locator('#remember-login');
  await expect(rememberToggle).toBeVisible({ timeout: 5000 });
  await rememberToggle.setChecked(remember);

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

test.describe('FinScope session persistence suite', () => {
  test.skip(!hasCreds, 'Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run session persistence tests.');

  test('remember me keeps the user signed in across reload and a new page', async ({ page, context }) => {
    await loginWithPassword(page, { remember: true });

    await expect(page.locator('#header-user')).toBeVisible();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#header-user')).toBeVisible({ timeout: 15000 });

    const secondPage = await context.newPage();
    await secondPage.goto(BASE);
    await secondPage.waitForLoadState('domcontentloaded');
    await expect(secondPage.locator('#header-user')).toBeVisible({ timeout: 15000 });
    await secondPage.close();
  });
});
