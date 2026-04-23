import { registerAs } from '@nestjs/config';

export interface LocalAuthConfig {
  adminUsername: string | null;
  adminPassword: string | null;
}

export interface AuthConfig {
  local: LocalAuthConfig;
}

export const authConfig = registerAs<AuthConfig>('auth', () => {
  return {
    local: {
      // Default test credentials (override with env vars in production)
      adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
      adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
    },
  };
});
