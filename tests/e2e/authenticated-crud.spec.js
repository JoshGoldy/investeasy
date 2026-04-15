const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8787';
const EMAIL = process.env.TEST_USER_EMAIL || '';
const PASSWORD = process.env.TEST_USER_PASSWORD || '';

const hasCreds = !!(EMAIL && PASSWORD);
const TEST_HOLDING_TICKER = 'TSTAUTO';
const TEST_HOLDING_NAME = 'Automation Test Holding';

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

async function openTab(page, label, panelId) {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await expect(page.locator(panelId)).toBeVisible({ timeout: 15000 });
}

async function cleanupHoldingIfPresent(page, ticker) {
  await openTab(page, 'Portfolio', '#tab-portfolio');
  const card = page.locator('.holding-card').filter({ hasText: ticker }).first();
  if ((await card.count()) === 0) return;

  page.once('dialog', dialog => dialog.accept());
  await card.locator('button:has-text("Remove")').click();
  await expect(page.locator('.holding-card').filter({ hasText: ticker })).toHaveCount(0, { timeout: 15000 });
}

test.describe('FinScope authenticated CRUD smoke suite', () => {
  test.skip(!hasCreds, 'Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run authenticated CRUD smoke tests.');

  test('watchlist star toggles and persists across navigation', async ({ page }) => {
    await loginWithPassword(page);
    await openTab(page, 'Markets', '#tab-markets');

    const tile = page.locator('.market-tile').first();
    await expect(tile).toBeVisible({ timeout: 15000 });

    const ticker = ((await tile.locator('.ticker').textContent()) || '').trim();
    const starButton = tile.locator('.market-star-btn');
    await expect(starButton).toBeVisible();

    const initiallyActive = await starButton.evaluate(el => el.classList.contains('active'));

    await starButton.click();
    await expect.poll(async () => {
      return await starButton.evaluate(el => el.classList.contains('active'));
    }, { timeout: 10000 }).toBe(!initiallyActive);

    await openTab(page, 'Portfolio', '#tab-portfolio');
    await openTab(page, 'Markets', '#tab-markets');

    const sameTile = page.locator('.market-tile').filter({ hasText: ticker }).first();
    const sameStar = sameTile.locator('.market-star-btn');
    await expect(sameStar).toBeVisible();
    await expect.poll(async () => {
      return await sameStar.evaluate(el => el.classList.contains('active'));
    }, { timeout: 10000 }).toBe(!initiallyActive);

    await sameStar.click();
    await expect.poll(async () => {
      return await sameStar.evaluate(el => el.classList.contains('active'));
    }, { timeout: 10000 }).toBe(initiallyActive);
  });

  test('portfolio holding can be added and removed', async ({ page }) => {
    await loginWithPassword(page);
    await cleanupHoldingIfPresent(page, TEST_HOLDING_TICKER);

    await page.locator('button:has-text("Add holding")').first().click();
    await expect(page.locator('#add-holding-modal:not(.hidden)')).toBeVisible({ timeout: 10000 });

    await page.locator('#holding-ticker').fill(TEST_HOLDING_TICKER);
    await page.locator('#holding-name').fill(TEST_HOLDING_NAME);
    await page.locator('#holding-shares').fill('3');
    await page.locator('#holding-cost').fill('123.45');
    await page.locator('#add-holding-modal button:has-text("Add to Portfolio")').click();

    const addedCard = page.locator('.holding-card').filter({ hasText: TEST_HOLDING_TICKER }).first();
    await expect(addedCard).toBeVisible({ timeout: 15000 });
    await expect(addedCard).toContainText(TEST_HOLDING_NAME);

    page.once('dialog', dialog => dialog.accept());
    await addedCard.locator('button:has-text("Remove")').click();
    await expect(page.locator('.holding-card').filter({ hasText: TEST_HOLDING_TICKER })).toHaveCount(0, { timeout: 15000 });
  });

  test('settings changes persist across tab switches', async ({ page }) => {
    await loginWithPassword(page);
    await openTab(page, 'Settings', '#tab-settings');

    const newsletterRow = page.locator('.settings-row').filter({ hasText: 'Weekly Newsletter' }).first();
    const newsletterToggle = newsletterRow.locator('input[type="checkbox"]');
    const initialValue = await newsletterToggle.isChecked();

    await newsletterToggle.setChecked(!initialValue);
    await page.waitForTimeout(1000);

    await openTab(page, 'Portfolio', '#tab-portfolio');
    await openTab(page, 'Settings', '#tab-settings');

    const refreshedToggle = page.locator('.settings-row').filter({ hasText: 'Weekly Newsletter' }).first().locator('input[type="checkbox"]');
    await expect(refreshedToggle).toHaveJSProperty('checked', !initialValue);

    await refreshedToggle.setChecked(initialValue);
    await page.waitForTimeout(1000);
  });

  test('price alert can be created and removed', async ({ page }) => {
    await loginWithPassword(page);
    await openTab(page, 'Markets', '#tab-markets');

    const tile = page.locator('.market-tile').first();
    await expect(tile).toBeVisible({ timeout: 15000 });

    await tile.locator('.alert-bell').click();
    await expect(page.locator('#alert-modal-bg:not(.hidden)')).toBeVisible({ timeout: 10000 });

    const existingDeletes = page.locator('.alert-del');
    while ((await existingDeletes.count()) > 0) {
      await existingDeletes.first().click();
      await page.waitForTimeout(300);
    }

    await page.locator('#alert-target').fill('999999');
    await page.locator('.alert-save-btn').click();

    const alertList = page.locator('.alert-item');
    await expect(alertList).toHaveCount(1, { timeout: 15000 });
    await expect(alertList.first()).toContainText(/Above/i);
    await expect(alertList.first()).toContainText(/999,999|999999/);

    await alertList.first().locator('.alert-del').click();
    await expect(page.locator('.alert-item')).toHaveCount(0, { timeout: 15000 });

    await page.locator('#alert-modal-bg').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#alert-modal-bg')).toHaveClass(/hidden/, { timeout: 10000 });
  });
});
