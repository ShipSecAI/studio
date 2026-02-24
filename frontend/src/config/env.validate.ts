import { z } from 'zod';
import { frontendEnvSchema } from './env.schema';

function formatFrontendEnvErrors(error: z.ZodError): string {
  const rows = error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`);
  return rows.join('\n');
}

export function validateFrontendEnv(
  env: Record<string, unknown>,
): z.infer<typeof frontendEnvSchema> {
  const result = frontendEnvSchema.safeParse(env);
  if (!result.success) {
    console.error('\n❌ Frontend environment validation failed:\n');
    console.error(formatFrontendEnvErrors(result.error));
    console.error('\nSee frontend/.env.example for reference.\n');
    throw new Error('Invalid frontend environment configuration');
  }
  return result.data;
}
