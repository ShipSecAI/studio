import { test as base } from '@playwright/test';
import { NetworkMonitor } from './helpers/network-monitor';
import { ConsoleMonitor } from './helpers/console-monitor';

type UiFixtures = {
  networkMonitor: NetworkMonitor;
  consoleMonitor: ConsoleMonitor;
};

/**
 * Mutating project fixtures — auto-enforces duplicate API call detection in teardown.
 * All mutating specs MUST import from this file instead of fixtures.ts.
 */
export const test = base.extend<UiFixtures>({
  networkMonitor: async ({ page }, use) => {
    const monitor = new NetworkMonitor(page);
    monitor.start();
    await use(monitor);
    // AUTO-ENFORCED: duplicate check — cannot be accidentally skipped
    monitor.assertNoDuplicates();
    monitor.stop();
  },

  consoleMonitor: async ({ page }, use) => {
    const monitor = new ConsoleMonitor(page);
    monitor.start();
    await use(monitor);
    monitor.assertNoErrors();
    monitor.stop();
  },
});

export { expect } from '@playwright/test';
