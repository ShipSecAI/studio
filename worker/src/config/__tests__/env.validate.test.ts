import { describe, it, expect } from 'bun:test';
import { workerEnvSchema } from '../env.schema';

/** Minimal valid worker env config */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
    LOG_KAFKA_BROKERS: 'localhost:9092',
    ...overrides,
  };
}

describe('workerEnvSchema', () => {
  it('accepts a valid config', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });

  it('fails when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('fails when SECRET_STORE_MASTER_KEY is missing', () => {
    const { SECRET_STORE_MASTER_KEY, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('fails when LOG_KAFKA_BROKERS is missing', () => {
    const { LOG_KAFKA_BROKERS, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('defaults MINIO_ENDPOINT to localhost', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_ENDPOINT).toBe('localhost');
    }
  });

  it('defaults BACKEND_URL to http://localhost:3211', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.BACKEND_URL).toBe('http://localhost:3211');
    }
  });

  it('parses LOG_KAFKA_BROKERS into array', () => {
    const result = workerEnvSchema.safeParse(validEnv({ LOG_KAFKA_BROKERS: 'a:9092,b:9092' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOG_KAFKA_BROKERS).toEqual(['a:9092', 'b:9092']);
    }
  });
});
