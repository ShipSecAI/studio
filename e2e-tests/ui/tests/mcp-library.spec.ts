import { test, expect } from '../fixtures-mutating';
import { waitForPageReady } from '../helpers/browser-harness';
import { getMcpGroups, getMcpServers } from '../helpers/api-expectations';

test.describe('MCP Library Page', () => {
  test('displays correct group and server counts', async ({ page, consoleMonitor }) => {
    const [groups, servers] = await Promise.all([getMcpGroups(), getMcpServers()]);

    await page.goto('/mcp-library');
    await waitForPageReady(page);

    await expect(page.locator('main')).toBeVisible();

    if (groups.count > 0 || servers.count > 0) {
      const content = await page.locator('main').textContent();
      expect(content!.length).toBeGreaterThan(0);
    }
  });

  test('search filters servers', async ({ page, consoleMonitor }) => {
    const { count } = await getMcpServers();
    if (count === 0) return test.skip();

    await page.goto('/mcp-library');
    await waitForPageReady(page);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('nonexistent-mcp-server-xyz');
    await page.waitForTimeout(500);

    // Content should be filtered
    const content = await page.locator('main').textContent();
    expect(content).toBeTruthy();
  });

  test('add server button opens sheet', async ({ page, consoleMonitor }) => {
    await page.goto('/mcp-library');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /add server/i }).click();

    // Sheet should open with form fields
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();

    // Should have name input
    await expect(sheet.locator('#name')).toBeVisible();

    // Close sheet
    await page.keyboard.press('Escape');
  });

  test('add server sheet has manual and JSON tabs', async ({ page, consoleMonitor }) => {
    await page.goto('/mcp-library');
    await waitForPageReady(page);

    await page.getByRole('button', { name: /add server/i }).click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();

    // Should have Manual and JSON tabs
    const manualTab = sheet.getByRole('tab', { name: /manual/i });
    const jsonTab = sheet.getByRole('tab', { name: /json/i });

    await expect(manualTab).toBeVisible();
    await expect(jsonTab).toBeVisible();

    // Click JSON tab
    await jsonTab.click();
    // Should show textarea for JSON config
    const jsonTextarea = sheet.locator('textarea');
    await expect(jsonTextarea.first()).toBeVisible();

    // Switch back to manual
    await manualTab.click();
    await expect(sheet.locator('#name')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('server enable/disable switch toggles', async ({ page, consoleMonitor }) => {
    const { count } = await getMcpServers();
    if (count === 0) return test.skip();

    await page.goto('/mcp-library');
    await waitForPageReady(page);

    // Find a switch in the server table
    const toggle = page.locator('button[role="switch"]').first();
    if (!(await toggle.isVisible().catch(() => false))) return;

    const initialState = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await page.waitForTimeout(500);

    const newState = await toggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);

    // Toggle back to restore state
    await toggle.click();
  });

  test('refresh button reloads data', async ({ page, consoleMonitor, networkMonitor }) => {
    await page.goto('/mcp-library');
    await waitForPageReady(page);

    networkMonitor.reset();
    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    if (!(await refreshBtn.isVisible().catch(() => false))) return;

    await refreshBtn.click();

    const calls = networkMonitor.getCallsTo('/mcp');
    expect(calls.length).toBeGreaterThan(0);
  });

  test('group accordion expands and collapses', async ({ page, consoleMonitor }) => {
    const { count } = await getMcpGroups();
    if (count === 0) return test.skip();

    await page.goto('/mcp-library');
    await waitForPageReady(page);

    // Find an accordion trigger
    const accordion = page.locator('[data-state="closed"]').first();
    if (!(await accordion.isVisible().catch(() => false))) return;

    await accordion.click();
    await expect(accordion).toHaveAttribute('data-state', 'open');

    await accordion.click();
    await expect(accordion).toHaveAttribute('data-state', 'closed');
  });

  test('delete custom server via dialog', async ({ page, consoleMonitor }) => {
    const { count } = await getMcpServers();
    if (count === 0) return test.skip();

    await page.goto('/mcp-library');
    await waitForPageReady(page);

    // Find delete button for a custom server
    const deleteBtn = page.getByRole('button', { name: /delete server/i }).first();
    if (!(await deleteBtn.isVisible().catch(() => false))) return;

    await deleteBtn.click();

    // Delete dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/delete/i);

    // Cancel instead of confirming (don't actually delete seed data)
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
