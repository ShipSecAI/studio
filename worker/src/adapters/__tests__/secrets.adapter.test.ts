import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SecretsAdapter } from '../secrets.adapter';

describe('SecretsAdapter', () => {
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    originalEnvToken = process.env.SHIPSEC_SECRET_API_TOKEN;
    process.env.SHIPSEC_SECRET_API_TOKEN = 'env-token';
  });

  afterEach(() => {
    if (originalEnvToken === undefined) {
      delete process.env.SHIPSEC_SECRET_API_TOKEN;
    } else {
      process.env.SHIPSEC_SECRET_API_TOKEN = originalEnvToken;
    }
  });

  it('returns initial secrets without hitting loader', async () => {
    const adapter = new SecretsAdapter({
      initial: { api_key: 'initial-key' },
      loader: async () => {
        throw new Error('loader should not be called');
      },
    });

    await expect(adapter.get('api_key')).resolves.toBe('initial-key');
    await expect(adapter.get('API_KEY')).resolves.toBe('initial-key'); // verify normalization
  });

  it('deduplicates concurrent get operations', async () => {
    let loadCount = 0;
    const adapter = new SecretsAdapter({
      loader: async (key) => {
        loadCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `value-${key}`;
      },
      allowEnv: false,
    });

    const [first, second] = await Promise.all([
      adapter.get('service-token'),
      adapter.get('service-token'),
    ]);

    expect(first).toBe('value-service-token');
    expect(second).toBe('value-service-token');
    expect(loadCount).toBe(1);
  });

  it('caches missing lookups to avoid repeated loader calls', async () => {
    let loadCount = 0;
    const adapter = new SecretsAdapter({
      loader: async () => {
        loadCount += 1;
        return null;
      },
      allowEnv: false,
    });

    await expect(adapter.get('missing')).resolves.toBeNull();
    await expect(adapter.get('missing')).resolves.toBeNull();
    expect(loadCount).toBe(1);
  });

  it('prefers environment secrets when available', async () => {
    const adapter = new SecretsAdapter();
    await expect(adapter.get('api_token')).resolves.toBe('env-token');
  });

  it('list includes initial, env, and loaded keys', async () => {
    const adapter = new SecretsAdapter({
      initial: { initial_key: 'value' },
      listLoader: async () => ['dynamic_key'],
    });

    await adapter.get('dynamic_key');
    const keys = await adapter.list();
    expect(keys).toContain('initial_key');
    expect(keys).toContain('api_token');
    expect(keys).toContain('dynamic_key');
  });
});
