import { formatEnvErrors } from '@shipsec/shared';
import { workerEnvSchema, type WorkerEnvConfig } from './env.schema';

export function validateWorkerEnv(env: Record<string, unknown>): WorkerEnvConfig {
  const result = workerEnvSchema.safeParse(env);
  if (!result.success) {
    console.error('\n❌ Worker environment validation failed:\n');
    console.error(formatEnvErrors(result.error));
    console.error('\nSee worker/.env.example for reference.\n');
    throw new Error('Invalid worker environment configuration');
  }
  return result.data;
}
