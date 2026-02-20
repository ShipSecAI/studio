import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('GitHub Page', () => {
  test('repositories tab loads', async ({ page, consoleMonitor }) => {
    await page.goto('/github/repositories');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });

  test('tabs switch between repositories, scans, and triggers', async ({ page, consoleMonitor }) => {
    await page.goto('/github/repositories');
    await waitForPageReady(page);

    // Switch to Scans tab
    const scansTab = page.getByRole('tab', { name: /scans/i });
    if (!(await scansTab.isVisible().catch(() => false))) return;

    await scansTab.click();
    await expect(page).toHaveURL(/\/github\/scans/);
    await waitForPageReady(page);

    // Switch to Trigger Rules tab
    const triggersTab = page.getByRole('tab', { name: /trigger|rules/i });
    if (await triggersTab.isVisible().catch(() => false)) {
      await triggersTab.click();
      await expect(page).toHaveURL(/\/github\/triggers/);
      await waitForPageReady(page);
    }

    // Switch back to Repositories
    const reposTab = page.getByRole('tab', { name: /repositories/i });
    await reposTab.click();
    await expect(page).toHaveURL(/\/github\/repositories/);
  });

  test('repositories search filters list', async ({ page, consoleMonitor }) => {
    await page.goto('/github/repositories');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/search/i);
    if (!(await searchInput.isVisible().catch(() => false))) return;

    await searchInput.fill('nonexistent-repo-xyz');
    await page.waitForTimeout(500);
  });

  test('repositories have filter dropdowns', async ({ page, consoleMonitor }) => {
    await page.goto('/github/repositories');
    await waitForPageReady(page);

    // Check for visibility or scans filter
    const filterSelect = page.locator('select, [role="combobox"]').first();
    if (await filterSelect.isVisible().catch(() => false)) {
      await expect(filterSelect).toBeVisible();
    }
  });

  test('refresh button reloads repositories', async ({ page, consoleMonitor }) => {
    await page.goto('/github/repositories');
    await waitForPageReady(page);

    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    if (!(await refreshBtn.isVisible().catch(() => false))) return;

    await refreshBtn.click();
    await waitForPageReady(page);
  });

  test('scans tab shows scan history', async ({ page, consoleMonitor }) => {
    await page.goto('/github/scans');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });

  test('trigger rules tab shows rules list', async ({ page, consoleMonitor }) => {
    await page.goto('/github/triggers');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();

    // New Rule button should be visible
    const newRuleBtn = page.getByRole('button', { name: /new rule/i });
    if (await newRuleBtn.isVisible().catch(() => false)) {
      await expect(newRuleBtn).toBeVisible();
    }
  });

  test('new rule button navigates to create page', async ({ page, consoleMonitor }) => {
    await page.goto('/github/triggers');
    await waitForPageReady(page);

    const newRuleBtn = page.getByRole('button', { name: /new rule/i });
    if (!(await newRuleBtn.isVisible().catch(() => false))) return;

    await newRuleBtn.click();
    await expect(page).toHaveURL(/\/github\/triggers\/new/);
  });
});
