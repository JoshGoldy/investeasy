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
}

async function openTab(page, label, panelId) {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await expect(page.locator(panelId)).toBeVisible({ timeout: 15000 });
}

test.describe('FinScope authenticated FinBot flow', () => {
  test.skip(!hasCreds, 'Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run authenticated FinBot smoke tests.');

  test('FinBot analysis can be saved and deleted from Saved Reports', async ({ page }) => {
    test.setTimeout(120000);
    const editedTitle = 'Stock Screener QA Report';
    const editedFolder = 'QA Checks';
    const editedNote = 'Automated metadata persistence check';

    await page.addInitScript(() => {
      window.__copiedReportText = '';
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: undefined,
        });
      } catch (_) {}
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__copiedReportText = String(text || '');
            },
          },
        });
      } catch (_) {}
    });

    await loginWithPassword(page);

    await openTab(page, 'Saved Reports', '#tab-saved');
    const savedCards = page.locator('.saved-card');
    const initialCount = await savedCards.count();

    await openTab(page, 'FinBot', '#tab-finbot');
    await page.locator('.mode-card', { hasText: 'Stock Screener' }).first().click();
    await expect(page.locator('.run-btn', { hasText: 'Run Stock Screener' })).toBeVisible({ timeout: 10000 });
    await page.locator('.run-btn', { hasText: 'Run Stock Screener' }).click();

    await expect(page.locator('#credit-confirm-modal:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await page.locator('#credit-confirm-ok').click();

    const resultContent = page.locator('.result-content');
    const errorBox = page.locator('.error-box');

    await Promise.race([
      expect(resultContent).toBeVisible({ timeout: 60000 }),
      expect(errorBox).toContainText(/\S+/, { timeout: 60000 }),
    ]);

    if (await errorBox.isVisible().catch(() => false)) {
      const message = (await errorBox.textContent())?.trim() || 'Unknown FinBot error';
      throw new Error(`FinBot analysis failed: ${message}`);
    }

    await page.locator('.finbot-save-btn-big', { hasText: 'Save Report' }).click();
    await expect(page.locator('.finbot-save-btn-big', { hasText: /View in Saved/i })).toBeVisible({ timeout: 15000 });

    await openTab(page, 'Saved Reports', '#tab-saved');
    await expect(savedCards).toHaveCount(initialCount + 1, { timeout: 15000 });

    const newestCard = page.locator('.saved-card').first();
    await expect(newestCard).toContainText(/Stock Screener/i);

    await newestCard.locator('button:has-text("Edit Details")').click();
    await expect(page.locator('#saved-edit-modal-bd')).toBeVisible({ timeout: 10000 });

    await page.locator('#edit-name').fill(editedTitle);
    await page.locator('#edit-folder').fill(editedFolder);
    await page.locator('#edit-note').fill(editedNote);
    await page.locator('#edit-starred').check();
    await page.locator('#saved-edit-modal-bd button:has-text("Save Changes")').click();

    await expect(page.locator('#saved-edit-modal-bd')).toHaveCount(0, { timeout: 10000 });
    await expect(newestCard.locator('.saved-card-title')).toContainText(editedTitle, { timeout: 15000 });
    await expect(newestCard.locator('.saved-card-folder')).toContainText(editedFolder, { timeout: 15000 });
    await expect(newestCard.locator('.saved-card-note-preview')).toContainText(editedNote, { timeout: 15000 });
    await expect(newestCard.locator('.saved-card-star')).toHaveClass(/starred/, { timeout: 10000 });

    await newestCard.locator('button:has-text("Share / Copy")').click();
    await expect(page.locator('#ie-toast')).toContainText('Copied to clipboard!', { timeout: 10000 });
    await expect.poll(async () => {
      return page.evaluate(() => window.__copiedReportText || '');
    }, { timeout: 10000 }).toContain(editedTitle);

    const popupPromise = page.waitForEvent('popup');
    await newestCard.locator('button:has-text("Download PDF")').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect.poll(async () => popup.title(), { timeout: 10000 }).toContain(editedTitle);
    await expect(popup.locator('body')).toContainText(editedTitle, { timeout: 10000 });
    await expect(popup.locator('body')).toContainText(/Stock Screener/i, { timeout: 10000 });
    await popup.close();

    await newestCard.locator('button[title="Delete"]').click();
    await expect(savedCards).toHaveCount(initialCount, { timeout: 15000 });
  });
});
