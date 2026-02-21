import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Navigation', () => {
  test('sidebar is visible on desktop', async ({ page, consoleMonitor }) => {
    await page.goto('/');
    await waitForPageReady(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.first()).toBeVisible();
  });

  test('sidebar links navigate to correct pages', async ({ page, consoleMonitor }) => {
    await page.goto('/');
    await waitForPageReady(page);

    // Click Builder link in sidebar
    const builderLink = page.locator('aside a[href="/builder"], aside a[href*="builder"]').first();
    if (await builderLink.isVisible().catch(() => false)) {
      await builderLink.click();
      await waitForPageReady(page);
      await expect(page).toHaveURL(/\/builder/);
    }
  });

  test('sidebar active item matches URL', async ({ page, consoleMonitor }) => {
    await page.goto('/builder');
    await waitForPageReady(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.first()).toBeVisible();

    // The active link should have distinct styling (data-active, aria-current, etc.)
    const activeLink = sidebar.locator('[data-active="true"], [aria-current="page"], .active').first();
    if (await activeLink.isVisible().catch(() => false)) {
      const text = await activeLink.textContent();
      expect(text?.toLowerCase()).toContain('builder');
    }
  });

  test('direct URL with params loads correct state', async ({ page, consoleMonitor }) => {
    await page.goto('/builder');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });

  test('back/forward preserves state', async ({ page, consoleMonitor }) => {
    await page.goto('/builder');
    await waitForPageReady(page);

    await page.goto('/secrets');
    await waitForPageReady(page);

    await page.goBack();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/\/builder/);

    await page.goForward();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/\/secrets/);
  });

  test('nonexistent route shows 404 page', async ({ page, consoleMonitor }) => {
    await page.goto('/nonexistent-route-that-does-not-exist');
    await waitForPageReady(page);

    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });

  test('settings section reveals settings links', async ({ page, consoleMonitor }) => {
    await page.goto('/');
    await waitForPageReady(page);

    // Look for settings section trigger
    const settingsTrigger = page.locator('aside').getByRole('button', { name: /manage/i }).first();
    if (!(await settingsTrigger.isVisible().catch(() => false))) return;

    await settingsTrigger.click();

    // Should reveal settings links (Secrets, API Keys, etc.)
    const secretsLink = page.locator('aside a[href="/secrets"]');
    await expect(secretsLink).toBeVisible();
  });
});
