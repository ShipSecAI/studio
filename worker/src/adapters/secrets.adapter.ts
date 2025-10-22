import { and, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ISecretsService } from '@shipsec/component-sdk';
import { SecretEncryption, parseMasterKey } from '@shipsec/shared';

import * as schema from './schema';

const FALLBACK_DEV_KEY = '0123456789abcdef0123456789abcdef';

export class SecretsAdapter implements ISecretsService {
  private readonly encryption: SecretEncryption;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {
    const rawKey = process.env.SECRET_STORE_MASTER_KEY ?? FALLBACK_DEV_KEY;
    this.encryption = new SecretEncryption(parseMasterKey(rawKey));
  }

  async get(
    key: string,
    options?: { version?: number },
  ): Promise<{ value: string; version: number } | null> {
    const conditions: SQL[] = [eq(schema.secretVersions.secretId, key)];

    if (typeof options?.version === 'number') {
      conditions.push(eq(schema.secretVersions.version, options.version));
    } else {
      conditions.push(eq(schema.secretVersions.isActive, true));
    }

    const [record] = await this.db
      .select({
        encryptedValue: schema.secretVersions.encryptedValue,
        iv: schema.secretVersions.iv,
        authTag: schema.secretVersions.authTag,
        keyId: schema.secretVersions.encryptionKeyId,
        versionNumber: schema.secretVersions.version,
      })
      .from(schema.secretVersions)
      .where(and(...conditions))
      .limit(1);

    if (!record) {
      return null;
    }

    try {
      const value = await this.encryption.decrypt({
        ciphertext: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
        keyId: record.keyId,
      });

      return { value, version: options?.version ?? record.versionNumber };
    } catch (error) {
      throw new Error(`Failed to decrypt secret '${key}': ${(error as Error).message}`);
    }
  }

  async list(): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.secrets.name })
      .from(schema.secrets)
      .orderBy(schema.secrets.name);
    return rows.map((row) => row.name);
  }
}
