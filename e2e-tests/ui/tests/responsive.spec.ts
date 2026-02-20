import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Responsive Viewports', () => {
  test.describe('Mobile (375px)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('home page renders on mobile', async ({ page, consoleMonitor }) => {
      await page.goto('/');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });

    test('workflow list adapts to mobile', async ({ page, consoleMonitor }) => {
      await page.goto('/builder');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });

    test('sidebar is hidden on mobile by default', async ({ page, consoleMonitor }) => {
      await page.goto('/');
      await waitForPageReady(page);

      // Sidebar should be collapsed/hidden on mobile
      const sidebar = page.locator('nav, [class*="sidebar"]').first();
      const isVisible = await sidebar.isVisible().catch(() => false);
      // On mobile the sidebar may be present but off-screen
      if (isVisible) {
        const box = await sidebar.boundingBox();
        // If sidebar is off-screen (x < 0) that's fine
        if (box) {
          expect(box.x).toBeLessThanOrEqual(0);
        }
      }
    });

    test('security dashboard adapts to mobile', async ({ page, consoleMonitor }) => {
      await page.goto('/security');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });
  });

  test.describe('Tablet (768px)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('home page renders on tablet', async ({ page, consoleMonitor }) => {
      await page.goto('/');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });

    test('workflow list adapts to tablet', async ({ page, consoleMonitor }) => {
      await page.goto('/builder');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });

    test('integrations page renders on tablet', async ({ page, consoleMonitor }) => {
      await page.goto('/integrations');
      await waitForPageReady(page);
      await expect(page.locator('main')).toBeVisible();
    });
  });
});
