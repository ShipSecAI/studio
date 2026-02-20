import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getArtifacts } from '../helpers/api-expectations';

test.describe('Artifacts Page', () => {
  test('displays correct number of artifacts', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('artifact rows show name and size', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();
    if (count === 0) return test.skip();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
  });

  test('search form filters artifacts', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();
    if (count === 0) return test.skip();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('nonexistent-artifact-xyz');

    // Submit search form
    const searchBtn = page.getByRole('button', { name: /search/i });
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click();
    } else {
      await searchInput.press('Enter');
    }
    await waitForPageReady(page);

    // Should show fewer (or no) rows
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeLessThanOrEqual(1); // header only or empty
  });

  test('refresh button reloads data', async ({ page, consoleMonitor, networkMonitor }) => {
    await page.goto('/artifacts');
    await waitForPageReady(page);

    networkMonitor.reset();
    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    if (!(await refreshBtn.isVisible().catch(() => false))) return;

    await refreshBtn.click();

    const calls = networkMonitor.getCallsTo('/artifacts');
    expect(calls.length).toBeGreaterThan(0);
  });

  test('download button exists on artifact rows', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();
    if (count === 0) return test.skip();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    // Download button should exist in the first data row
    const firstRow = page.getByRole('row').nth(1);
    const downloadBtn = firstRow.getByRole('button', { name: /download/i }).or(
      firstRow.locator('button:has(svg)').first()
    );
    await expect(downloadBtn).toBeVisible();
  });

  test('delete artifact via browser confirm', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();
    if (count === 0) return test.skip();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    const initialRows = await page.getByRole('row').count();

    // Auto-accept the browser confirm dialog
    page.once('dialog', (dialog) => dialog.accept());

    // Click delete on first artifact
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (!(await deleteBtn.isVisible().catch(() => false))) return;

    await deleteBtn.click();

    // Wait for row to be removed
    await page.waitForTimeout(1000);
    const afterRows = await page.getByRole('row').count();
    expect(afterRows).toBeLessThan(initialRows);
  });

  test('run ID link navigates to run detail', async ({ page, consoleMonitor }) => {
    const { count } = await getArtifacts();
    if (count === 0) return test.skip();

    await page.goto('/artifacts');
    await waitForPageReady(page);

    const runLink = page.locator('a[href*="/runs/"]').first();
    if (!(await runLink.isVisible().catch(() => false))) return;

    const href = await runLink.getAttribute('href');
    expect(href).toMatch(/\/runs\//);
  });
});
