/**
 * Pre-flight environment validation script.
 * Called by `just dev` before starting PM2 to surface config errors early.
 * Exits 1 with a clear error if validation fails.
 */
import { validateFrontendEnv } from '../src/config/env.validate';

try {
  validateFrontendEnv(process.env as Record<string, unknown>);
  console.log('✅  Frontend environment OK');
} catch {
  process.exit(1);
}
