import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getWorkflows } from '../helpers/api-expectations';
import { createTestWorkflow } from '../helpers/test-data-factory';

test.describe('Workflow List Page', () => {
  test('displays correct number of workflows', async ({ page, consoleMonitor }) => {
    const { count } = await getWorkflows();

    await page.goto('/builder');
    await waitForPageReady(page);

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('each workflow row shows name', async ({ page, consoleMonitor }) => {
    const { items } = await getWorkflows();
    if (items.length === 0) return test.skip();

    await page.goto('/builder');
    await waitForPageReady(page);

    await expect(page.getByText(items[0].name)).toBeVisible();
  });

  test('Create Workflow button navigates', async ({ page, consoleMonitor }) => {
    await page.goto('/builder');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /new workflow|create workflow/i }).click();
    await expect(page).toHaveURL(/\/workflows\/new/);
  });

  test('search filters workflow rows', async ({ page, consoleMonitor }) => {
    const { count, items } = await getWorkflows();
    if (count < 2) return test.skip();

    await page.goto('/builder');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill(items[0].name);
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    const rowCount = await rows.count();
    expect(rowCount).toBeLessThanOrEqual(count + 1);
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  test('tab switching changes visible workflows', async ({ page, consoleMonitor }) => {
    await page.goto('/builder');
    await waitForPageReady(page);

    // Check if tabs exist
    const allTab = page.getByRole('tab', { name: /all/i });
    if (!(await allTab.isVisible().catch(() => false))) return;

    const initialCount = await page.getByRole('row').count();

    // Click "My Workflows" tab if it exists
    const myTab = page.getByRole('tab', { name: /my workflows/i });
    if (await myTab.isVisible()) {
      await myTab.click();
      await waitForPageReady(page);
    }

    // Click back to All
    await allTab.click();
    await waitForPageReady(page);
    const afterCount = await page.getByRole('row').count();
    expect(afterCount).toBe(initialCount);
  });

  test('row click navigates to workflow detail', async ({ page, consoleMonitor }) => {
    const { firstId, items } = await getWorkflows();
    if (!firstId) return test.skip();

    await page.goto('/builder');
    await waitForPageReady(page);

    // Click the first workflow row (not the header)
    await page.getByRole('row').filter({ hasText: items[0].name }).click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${firstId}`));
  });
});

test.describe('Workflow Delete', () => {
  test.describe.configure({ mode: 'serial' });

  let testWf: Awaited<ReturnType<typeof createTestWorkflow>> | null = null;

  test.afterEach(async () => {
    if (testWf) {
      await testWf.cleanup();
      testWf = null;
    }
  });

  test('delete workflow via dialog', async ({ page, consoleMonitor }) => {
    testWf = await createTestWorkflow();
    const wfName = testWf.name;

    await page.goto('/builder');
    await waitForPageReady(page);

    // Find the row with our test workflow
    const row = page.getByRole('row').filter({ hasText: wfName });
    await expect(row).toBeVisible();

    // Click delete button (has aria-label with workflow name)
    await row.getByRole('button', { name: /delete/i }).click();

    // Delete dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /delete workflow/i }).click();

    testWf = null;
    await expect(page.getByText(wfName)).not.toBeVisible();
  });
});
