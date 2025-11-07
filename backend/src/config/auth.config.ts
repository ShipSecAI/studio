import { registerAs } from '@nestjs/config';

export type AuthProvider = 'local' | 'clerk';

export interface LocalAuthConfig {
  adminUsername: string | null;
  adminPassword: string | null;
}

export interface ClerkAuthConfig {
  publishableKey: string | null;
  secretKey: string | null;
}

export interface AuthConfig {
  provider: AuthProvider;
  local: LocalAuthConfig;
  clerk: ClerkAuthConfig;
}

function normalizeProvider(raw: string | undefined): AuthProvider {
  if (!raw) {
    return 'local';
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'clerk' ? 'clerk' : 'local';
}

export const authConfig = registerAs<AuthConfig>('auth', () => {
  const provider = normalizeProvider(process.env.AUTH_PROVIDER);

  return {
    provider,
    local: {
      // Default test credentials (override with env vars in production)
      adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
      adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
    },
    clerk: {
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? null,
      secretKey: process.env.CLERK_SECRET_KEY ?? null,
    },
  };
});
