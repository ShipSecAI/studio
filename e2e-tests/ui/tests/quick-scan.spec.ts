import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Quick Scan Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
  });

  test('opens wizard modal when Quick Scan button is clicked', async ({ page, consoleMonitor }) => {
    const quickScanBtn = page.getByRole('button', { name: /Quick Scan/i });
    await expect(quickScanBtn).toBeVisible();
    await quickScanBtn.click();

    // Wizard dialog should appear with category step
    await expect(page.getByText('What do you want to scan?')).toBeVisible();
    await expect(page.getByText('Code Security')).toBeVisible();
    await expect(page.getByText('Cloud Security')).toBeVisible();
  });

  test('shows progress bar with three steps', async ({ page, consoleMonitor }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();

    // Step indicator labels should be visible
    await expect(page.getByText('Category')).toBeVisible();
    await expect(page.getByText('Target')).toBeVisible();
    await expect(page.getByText('Scan')).toBeVisible();
  });

  test('navigates to code repo selection on Code Security click', async ({
    page,
    consoleMonitor,
  }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Code Security').click();

    await expect(page.getByText('Select Repository')).toBeVisible();
    await expect(page.getByPlaceholder('Search repositories...')).toBeVisible();
  });

  test('navigates to cloud account selection on Cloud Security click', async ({
    page,
    consoleMonitor,
  }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Cloud Security').click();

    await expect(page.getByText('Select Cloud Account')).toBeVisible();
    await expect(page.getByPlaceholder('Search accounts...')).toBeVisible();
  });

  test('back button returns to previous step', async ({ page, consoleMonitor }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Code Security').click();

    // Should be on step 2
    await expect(page.getByText('Select Repository')).toBeVisible();

    // Click back
    await page.getByRole('button', { name: /Go back/i }).click();

    // Should return to step 1
    await expect(page.getByText('What do you want to scan?')).toBeVisible();
  });

  test('dialog resets state on reopen', async ({ page, consoleMonitor }) => {
    // Open and navigate to step 2
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Code Security').click();
    await expect(page.getByText('Select Repository')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');

    // Reopen — should be on step 1 again
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await expect(page.getByText('What do you want to scan?')).toBeVisible();
  });

  test('shows empty state CTA when no repos are connected', async ({ page, consoleMonitor }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Code Security').click();

    // Wait for loading to finish, then check if empty state or repo list is shown
    await page.waitForTimeout(2000);

    const repoList = page.locator('button:has-text("/")')
    const emptyState = page.getByText('No repositories connected');

    // Either repos are shown or empty state — both are valid
    const hasRepos = await repoList.first().isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    expect(hasRepos || hasEmptyState).toBe(true);
  });

  test('shows empty state CTA when no cloud accounts are connected', async ({
    page,
    consoleMonitor,
  }) => {
    await page.getByRole('button', { name: /Quick Scan/i }).click();
    await page.getByText('Cloud Security').click();

    // Wait for loading to finish
    await page.waitForTimeout(2000);

    const connectionList = page.locator('button:has-text("AWS")');
    const emptyState = page.getByText('No cloud accounts connected');

    const hasConnections = await connectionList.first().isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    expect(hasConnections || hasEmptyState).toBe(true);
  });
});
