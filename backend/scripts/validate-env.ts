/**
 * Pre-flight environment validation script.
 * Called by `just dev` before starting PM2 to surface config errors early.
 * Exits 1 with a clear error if validation fails.
 */
import { formatEnvErrors } from '@shipsec/shared';
import { backendEnvSchema } from '../src/config/env.schema';

const result = backendEnvSchema.safeParse(process.env);

if (!result.success) {
  console.error('\n❌ Backend environment validation failed:\n');
  console.error(formatEnvErrors(result.error));
  console.error('\nSee backend/.env.example for reference.\n');
  process.exit(1);
}

console.log('✅  Backend .env OK');
