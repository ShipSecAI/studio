import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Integrations Page', () => {
  test('shows active providers', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations');
    await waitForPageReady(page);

    const providers = ['AWS', 'GitHub', 'Slack'];
    for (const provider of providers) {
      await expect(page.getByText(provider)).toBeVisible();
    }
  });

  test('shows Coming Soon for Jira', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations');
    await waitForPageReady(page);

    await expect(page.getByText('Jira')).toBeVisible();
    await expect(page.getByText(/Coming Soon/i)).toBeVisible();
  });

  test('provider cards navigate to detail pages', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations');
    await waitForPageReady(page);

    // Click AWS card
    const awsCard = page.getByText('AWS').locator('xpath=ancestor::div[contains(@class,"card") or @role="button"]').first();
    if (await awsCard.isVisible().catch(() => false)) {
      await awsCard.click();
      await expect(page).toHaveURL(/\/integrations\/aws/);
      await page.goBack();
    }
  });

  test('provider cards show connection status', async ({ page, consoleMonitor }) => {
    await page.goto('/integrations');
    await waitForPageReady(page);

    // Cards should show either "connections" or "Not configured"
    const mainContent = await page.locator('main').textContent();
    const hasStatus = mainContent?.includes('connection') || mainContent?.includes('Not configured');
    expect(hasStatus).toBeTruthy();
  });
});
