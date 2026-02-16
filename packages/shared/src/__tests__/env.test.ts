import { describe, it, expect } from 'bun:test';
import {
  databaseUrlSchema,
  secretStoreKeySchema,
  kafkaBrokersSchema,
  minioConfigSchema,
  stringToBoolean,
  formatEnvErrors,
} from '../env.js';
import { z } from 'zod';

describe('databaseUrlSchema', () => {
  it('accepts a valid postgresql URL', () => {
    const result = databaseUrlSchema.safeParse('postgresql://user:pass@localhost:5432/db');
    expect(result.success).toBe(true);
  });

  it('rejects a non-postgresql URL', () => {
    const result = databaseUrlSchema.safeParse('mysql://user:pass@localhost/db');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = databaseUrlSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('secretStoreKeySchema', () => {
  it('accepts exactly 32 characters', () => {
    const result = secretStoreKeySchema.safeParse('a'.repeat(32));
    expect(result.success).toBe(true);
  });

  it('rejects 31 characters', () => {
    const result = secretStoreKeySchema.safeParse('a'.repeat(31));
    expect(result.success).toBe(false);
  });

  it('rejects 33 characters', () => {
    const result = secretStoreKeySchema.safeParse('a'.repeat(33));
    expect(result.success).toBe(false);
  });
});

describe('kafkaBrokersSchema', () => {
  it('parses comma-separated brokers', () => {
    const result = kafkaBrokersSchema.safeParse('a,b,c');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['a', 'b', 'c']);
    }
  });

  it('trims whitespace around brokers', () => {
    const result = kafkaBrokersSchema.safeParse(' host1:9092 , host2:9092 ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['host1:9092', 'host2:9092']);
    }
  });

  it('rejects an empty string', () => {
    const result = kafkaBrokersSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('minioConfigSchema', () => {
  it('coerces MINIO_PORT string to number', () => {
    const result = minioConfigSchema.safeParse({ MINIO_PORT: '9000' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_PORT).toBe(9000);
    }
  });

  it('defaults MINIO_ENDPOINT to localhost', () => {
    const result = minioConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_ENDPOINT).toBe('localhost');
    }
  });

  it('parses MINIO_USE_SSL=true as boolean true', () => {
    const result = minioConfigSchema.safeParse({ MINIO_USE_SSL: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_USE_SSL).toBe(true);
    }
  });

  it('parses MINIO_USE_SSL=false as boolean false', () => {
    const result = minioConfigSchema.safeParse({ MINIO_USE_SSL: 'false' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_USE_SSL).toBe(false);
    }
  });
});

describe('stringToBoolean', () => {
  const schema = stringToBoolean();

  it('"true" → true', () => {
    expect(schema.parse('true')).toBe(true);
  });

  it('"false" → false', () => {
    expect(schema.parse('false')).toBe(false);
  });

  it('empty string → false (default)', () => {
    expect(schema.parse('')).toBe(false);
  });

  it('undefined → false (default)', () => {
    expect(schema.parse(undefined)).toBe(false);
  });

  it('respects custom default of true', () => {
    const trueDefault = stringToBoolean(true);
    expect(trueDefault.parse(undefined)).toBe(true);
  });
});

describe('formatEnvErrors', () => {
  it('produces human-readable output', () => {
    const testSchema = z.object({
      FOO: z.string({ error: 'FOO is required' }),
      BAR: z.number({ error: 'BAR must be a number' }),
    });
    const result = testSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const output = formatEnvErrors(result.error);
      expect(output).toContain('Variable');
      expect(output).toContain('Error');
      expect(output).toContain('FOO');
      expect(output).toContain('BAR');
    }
  });
});
