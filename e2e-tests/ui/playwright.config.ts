import { defineConfig } from '@playwright/test';
import path from 'node:path';

const DEFAULT_INSTANCE = 0;
const FRONTEND_BASE_PORT = 5173;

function getInstance(): number {
  const raw = process.env.SHIPSEC_INSTANCE ?? String(DEFAULT_INSTANCE);
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_INSTANCE : parsed;
}

const instance = getInstance();
const frontendPort = FRONTEND_BASE_PORT + instance * 100;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/artifacts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { outputFolder: './test-results/report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    storageState: path.join(__dirname, 'test-results', '.auth', 'storage-state.json'),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  projects: [
    {
      name: 'read-only',
      testMatch: /\/(home|workflow-detail|workflow-execute|security-dashboard|navigation|responsive|integrations|templates|cloud-accounts|github|github-integration)\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'mutating',
      testMatch: /\/(secrets|api-keys|workflow-list|schedules|webhooks|action-center|artifacts|mcp-library)\.spec\.ts/,
      use: { browserName: 'chromium' },
      fullyParallel: false,
      workers: 1,
    },
  ],
});
