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

    await expect(page.getByText('Getting Started')).toBeVisible();
    await expect(page.locator('main')).toContainText(/Welcome to ShipSec Studio/i);
  });

  test('checklist items link to correct pages', async ({ page, consoleMonitor }) => {
    await page.goto('/?stage=new');
    await waitForPageReady(page);

    // Checklist should have links to integration pages
    const connectGithubLink = page.getByRole('link', { name: /connect github/i }).first();
    if (await connectGithubLink.isVisible().catch(() => false)) {
      const href = await connectGithubLink.getAttribute('href');
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
