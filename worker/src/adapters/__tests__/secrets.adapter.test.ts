import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SecretEncryption, parseMasterKey } from '@shipsec/shared';
import { SecretsAdapter } from '../secrets.adapter';
import * as schema from '../schema';

const TEST_MASTER_KEY = '00112233445566778899aabbccddeeff';

interface VersionRow {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyId: string;
  versionNumber: number;
}

interface SecretsDbStubConfig {
  versions?: VersionRow[];
  list?: { name: string }[];
}

function createDbStub(config: SecretsDbStubConfig): NodePgDatabase<typeof schema> {
  return {
    select(selection: Record<string, unknown>) {
      if ('name' in selection) {
        return {
          from() {
            return {
              orderBy() {
                return Promise.resolve(config.list ?? []);
              },
            };
          },
        };
      }

      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(config.versions ?? []);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as NodePgDatabase<typeof schema>;
}

describe('SecretsAdapter', () => {
  let originalMasterKey: string | undefined;

  beforeEach(() => {
    originalMasterKey = process.env.SECRET_STORE_MASTER_KEY;
    process.env.SECRET_STORE_MASTER_KEY = TEST_MASTER_KEY;
  });

  afterEach(() => {
    if (originalMasterKey === undefined) {
      delete process.env.SECRET_STORE_MASTER_KEY;
    } else {
      process.env.SECRET_STORE_MASTER_KEY = originalMasterKey;
    }
  });

  it('decrypts the active secret version when no override is provided', async () => {
    const encryption = new SecretEncryption(parseMasterKey(TEST_MASTER_KEY));
    const encrypted = await encryption.encrypt('super-secret');

    const db = createDbStub({
      versions: [
        {
          encryptedValue: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          versionNumber: 2,
        },
      ],
    });

    const adapter = new SecretsAdapter(db);
    const secret = await adapter.get('api-token');

    expect(secret).toEqual({ value: 'super-secret', version: 2 });
  });

  it('uses the requested version when provided', async () => {
    const encryption = new SecretEncryption(parseMasterKey(TEST_MASTER_KEY));
    const encrypted = await encryption.encrypt('older-secret');

    const db = createDbStub({
      versions: [
        {
          encryptedValue: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          versionNumber: 1,
        },
      ],
    });

    const adapter = new SecretsAdapter(db);
    const secret = await adapter.get('api-token', { version: 1 });

    expect(secret).toEqual({ value: 'older-secret', version: 1 });
  });

  it('returns null when the secret does not exist', async () => {
    const db = createDbStub({ versions: [] });
    const adapter = new SecretsAdapter(db);

    await expect(adapter.get('missing-secret')).resolves.toBeNull();
  });

  it('lists secret identifiers in the expected order', async () => {
    const db = createDbStub({
      list: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
    });

    const adapter = new SecretsAdapter(db);
    await expect(adapter.list()).resolves.toEqual(['alpha', 'beta', 'gamma']);
  });
});
