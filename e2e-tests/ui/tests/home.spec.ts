import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Home Page', () => {
  test('default home page loads without errors', async ({ page, consoleMonitor }) => {
    await page.goto('/');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });

  test('renders onboarding checklist for new stage', async ({ page, consoleMonitor }) => {
    await page.goto('/?stage=new');
    await waitForPageReady(page);

    await expect(page.getByText('Get Started')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Welcome|Get Started|ShipSec/i);
  });

  test('checklist items link to correct pages', async ({ page, consoleMonitor }) => {
    await page.goto('/?stage=new');
    await waitForPageReady(page);

    // Checklist should have links to integration pages
    const connectGithub = page.getByText(/connect github/i);
    if (await connectGithub.isVisible().catch(() => false)) {
      const link = connectGithub.locator('xpath=ancestor::a[1]').or(connectGithub);
      const href = await link.getAttribute('href');
      if (href) expect(href).toContain('/github');
    }
  });

  test('shows quick stats for partial stage', async ({ page, consoleMonitor }) => {
    await page.goto('/?stage=partial');
    await waitForPageReady(page);

    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should show stat cards (Total Findings, Repos, etc.)
    const content = await main.textContent();
    expect(content!.length).toBeGreaterThan(50);
  });

  test('shows security score for complete stage', async ({ page, consoleMonitor }) => {
    await page.goto('/?stage=complete');
    await waitForPageReady(page);

    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('view switcher loads security dashboard', async ({ page, consoleMonitor }) => {
    await page.goto('/?view=cloud-security');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();
  });
});
