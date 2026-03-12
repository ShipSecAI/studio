import { describe, expect, it, mock } from 'bun:test';
import { resolveRedisStartupUrl, verifyRedisAvailability } from '../redis-startup-guard.service';

describe('resolveRedisStartupUrl', () => {
  it('prefers REDIS_URL over TERMINAL_REDIS_URL', () => {
    expect(
      resolveRedisStartupUrl({
        REDIS_URL: 'redis://primary:6379',
        TERMINAL_REDIS_URL: 'redis://terminal:6379',
      }),
    ).toBe('redis://primary:6379');
  });

  it('falls back to TERMINAL_REDIS_URL when REDIS_URL is missing', () => {
    expect(
      resolveRedisStartupUrl({
        TERMINAL_REDIS_URL: 'redis://terminal:6379',
      }),
    ).toBe('redis://terminal:6379');
  });
});

describe('verifyRedisAvailability', () => {
  it('skips Redis checks for local envs without a Redis URL', async () => {
    const pingRedis = mock(async () => {});

    await expect(
      verifyRedisAvailability(
        {
          SHIPSEC_ENV: 'local',
        },
        pingRedis,
      ),
    ).resolves.toBeUndefined();

    expect(pingRedis).not.toHaveBeenCalled();
  });

  it('fails fast in prod when no Redis URL is configured', async () => {
    const pingRedis = mock(async () => {});

    await expect(
      verifyRedisAvailability(
        {
          SHIPSEC_ENV: 'prod',
        },
        pingRedis,
      ),
    ).rejects.toThrow('Redis is required in staging and production');
  });

  it('pings the configured Redis URL', async () => {
    const pingRedis = mock(async (_redisUrl: string) => {});

    await expect(
      verifyRedisAvailability(
        {
          SHIPSEC_ENV: 'staging',
          REDIS_URL: 'redis://shipsec-managed-redis.shipsec-staging.svc.cluster.local:6379/1',
        },
        pingRedis,
      ),
    ).resolves.toBeUndefined();

    expect(pingRedis).toHaveBeenCalledWith(
      'redis://shipsec-managed-redis.shipsec-staging.svc.cluster.local:6379/1',
    );
  });

  it('surfaces connectivity failures', async () => {
    const pingRedis = mock(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(
      verifyRedisAvailability(
        {
          SHIPSEC_ENV: 'prod',
          REDIS_URL: 'redis://shipsec-managed-redis.shipsec-system.svc.cluster.local:6379',
        },
        pingRedis,
      ),
    ).rejects.toThrow('connect ECONNREFUSED');
  });
});
