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
    // API URL — empty means relative paths (/api/v1/…), proxied by Vite dev-server or Nginx
    VITE_API_URL: z.string().optional().default(''),
    // App URL — defaults to current origin
    VITE_APP_URL: z.string().optional().default(''),

    // Application metadata
    VITE_APP_NAME: z.string().optional().default(''),
    VITE_APP_VERSION: z.string().optional().default(''),
    VITE_FRONTEND_BRANCH: z.string().optional().default(''),
    VITE_BACKEND_BRANCH: z.string().optional().default(''),
    VITE_GIT_SHA: z.string().optional().default(''),

    // Feature flags (legacy)
    VITE_ENABLE_IT_OPS: viteBoolean(false),
    VITE_ENABLE_DEVTOOLS: viteBoolean(false),
    VITE_DISABLE_ANALYTICS: viteBoolean(false),

    // Build-time feature flags — set to 'false' to hard-disable whole feature families
    VITE_FF_WORKFLOWS: viteBoolean(true),
    VITE_FF_AI_AGENT: viteBoolean(true),
    VITE_FF_GITHUB: viteBoolean(true),
    VITE_FF_CLOUD: viteBoolean(true),
    VITE_FF_ASM: viteBoolean(true),

    // Third-party integrations
    VITE_LOGO_DEV_PUBLIC_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_HOST: z.string().optional().default(''),
    // Analytics URL (shows analytics link in sidebar)
    VITE_ANALYTICS_URL: z.string().optional().default(''),

    // Auth
    VITE_AUTH_PROVIDER: z.string().optional().default(''),
    VITE_API_AUTH_PROVIDER: z.string().optional().default(''),
    VITE_CLOUD_EXTENSION_PACKAGE: z.string().optional().default(''),

    // Dev defaults
    VITE_DEFAULT_ORG: z.string().optional().default(''),
    VITE_DEFAULT_USER_ID: z.string().optional().default(''),
  })
  .superRefine(() => {});

export type FrontendEnvConfig = z.infer<typeof frontendEnvSchema>;
