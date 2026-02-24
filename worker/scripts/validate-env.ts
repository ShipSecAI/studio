/**
 * Pre-flight environment validation script.
 * Called by `just dev` before starting PM2 to surface config errors early.
 * Exits 1 with a clear error if validation fails.
 */
import { formatEnvErrors } from '@shipsec/shared';
import { workerEnvSchema } from '../src/config/env.schema';

const result = workerEnvSchema.safeParse(process.env);

if (!result.success) {
  console.error('\n❌ Worker environment validation failed:\n');
  console.error(formatEnvErrors(result.error));
  console.error('\nSee worker/.env.example for reference.\n');
  process.exit(1);
}

console.log('✅  Worker environment OK');
