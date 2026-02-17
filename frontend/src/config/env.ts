import { frontendEnvSchema } from './env.schema';

const result = frontendEnvSchema.safeParse(import.meta.env);
if (!result.success) {
  const msg = '❌ Frontend env validation failed';
  console.error(msg, result.error.issues);
  throw new Error(msg);
}
export const env = result.data;
