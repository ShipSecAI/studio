import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getApiKeys } from '../helpers/api-expectations';
import { createTestApiKey } from '../helpers/test-data-factory';

test.describe('API Keys Page', () => {
  test('displays correct number of API keys', async ({ page, consoleMonitor }) => {
    const { count } = await getApiKeys();

    await page.goto('/api-keys');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('API key names are visible', async ({ page, consoleMonitor }) => {
    const { count } = await getApiKeys();
    if (count === 0) return test.skip();

    await page.goto('/api-keys');
    await waitForPageReady(page);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
  });
});

test.describe('API Keys CRUD', () => {
  test.describe.configure({ mode: 'serial' });

  let testKey: Awaited<ReturnType<typeof createTestApiKey>> | null = null;

  test.afterEach(async () => {
    if (testKey) {
      await testKey.cleanup();
      testKey = null;
    }
  });

  test('create API key via dialog', async ({ page, consoleMonitor }) => {
    await page.goto('/api-keys');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /create new key/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill form
    await dialog.locator('#name').fill('test-key-ui');
    await dialog.locator('#description').fill('Created by UI test');

    // Check permission checkboxes
    const runCheckbox = dialog.locator('#perm-wf-run');
    if (await runCheckbox.isVisible()) {
      await runCheckbox.check();
    }

    // Submit
    await dialog.getByRole('button', { name: /create key/i }).click();

    // Key should be displayed — look for the Done button (phase 2 of dialog)
    await expect(dialog.getByRole('button', { name: /done/i })).toBeVisible({ timeout: 10_000 });

    // Click Done to close
    await dialog.getByRole('button', { name: /done/i }).click();

    // Key name should appear in table
    await expect(page.getByText('test-key-ui')).toBeVisible();
  });

  test('delete API key via confirm dialog', async ({ page, consoleMonitor }) => {
    testKey = await createTestApiKey();
    const keyName = testKey.name;

    await page.goto('/api-keys');
    await waitForPageReady(page);

    // Find the row and click delete
    const row = page.getByRole('row').filter({ hasText: keyName });
    await row.getByRole('button', { name: /delete key/i }).click();

    // Confirm dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /confirm/i }).click();

    testKey = null;
    await expect(page.getByText(keyName)).not.toBeVisible();
  });
});
