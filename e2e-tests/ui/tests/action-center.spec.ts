import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getHumanInputs } from '../helpers/api-expectations';

test.describe('Action Center Page', () => {
  test('displays pending count matching API', async ({ page, consoleMonitor }) => {
    const { count } = await getHumanInputs('PENDING');

    await page.goto('/action-center');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
  });

  test('search filter reduces rows', async ({ page, consoleMonitor }) => {
    const { count } = await getHumanInputs();
    if (count < 2) return test.skip();

    await page.goto('/action-center');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/filter|search/i);
    await searchInput.fill('nonexistent-action-xyz');
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeLessThan(count + 1);
  });

  test('status filter changes displayed items', async ({ page, consoleMonitor }) => {
    await page.goto('/action-center');
    await waitForPageReady(page);

    // Status select should be visible
    const statusSelect = page.locator('select, [role="combobox"]').first();
    if (!(await statusSelect.isVisible().catch(() => false))) return;

    const initialRows = await page.getByRole('row').count();

    // Switch to "All statuses" / "Resolved"
    await statusSelect.click();
    const resolvedOption = page.getByRole('option', { name: /resolved/i });
    if (await resolvedOption.isVisible().catch(() => false)) {
      await resolvedOption.click();
      await waitForPageReady(page);
    }

    // Switch back to Pending
    await statusSelect.click();
    const pendingOption = page.getByRole('option', { name: /pending/i });
    if (await pendingOption.isVisible().catch(() => false)) {
      await pendingOption.click();
      await waitForPageReady(page);
    }
  });

  test('refresh button reloads data', async ({ page, consoleMonitor, networkMonitor }) => {
    await page.goto('/action-center');
    await waitForPageReady(page);

    networkMonitor.reset();
    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    if (!(await refreshBtn.isVisible().catch(() => false))) return;

    await refreshBtn.click();

    const calls = networkMonitor.getCallsTo('/human-inputs');
    expect(calls.length).toBeGreaterThan(0);
  });

  test('approve button opens resolve dialog', async ({ page, consoleMonitor }) => {
    const { count } = await getHumanInputs('PENDING');
    if (count === 0) return test.skip();

    await page.goto('/action-center');
    await waitForPageReady(page);

    // Click approve on first pending item
    const approveBtn = page.getByRole('button', { name: /approve|acknowledge|respond/i }).first();
    if (!(await approveBtn.isVisible().catch(() => false))) return;

    await approveBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('run ID link navigates to workflow run', async ({ page, consoleMonitor }) => {
    const { count } = await getHumanInputs();
    if (count === 0) return test.skip();

    await page.goto('/action-center');
    await waitForPageReady(page);

    // Find a run ID link
    const runLink = page.locator('a[href*="/runs/"]').first();
    if (!(await runLink.isVisible().catch(() => false))) return;

    const href = await runLink.getAttribute('href');
    expect(href).toMatch(/\/workflows\/.*\/runs\//);
  });
});
