import { chromium, type FullConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { healthCheck, getApiBaseUrl, getFrontendBaseUrl, apiRequest } from './helpers/browser-harness';

async function globalSetup(_config: FullConfig) {
  const runE2E = process.env.RUN_E2E === 'true';
  if (!runE2E) {
    console.log('⏭  RUN_E2E not set — skipping UI tests');
    return;
  }

  console.log('🔧 UI Test Global Setup');

  // 1. Health check
  console.log('  Checking services...');
  try {
    await healthCheck();
  } catch (e) {
    throw new Error(`Services not available. Start with 'just dev'. Error: ${e}`);
  }
  console.log('  ✓ Backend and frontend are up');

  // 2. Seed Postgres
  console.log('  Seeding Postgres...');
  const rootDir = process.cwd();
  try {
    execSync('bun backend/scripts/seed-stress-test.ts --tier small', {
      cwd: rootDir,
      stdio: 'pipe',
      env: { ...process.env, SEED_ORG_ID: 'local-dev' },
    });
  } catch (e: any) {
    console.error('  Postgres seed stderr:', e.stderr?.toString());
    throw new Error(`Postgres seed failed: ${e.message}`);
  }
  console.log('  ✓ Postgres seeded');

  // 3. ClickHouse is auto-seeded via workflow runs — no manual seed needed

  // 4. Generate auth storage state
  console.log('  Generating auth storage state...');
  const authDir = `${rootDir}/e2e-tests/ui/test-results/.auth`;
  mkdirSync(authDir, { recursive: true });

  const adminUsername = process.env.E2E_ADMIN_USER ?? 'admin';
  const adminPassword = process.env.E2E_ADMIN_PASS ?? 'admin';

  // Launch browser and perform actual login to get proper auth state + cookies
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const frontendUrl = getFrontendBaseUrl();
  await page.goto(frontendUrl);

  // Wait for the admin login form to appear and fill it
  await page.getByLabel('Username').fill(adminUsername);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: /login/i }).click();

  // Wait for successful login — the login form should disappear
  await page.waitForSelector('text=Admin Login', { state: 'hidden', timeout: 15_000 });

  const storageStatePath = `${authDir}/storage-state.json`;
  await context.storageState({ path: storageStatePath });
  await browser.close();
  console.log('  ✓ Auth storage state saved (via browser login)');

  // 5. Write seed manifest for mutating tests to validate against
  console.log('  Building seed manifest...');
  try {
    const [workflows, schedules, webhooks, secrets, apiKeys, artifacts] = await Promise.all([
      apiRequest<{ data: Array<{ id: string }> }>('/workflows/summary'),
      apiRequest<{ data: Array<{ id: string }> }>('/schedules'),
      apiRequest<{ data: Array<{ id: string }> }>('/webhooks/configurations'),
      apiRequest<{ data: Array<{ id: string }> }>('/secrets'),
      apiRequest<{ data: Array<{ id: string }> }>('/api-keys'),
      apiRequest<{ data: Array<{ id: string }> }>('/artifacts'),
    ]);

    const manifest = {
      workflows: { count: workflows.data?.length ?? 0, sampleId: workflows.data?.[0]?.id ?? null },
      schedules: { count: schedules.data?.length ?? 0, sampleId: schedules.data?.[0]?.id ?? null },
      webhooks: { count: webhooks.data?.length ?? 0, sampleId: webhooks.data?.[0]?.id ?? null },
      secrets: { count: secrets.data?.length ?? 0, sampleId: secrets.data?.[0]?.id ?? null },
      apiKeys: { count: apiKeys.data?.length ?? 0, sampleId: apiKeys.data?.[0]?.id ?? null },
      artifacts: { count: artifacts.data?.length ?? 0, sampleId: artifacts.data?.[0]?.id ?? null },
    };

    writeFileSync(
      `${rootDir}/e2e-tests/ui/test-results/.seed-manifest.json`,
      JSON.stringify(manifest, null, 2),
    );
    console.log('  ✓ Seed manifest written');
  } catch (e: any) {
    console.warn('  ⚠ Seed manifest failed (non-fatal):', e.message);
  }

  // 6. Write seed metadata
  const seedMeta = {
    instance: process.env.SHIPSEC_INSTANCE ?? '0',
    orgId: 'local-dev',
    tier: 'small',
    apiBaseUrl: getApiBaseUrl(),
    frontendBaseUrl: frontendUrl,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(
    `${rootDir}/e2e-tests/ui/test-results/.seed-meta.json`,
    JSON.stringify(seedMeta, null, 2),
  );

  console.log('✅ Global setup complete');
}

export default globalSetup;
