import { describe, it, expect } from 'bun:test';
import { backendEnvSchema } from '../env.schema';

/** Minimal valid backend env config */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
    LOG_KAFKA_BROKERS: 'localhost:9092',
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'my-app',
    GITHUB_APP_PRIVATE_KEY: 'test-private-key',
    GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
    GITHUB_APP_CLIENT_ID: 'test-client-id',
    GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
    SLACK_OAUTH_CLIENT_ID: 'test-slack-client-id',
    SLACK_OAUTH_CLIENT_SECRET: 'test-slack-client-secret',
    SHIPSEC_PLATFORM_ROLE_ARN: 'arn:aws:iam::123456789012:role/test-role',
    ...overrides,
  };
}

describe('backendEnvSchema', () => {
  it('accepts a valid full config', () => {
    const result = backendEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });

  it('fails when DATABASE_URL is missing (normal mode)', () => {
    const { DATABASE_URL, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('passes when SKIP_INGEST_SERVICES=true without DATABASE_URL and LOG_KAFKA_BROKERS', () => {
    const { DATABASE_URL, LOG_KAFKA_BROKERS, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse({
      ...rest,
      SKIP_INGEST_SERVICES: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('passes when ENABLE_INGEST_SERVICES=false without DATABASE_URL and LOG_KAFKA_BROKERS', () => {
    const { DATABASE_URL, LOG_KAFKA_BROKERS, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse({
      ...rest,
      ENABLE_INGEST_SERVICES: 'false',
    });
    expect(result.success).toBe(true);
  });

  it('fails when AUTH_PROVIDER=clerk without CLERK keys', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: 'clerk' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('CLERK_SECRET_KEY');
      expect(paths).toContain('CLERK_PUBLISHABLE_KEY');
    }
  });

  it('passes when AUTH_PROVIDER=clerk with both CLERK keys', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        AUTH_PROVIDER: 'clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('normalizes " LOCAL " to "local"', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: ' LOCAL ' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('local');
    }
  });

  it('falls back unknown AUTH_PROVIDER to "local"', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: 'weird' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('local');
    }
  });

  it('normalizes "Clerk" to "clerk"', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        AUTH_PROVIDER: 'Clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('clerk');
    }
  });

  it('fails when required GitHub App fields are missing', () => {
    const { GITHUB_APP_ID, GITHUB_APP_SLUG, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('GITHUB_APP_ID');
      expect(paths).toContain('GITHUB_APP_SLUG');
    }
  });

  it('fails when required Slack OAuth fields are missing', () => {
    const { SLACK_OAUTH_CLIENT_ID, SLACK_OAUTH_CLIENT_SECRET, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('SLACK_OAUTH_CLIENT_ID');
      expect(paths).toContain('SLACK_OAUTH_CLIENT_SECRET');
    }
  });

  it('fails when SHIPSEC_PLATFORM_ROLE_ARN is missing', () => {
    const { SHIPSEC_PLATFORM_ROLE_ARN, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('SHIPSEC_PLATFORM_ROLE_ARN');
    }
  });

  it('coerces PORT string to number', () => {
    const result = backendEnvSchema.safeParse(validEnv({ PORT: '3211' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3211);
    }
  });

  it('defaults PORT to 3211', () => {
    const result = backendEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3211);
    }
  });
});
