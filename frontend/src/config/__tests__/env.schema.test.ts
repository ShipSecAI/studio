import { describe, it, expect } from 'bun:test';
import { frontendEnvSchema } from '../env.schema';

describe('frontendEnvSchema', () => {
  it('accepts a valid config', () => {
    const result = frontendEnvSchema.safeParse({
      VITE_API_URL: 'http://localhost:3211',
      VITE_ENABLE_CONNECTIONS: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('empty object passes and VITE_API_URL defaults to http://localhost:3211', () => {
    const result = frontendEnvSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_API_URL).toBe('http://localhost:3211');
    }
  });

  it('VITE_API_URL=undefined defaults to http://localhost:3211', () => {
    const result = frontendEnvSchema.safeParse({ VITE_API_URL: undefined });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_API_URL).toBe('http://localhost:3211');
    }
  });

  it('VITE_ENABLE_CONNECTIONS="false" → false (not truthy)', () => {
    const result = frontendEnvSchema.safeParse({ VITE_ENABLE_CONNECTIONS: 'false' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_ENABLE_CONNECTIONS).toBe(false);
    }
  });

  it('VITE_ENABLE_CONNECTIONS=undefined → false', () => {
    const result = frontendEnvSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_ENABLE_CONNECTIONS).toBe(false);
    }
  });

  it('VITE_DISABLE_ANALYTICS="true" → true', () => {
    const result = frontendEnvSchema.safeParse({ VITE_DISABLE_ANALYTICS: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_DISABLE_ANALYTICS).toBe(true);
    }
  });

  it('all optional vars get defaults', () => {
    const result = frontendEnvSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VITE_FRONTEND_BRANCH).toBe('');
      expect(result.data.VITE_BACKEND_BRANCH).toBe('');
      expect(result.data.VITE_GIT_SHA).toBe('');
      expect(result.data.VITE_LOGO_DEV_PUBLIC_KEY).toBe('');
      expect(result.data.VITE_OPENSEARCH_DASHBOARDS_URL).toBe('');
      expect(result.data.VITE_ENABLE_IT_OPS).toBe(false);
    }
  });

  it('fails when VITE_AUTH_PROVIDER=clerk without VITE_CLERK_PUBLISHABLE_KEY', () => {
    const result = frontendEnvSchema.safeParse({ VITE_AUTH_PROVIDER: 'clerk' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    }
  });

  it('passes when VITE_AUTH_PROVIDER=clerk with VITE_CLERK_PUBLISHABLE_KEY', () => {
    const result = frontendEnvSchema.safeParse({
      VITE_AUTH_PROVIDER: 'clerk',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
    });
    expect(result.success).toBe(true);
  });
});
