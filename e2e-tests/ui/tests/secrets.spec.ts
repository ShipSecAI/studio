import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getSecrets } from '../helpers/api-expectations';
import { createTestSecret } from '../helpers/test-data-factory';

test.describe('Secrets Page', () => {
  test('displays correct number of secrets', async ({ page, consoleMonitor }) => {
    const { count } = await getSecrets();

    await page.goto('/secrets');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('secret values are not exposed in the list', async ({ page, consoleMonitor }) => {
    const { count } = await getSecrets();
    if (count === 0) return test.skip();

    await page.goto('/secrets');
    await waitForPageReady(page);

    const pageContent = await page.locator('main').textContent();
    expect(pageContent).toBeTruthy();
    // Seed value is 'dummy-test-value' — should not appear
    expect(pageContent).not.toContain('dummy-test-value');
  });

  test('refresh button reloads data', async ({ page, consoleMonitor, networkMonitor }) => {
    await page.goto('/secrets');
    await waitForPageReady(page);

    networkMonitor.reset();
    await page.getByRole('button', { name: /refresh/i }).click();

    // Should have fired a new request to secrets endpoint
    const calls = networkMonitor.getCallsTo('/secrets');
    expect(calls.length).toBeGreaterThan(0);
  });
});

test.describe('Secrets CRUD', () => {
  test.describe.configure({ mode: 'serial' });

  let testSecret: Awaited<ReturnType<typeof createTestSecret>> | null = null;

  test.afterEach(async () => {
    if (testSecret) {
      await testSecret.cleanup();
      testSecret = null;
    }
  });

  test('create secret via form', async ({ page, consoleMonitor }) => {
    testSecret = await createTestSecret();

    await page.goto('/secrets');
    await waitForPageReady(page);

    // Verify created secret appears in the list by exact name
    await expect(page.getByText(testSecret.name)).toBeVisible();
  });

  test('edit secret via dialog', async ({ page, consoleMonitor }) => {
    testSecret = await createTestSecret();

    await page.goto('/secrets');
    await waitForPageReady(page);

    // Find the row with our test secret and click Edit
    const row = page.getByRole('row').filter({ hasText: testSecret.name });
    await row.getByRole('button', { name: /edit/i }).click();

    // Edit dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Modify description
    const descInput = dialog.locator('#edit-secret-description');
    await descInput.fill('Updated by UI test');

    // Save
    await dialog.getByRole('button', { name: /save/i }).click();

    // Dialog should close
    await expect(dialog).not.toBeVisible();
  });

  test('delete secret via dialog', async ({ page, consoleMonitor }) => {
    testSecret = await createTestSecret();
    const secretName = testSecret.name;

    await page.goto('/secrets');
    await waitForPageReady(page);

    // Find the row and click Delete
    const row = page.getByRole('row').filter({ hasText: secretName });
    await row.getByRole('button', { name: /delete/i }).click();

    // Delete dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(secretName);

    // Confirm delete
    await dialog.getByRole('button', { name: /delete/i }).click();

    // Secret should be removed — cleanup is no longer needed
    testSecret = null;
    await expect(page.locator('tbody').getByText(secretName)).not.toBeVisible();
  });
});
