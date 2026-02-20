import { test as base } from '@playwright/test';
import { NetworkMonitor } from './helpers/network-monitor';
import { ConsoleMonitor } from './helpers/console-monitor';

type UiFixtures = {
  networkMonitor: NetworkMonitor;
  consoleMonitor: ConsoleMonitor;
};

export const test = base.extend<UiFixtures>({
  networkMonitor: async ({ page }, use) => {
    const monitor = new NetworkMonitor(page);
    monitor.start();
    await use(monitor);
    monitor.stop();
  },

  consoleMonitor: async ({ page }, use) => {
    const monitor = new ConsoleMonitor(page);
    monitor.start();
    await use(monitor);
    // Assert no console errors after each test
    monitor.assertNoErrors();
    monitor.stop();
  },
});

export { expect } from '@playwright/test';
