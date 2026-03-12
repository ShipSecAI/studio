import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

type RedisEnv = Partial<
  Pick<NodeJS.ProcessEnv, 'REDIS_URL' | 'TERMINAL_REDIS_URL' | 'SHIPSEC_ENV'>
>;
type RedisPing = (url: string) => Promise<void>;

function shouldRequireRedis(env: RedisEnv): boolean {
  const shipsecEnv = env.SHIPSEC_ENV?.trim().toLowerCase() ?? 'local';
  return shipsecEnv === 'prod' || shipsecEnv === 'staging';
}

export function resolveRedisStartupUrl(env: RedisEnv): string | null {
  return env.REDIS_URL ?? env.TERMINAL_REDIS_URL ?? null;
}

export async function verifyRedisAvailability(
  env: RedisEnv,
  pingRedis: RedisPing = pingRedisUrl,
): Promise<void> {
  const redisUrl = resolveRedisStartupUrl(env);

  if (!redisUrl) {
    if (shouldRequireRedis(env)) {
      throw new Error(
        'Redis is required in staging and production, but no Redis URL is configured',
      );
    }
    return;
  }

  await pingRedis(redisUrl);
}

async function pingRedisUrl(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });

  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

@Injectable()
export class RedisStartupGuardService implements OnModuleInit {
  private readonly logger = new Logger(RedisStartupGuardService.name);

  async onModuleInit(): Promise<void> {
    const env = {
      REDIS_URL: process.env.REDIS_URL,
      TERMINAL_REDIS_URL: process.env.TERMINAL_REDIS_URL,
      SHIPSEC_ENV: process.env.SHIPSEC_ENV,
    };

    try {
      await verifyRedisAvailability(env);
      const redisUrl = resolveRedisStartupUrl(env);
      if (redisUrl) {
        this.logger.log(`Redis startup check passed for ${redisUrl}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis startup check failed: ${message}`);
      throw error;
    }
  }
}
