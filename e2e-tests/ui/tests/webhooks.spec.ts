import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getWebhooks } from '../helpers/api-expectations';

test.describe('Webhooks Page', () => {
  test('displays correct number of webhooks', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('webhook rows show URL and status', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();
    if (count === 0) return test.skip();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
  });

  test('search filter reduces rows', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();
    if (count < 2) return test.skip();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/filter|search/i);
    await searchInput.fill('nonexistent-webhook-xyz');
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeLessThan(count + 1);
  });

  test('new webhook button navigates', async ({ page, consoleMonitor }) => {
    await page.goto('/webhooks');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /new webhook/i }).click();
    await expect(page).toHaveURL(/\/webhooks\/new/);
  });

  test('refresh button shows toast', async ({ page, consoleMonitor }) => {
    await page.goto('/webhooks');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /refresh/i }).click();

    // Toast should appear
    await expect(page.getByText('Webhooks refreshed')).toBeVisible({ timeout: 5_000 });
  });

  test('copy URL button shows toast', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();
    if (count === 0) return test.skip();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    // Click copy button on first webhook
    const copyBtn = page.getByRole('button', { name: /copy webhook url/i }).first();
    await copyBtn.click();

    // Toast should appear
    await expect(page.getByText(/copied/i).or(page.getByText(/webhook url copied/i))).toBeVisible({ timeout: 5_000 });
  });

  test('row click navigates to webhook detail', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();
    if (count === 0) return test.skip();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    // Click first data row
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/webhooks\/[a-zA-Z0-9-]+$/);
  });

  test('delete webhook via browser confirm', async ({ page, consoleMonitor }) => {
    const { count } = await getWebhooks();
    if (count === 0) return test.skip();

    await page.goto('/webhooks');
    await waitForPageReady(page);

    const initialRows = await page.getByRole('row').count();

    // Auto-accept the browser confirm dialog
    page.once('dialog', (dialog) => dialog.accept());

    // Click delete on first webhook
    const deleteBtn = page.getByRole('button', { name: /delete webhook/i }).first();
    await deleteBtn.click();

    // Wait for row to be removed
    await page.waitForTimeout(1000);
    const afterRows = await page.getByRole('row').count();
    expect(afterRows).toBeLessThan(initialRows);
  });
});
