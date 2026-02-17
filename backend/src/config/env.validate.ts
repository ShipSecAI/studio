import { formatEnvErrors } from '@shipsec/shared';
import { backendEnvSchema, type BackendEnvConfig } from './env.schema';

export function validateBackendEnv(config: Record<string, unknown>): BackendEnvConfig {
  const result = backendEnvSchema.safeParse(config);
  if (!result.success) {
    console.error('\n❌ Backend environment validation failed:\n');
    console.error(formatEnvErrors(result.error));
    console.error('\nSee backend/.env.example for reference.\n');
    throw new Error('Invalid backend environment configuration');
  }
  return result.data;
}
