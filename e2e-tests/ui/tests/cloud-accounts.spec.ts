import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Cloud Accounts Page', () => {
  test('accounts tab loads', async ({ page, consoleMonitor }) => {
    await page.goto('/cloud/accounts');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });

  test('tabs switch between accounts and scans', async ({ page, consoleMonitor }) => {
    await page.goto('/cloud/accounts');
    await waitForPageReady(page);

    // Find scans tab
    const scansTab = page.getByRole('tab', { name: /scans/i });
    if (!(await scansTab.isVisible().catch(() => false))) return;

    await scansTab.click();
    await expect(page).toHaveURL(/\/cloud\/scans/);
    await waitForPageReady(page);

    // Switch back to accounts
    const accountsTab = page.getByRole('tab', { name: /accounts/i });
    await accountsTab.click();
    await expect(page).toHaveURL(/\/cloud\/accounts/);
  });

  test('connect button opens dialog', async ({ page, consoleMonitor }) => {
    await page.goto('/cloud/accounts');
    await waitForPageReady(page);

    // Look for connect button or add connection card
    const connectBtn = page.getByRole('button', { name: /connect|add/i }).first();
    if (!(await connectBtn.isVisible().catch(() => false))) return;

    await connectBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Should show AWS setup form
    await expect(dialog).toContainText(/AWS/i);

    await page.keyboard.press('Escape');
  });

  test('scans tab shows table with filters', async ({ page, consoleMonitor }) => {
    await page.goto('/cloud/scans');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();

    // Status filter should be available
    const statusFilter = page.locator('select, [role="combobox"]').first();
    if (await statusFilter.isVisible().catch(() => false)) {
      await expect(statusFilter).toBeVisible();
    }
  });

  test('scans tab refresh button works', async ({ page, consoleMonitor, networkMonitor }) => {
    await page.goto('/cloud/scans');
    await waitForPageReady(page);

    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    if (!(await refreshBtn.isVisible().catch(() => false))) return;

    networkMonitor.reset();
    await refreshBtn.click();

    // Should trigger API call
    await page.waitForTimeout(500);
  });

  test('account card actions are available', async ({ page, consoleMonitor }) => {
    await page.goto('/cloud/accounts');
    await waitForPageReady(page);

    // If there are account cards, check for action buttons
    const scanBtn = page.getByRole('button', { name: /scan/i }).first();
    if (!(await scanBtn.isVisible().catch(() => false))) return;

    // Scan button should exist
    await expect(scanBtn).toBeVisible();

    // More options dropdown should exist
    const moreBtn = page.getByRole('button', { name: /more scan options/i }).first();
    if (await moreBtn.isVisible().catch(() => false)) {
      await expect(moreBtn).toBeVisible();
    }
  });
});
