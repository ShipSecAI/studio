import { formatEnvErrors } from '@shipsec/shared';
import { frontendEnvSchema } from './env.schema';

export function validateFrontendEnv(
  env: Record<string, unknown>,
): ReturnType<typeof frontendEnvSchema.parse> {
  const result = frontendEnvSchema.safeParse(env);
  if (!result.success) {
    console.error('\n❌ Frontend environment validation failed:\n');
    console.error(formatEnvErrors(result.error));
    console.error('\nSee frontend/.env.example for reference.\n');
    throw new Error('Invalid frontend environment configuration');
  }
  return result.data;
}
