import { execSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  const runE2E = process.env.RUN_E2E === 'true';
  if (!runE2E) return;

  console.log('🧹 UI Test Global Teardown');
  const rootDir = process.cwd();

  // Clean Postgres seed data
  try {
    execSync('bun backend/scripts/seed-stress-test.ts --tier small --clean', {
      cwd: rootDir,
      stdio: 'pipe',
      env: { ...process.env, SEED_ORG_ID: 'local-dev' },
    });
    console.log('  ✓ Postgres cleaned');
  } catch (e: any) {
    console.warn('  ⚠ Postgres cleanup failed:', e.message);
  }

  // ClickHouse data is managed via TTL — no manual cleanup needed

  console.log('✅ Global teardown complete');
}

export default globalTeardown;
