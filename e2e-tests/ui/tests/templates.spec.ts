import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';

test.describe('Templates Page', () => {
  test('template cards render', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    const cards = page.locator('[class*="card"], [data-testid*="template"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('category sections are present', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    const headings = page.getByRole('heading');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);

    // Should have known category headings
    const content = await page.locator('main').textContent();
    const knownCategories = ['Code Security', 'Cloud Security', 'Attack Surface'];
    const found = knownCategories.filter((cat) => content?.includes(cat));
    expect(found.length).toBeGreaterThan(0);
  });

  test('clicking a template card opens detail dialog', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    const cards = page.locator('[class*="card"], [data-testid*="template"]');
    if ((await cards.count()) === 0) return test.skip();

    await cards.first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('detail dialog shows template info and actions', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    const cards = page.locator('[class*="card"], [data-testid*="template"]');
    if ((await cards.count()) === 0) return test.skip();

    await cards.first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Should have Use Template and Close buttons
    await expect(dialog.getByRole('button', { name: /use template/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /close/i }).last()).toBeVisible();

    // Close dialog
    await dialog.getByRole('button', { name: /close/i }).last().click();
    await expect(dialog).not.toBeVisible();
  });

  test('use template button navigates to builder', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    // Use the card-level Use Template button (avoids opening dialog)
    const useBtn = page.getByRole('button', { name: /use template/i }).first();
    if (!(await useBtn.isVisible().catch(() => false))) return;

    await useBtn.click();

    // Should navigate to workflows page (new or existing)
    await page.waitForURL(/\/workflows\//, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/workflows\//);
  });

  test('show details button opens dialog', async ({ page, consoleMonitor }) => {
    await page.goto('/templates');
    await waitForPageReady(page);

    const showDetailsBtn = page.getByRole('button', { name: /show details/i }).first();
    if (!(await showDetailsBtn.isVisible().catch(() => false))) return;

    await showDetailsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Dialog should contain template content
    const dialogText = await dialog.textContent();
    expect(dialogText!.length).toBeGreaterThan(50);

    await page.keyboard.press('Escape');
  });
});
