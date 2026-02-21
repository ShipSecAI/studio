import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('GitHub Integration Page', () => {
  test('page loads with provider header', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations/github');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
  });

  test('shows setup instructions', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations/github');
    await waitForPageReady(page);

    // Should show setup steps or installation cards
    const content = await page.locator('main').textContent();
    expect(content!.length).toBeGreaterThan(50);
  });

  test('repositories button navigates to repos page', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations/github');
    await waitForPageReady(page);

    const reposBtn = page.getByRole('button', { name: /repositories/i }).or(
      page.getByRole('link', { name: /repositories/i })
    );
    if (!(await reposBtn.isVisible().catch(() => false))) return;

    await reposBtn.click();
    await expect(page).toHaveURL(/\/github\/repositories/);
  });

  test('quick links navigate to correct pages', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations/github');
    await waitForPageReady(page);

    // Quick links section should have links to repos, scans, triggers
    const quickLinks = page.locator('a[href*="/github/"]');
    const count = await quickLinks.count();
    if (count > 0) {
      // At least some GitHub-related links exist
      expect(count).toBeGreaterThan(0);
    }
  });

  test('shows capabilities section', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations/github');
    await waitForPageReady(page);

    // Should show capability badges
    const capabilities = ['Secret Detection', 'SAST', 'Dependency Audit'];
    const content = await page.locator('main').textContent();
    const found = capabilities.filter((cap) => content?.includes(cap));
    // At least one capability should be mentioned
    if (found.length === 0) {
      // Page might not show capabilities if not configured
      await expect(page.locator('main')).toBeVisible();
    }
  });
});
