import { ISecretsService } from '@shipsec/component-sdk';

export interface SecretsAdapterOptions {
  /**
   * Initial secrets provided at construction time.
   * Keys are normalized to lower-case internally.
   */
  initial?: Record<string, string>;
  /**
   * Optional async loader invoked when a secret is not present in the cache.
   */
  loader?: (key: string) => Promise<string | null>;
  /**
   * Optional async provider to enumerate known secret keys.
   */
  listLoader?: () => Promise<string[]>;
  /**
   * When true (default), secrets are discoverable from process.env using the provided prefix.
   */
  allowEnv?: boolean;
  /**
   * Environment variable prefix used when allowEnv is enabled. Defaults to `SHIPSEC_SECRET_`.
   */
  envPrefix?: string;
}

/**
 * Secrets adapter that caches lookups and deduplicates concurrent reads so activity retries remain idempotent.
 * Secrets are treated as immutable; repeated reads never mutate or remove the underlying value.
 */
export class SecretsAdapter implements ISecretsService {
  private readonly cache = new Map<string, string>();
  private readonly missing = new Set<string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly initialKeys = new Set<string>();
  private readonly loader?: (key: string) => Promise<string | null>;
  private readonly listLoader?: () => Promise<string[]>;
  private readonly allowEnv: boolean;
  private readonly envPrefix: string;

  constructor(options: SecretsAdapterOptions = {}) {
    this.loader = options.loader;
    this.listLoader = options.listLoader;
    this.allowEnv = options.allowEnv ?? true;
    this.envPrefix = options.envPrefix ?? 'SHIPSEC_SECRET_';

    const initial = options.initial ?? {};
    for (const [key, value] of Object.entries(initial)) {
      const normalizedKey = this.normalizeKey(key);
      this.cache.set(normalizedKey, value);
      this.initialKeys.add(normalizedKey);
    }

    if (this.allowEnv) {
      for (const [envKey, value] of Object.entries(process.env)) {
        if (value === undefined || value === null) {
          continue;
        }
        if (!envKey.startsWith(this.envPrefix)) {
          continue;
        }
        const normalizedKey = this.normalizeKey(envKey.slice(this.envPrefix.length));
        if (!this.cache.has(normalizedKey)) {
          this.cache.set(normalizedKey, value);
        }
        this.initialKeys.add(normalizedKey);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const normalizedKey = this.normalizeKey(key);

    if (this.cache.has(normalizedKey)) {
      return this.cache.get(normalizedKey) ?? null;
    }

    if (this.missing.has(normalizedKey)) {
      return null;
    }

    if (this.pending.has(normalizedKey)) {
      return this.pending.get(normalizedKey)!;
    }

    const fetchPromise = this.fetchAndCache(normalizedKey);
    this.pending.set(normalizedKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.pending.delete(normalizedKey);
    }
  }

  async list(): Promise<string[]> {
    const keys = new Set<string>([...this.initialKeys, ...this.cache.keys()]);

    if (this.listLoader) {
      try {
        const loaderKeys = await this.listLoader();
        loaderKeys.forEach((key) => keys.add(this.normalizeKey(key)));
      } catch (error) {
        // Listing is a best-effort operation; log and continue.
        console.warn('[SecretsAdapter] listLoader failed', error);
      }
    }

    return Array.from(keys).sort();
  }

  private async fetchAndCache(normalizedKey: string): Promise<string | null> {
    if (this.allowEnv) {
      const envValue = this.readFromEnv(normalizedKey);
      if (envValue !== undefined) {
        this.cache.set(normalizedKey, envValue);
        return envValue;
      }
    }

    if (!this.loader) {
      this.missing.add(normalizedKey);
      return null;
    }

    try {
      const value = await this.loader(normalizedKey);
      if (value !== null && value !== undefined) {
        this.cache.set(normalizedKey, value);
        return value;
      }
      this.missing.add(normalizedKey);
      return null;
    } catch (error) {
      this.missing.add(normalizedKey);
      throw error;
    }
  }

  private readFromEnv(normalizedKey: string): string | undefined {
    const envKey = `${this.envPrefix}${normalizedKey.toUpperCase()}`;
    return process.env[envKey];
  }

  private normalizeKey(key: string): string {
    return key.trim().toLowerCase();
  }
}
