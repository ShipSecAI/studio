import { test, expect } from '../fixtures';
import { waitForPageReady } from '../helpers/browser-harness';
import { getWorkflows, getWorkflowRuns } from '../helpers/api-expectations';

test.describe('Workflow Execute Tab', () => {
  test('shows run status matching API', async ({ page, networkMonitor, consoleMonitor }) => {
    const { firstId } = await getWorkflows();
    if (!firstId) {
      test.skip();
      return;
    }

    const { firstRun } = await getWorkflowRuns(firstId);
    if (!firstRun) {
      test.skip();
      return;
    }

    await page.goto(`/workflows/${firstId}/runs/${firstRun.id}`);
    await waitForPageReady(page);

    // Status badge should be visible
    await expect(page.getByText(new RegExp(firstRun.status, 'i'))).toBeVisible();
  });

  test('no duplicate API calls during first-load burst', async ({ page, networkMonitor, consoleMonitor }) => {
    const { firstId } = await getWorkflows();
    if (!firstId) {
      test.skip();
      return;
    }

    const { firstRun } = await getWorkflowRuns(firstId);
    if (!firstRun) {
      test.skip();
      return;
    }

    networkMonitor.reset();
    await page.goto(`/workflows/${firstId}/runs/${firstRun.id}`);
    await waitForPageReady(page);

    // Check for duplicate burst calls to known endpoints
    networkMonitor.assertNoDuplicatesInBurst(['/events', '/dataflows', '/status']);
  });
});
