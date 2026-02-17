import { z } from 'zod';

/**
 * Explicit string→boolean for VITE_* flags.
 * Accepts 'true', 'false', '', or undefined. Never uses z.coerce.boolean().
 */
function viteBoolean(defaultValue = false) {
  return z
    .enum(['true', 'false', ''])
    .optional()
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');
}

export const frontendEnvSchema = z
  .object({
    // API URL — defaults to localhost for dev/test compatibility
    VITE_API_URL: z.string().optional().default('http://localhost:3211'),

    // Application metadata
    VITE_APP_NAME: z.string().optional().default(''),
    VITE_APP_VERSION: z.string().optional().default(''),
    VITE_FRONTEND_BRANCH: z.string().optional().default(''),
    VITE_BACKEND_BRANCH: z.string().optional().default(''),
    VITE_GIT_SHA: z.string().optional().default(''),

    // Feature flags
    VITE_ENABLE_CONNECTIONS: viteBoolean(false),
    VITE_ENABLE_IT_OPS: viteBoolean(false),
    VITE_DISABLE_ANALYTICS: viteBoolean(false),

    // Third-party integrations
    VITE_LOGO_DEV_PUBLIC_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_HOST: z.string().optional().default(''),
    VITE_OPENSEARCH_DASHBOARDS_URL: z.string().optional().default(''),

    // Auth
    VITE_AUTH_PROVIDER: z.string().optional().default(''),
    VITE_CLERK_PUBLISHABLE_KEY: z.string().optional().default(''),
    VITE_CLERK_JWT_TEMPLATE: z.string().optional().default(''),
    VITE_API_AUTH_PROVIDER: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    // If auth provider is clerk, VITE_CLERK_PUBLISHABLE_KEY is required
    const provider = data.VITE_AUTH_PROVIDER.trim().toLowerCase();
    if (provider === 'clerk' && !data.VITE_CLERK_PUBLISHABLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VITE_CLERK_PUBLISHABLE_KEY'],
        message: 'VITE_CLERK_PUBLISHABLE_KEY is required when VITE_AUTH_PROVIDER=clerk',
      });
    }
  });

export type FrontendEnvConfig = z.infer<typeof frontendEnvSchema>;
