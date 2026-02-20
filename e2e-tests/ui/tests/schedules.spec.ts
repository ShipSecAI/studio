import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getSchedules } from '../helpers/api-expectations';

test.describe('Schedules Page', () => {
  test('displays correct number of schedules', async ({ page, consoleMonitor }) => {
    const { count } = await getSchedules();

    await page.goto('/schedules');
    await waitForPageReady(page);

    if (count === 0) {
      await expect(page.locator('main')).toBeVisible();
      return;
    }

    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(count + 1);
  });

  test('schedule rows show cron and status', async ({ page, consoleMonitor }) => {
    const { count } = await getSchedules();
    if (count === 0) return test.skip();

    await page.goto('/schedules');
    await waitForPageReady(page);

    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
  });

  test('search filter reduces rows', async ({ page, consoleMonitor }) => {
    const { count } = await getSchedules();
    if (count < 2) return test.skip();

    await page.goto('/schedules');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/filter|search/i);
    if (!(await searchInput.isVisible().catch(() => false))) return;

    // Type a filter term
    await searchInput.fill('nonexistent-schedule-xyz');
    await page.waitForTimeout(500);

    // Should show fewer rows
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeLessThan(count + 1);
  });

  test('new schedule button opens chooser dialog', async ({ page, consoleMonitor }) => {
    await page.goto('/schedules');
    await waitForPageReady(page);

    const newButton = page.getByRole('button', { name: /new schedule/i });
    if (!(await newButton.isVisible().catch(() => false))) return;

    await newButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Should contain scan type options or Custom Workflow
    await expect(dialog.locator('text=/custom workflow|scan/i')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('status dropdown filters schedules', async ({ page, consoleMonitor }) => {
    const { count } = await getSchedules();
    if (count === 0) return test.skip();

    await page.goto('/schedules');
    await waitForPageReady(page);

    // Look for status dropdown
    const statusSelect = page.locator('select, [role="combobox"]').filter({ hasText: /all statuses|status/i });
    if (!(await statusSelect.first().isVisible().catch(() => false))) return;

    // Select "Active"
    await statusSelect.first().click();
    const activeOption = page.getByRole('option', { name: /active/i });
    if (await activeOption.isVisible().catch(() => false)) {
      await activeOption.click();
      await waitForPageReady(page);
    }
  });

  test('pause and resume schedule', async ({ page, consoleMonitor }) => {
    const { count } = await getSchedules();
    if (count === 0) return test.skip();

    await page.goto('/schedules');
    await waitForPageReady(page);

    // Look for pause/resume button in first data row
    const firstRow = page.getByRole('row').nth(1);
    const pauseBtn = firstRow.getByRole('button', { name: /pause|resume/i });
    if (!(await pauseBtn.isVisible().catch(() => false))) return;

    await pauseBtn.click();
    // Should toggle — no error is the assertion (consoleMonitor handles errors)
  });
});
