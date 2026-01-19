import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { SecretsService } from '../secrets.service';
import type { SecretsRepository, SecretSummary, SecretValueRecord } from '../secrets.repository';
import type { SecretsEncryptionService } from '../secrets.encryption';
import type { AuthContext } from '../../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';

const sampleSummary: SecretSummary = {
  id: 'secret-1',
  name: 'database-password',
  description: 'Primary database credentials',
  tags: ['prod'],
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  activeVersion: {
    id: 'version-1',
    version: 1,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    createdBy: 'alice@example.com',
  },
};

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('SecretsService', () => {
  let repository: {
    listSecrets: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
    createSecret: ReturnType<typeof vi.fn>;
    rotateSecret: ReturnType<typeof vi.fn>;
    findValueBySecretId: ReturnType<typeof vi.fn>;
    updateSecret: ReturnType<typeof vi.fn>;
    deleteSecret: ReturnType<typeof vi.fn>;
  };
  let encryption: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  };
  let service: SecretsService;

  beforeEach(() => {
    repository = {
      listSecrets: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn(),
      createSecret: vi.fn(),
      rotateSecret: vi.fn(),
      findValueBySecretId: vi.fn(),
      updateSecret: vi.fn(),
      deleteSecret: vi.fn(),
    };

    encryption = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    };

    service = new SecretsService(
      repository as unknown as SecretsRepository,
      encryption as unknown as SecretsEncryptionService,
    );
  });

  it('lists secrets via the repository', async () => {
    repository.listSecrets.mockResolvedValue([sampleSummary]);

    const result = await service.listSecrets(authContext);

    expect(result).toEqual([sampleSummary]);
    expect(repository.listSecrets).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('returns a single secret via the repository', async () => {
    repository.findById.mockResolvedValue(sampleSummary);

    const result = await service.getSecret(authContext, 'secret-1');

    expect(result).toBe(sampleSummary);
    expect(repository.findById).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('encrypts and stores a new secret with optional metadata', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.createSecret.mockResolvedValue(sampleSummary);

    const result = await service.createSecret(authContext, {
      name: 'database-password',
      description: 'Primary database credentials',
      tags: ['prod'],
      value: 'super-secret-value',
      createdBy: 'alice@example.com',
    });

    expect(result).toBe(sampleSummary);
    expect(encryption.encrypt).toHaveBeenCalledWith('super-secret-value');
    expect(repository.createSecret).toHaveBeenCalledWith(
      {
        name: 'database-password',
        description: 'Primary database credentials',
        tags: ['prod'],
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      {
        encryptedValue: 'ciphertext',
        iv: 'iv',
        authTag: 'tag',
        encryptionKeyId: 'master-key',
        createdBy: 'alice@example.com',
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
    );
  });

  it('fills optional fields with nulls when creating a secret', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.createSecret.mockResolvedValue(sampleSummary);

    await service.createSecret(authContext, { name: 'api-key', value: 'value' });

    expect(repository.createSecret).toHaveBeenCalledWith(
      {
        name: 'api-key',
        description: null,
        tags: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      expect.objectContaining({
        createdBy: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      }),
    );
  });

  it('rotates a secret using encrypted material', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'newcipher',
      iv: 'newiv',
      authTag: 'newtag',
      keyId: 'master-key',
    });
    repository.rotateSecret.mockResolvedValue(sampleSummary);

    const result = await service.rotateSecret(authContext, 'secret-1', {
      value: 'another-secret',
      createdBy: 'bob@example.com',
    });

    expect(result).toBe(sampleSummary);
    expect(encryption.encrypt).toHaveBeenCalledWith('another-secret');
    expect(repository.rotateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        encryptedValue: 'newcipher',
        iv: 'newiv',
        authTag: 'newtag',
        encryptionKeyId: 'master-key',
        createdBy: 'bob@example.com',
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('defaults rotate metadata when not provided', async () => {
    encryption.encrypt.mockResolvedValue({
      ciphertext: 'cipher',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    repository.rotateSecret.mockResolvedValue(sampleSummary);

    await service.rotateSecret(authContext, 'secret-1', { value: 'value' });

    expect(repository.rotateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        encryptedValue: 'cipher',
        iv: 'iv',
        authTag: 'tag',
        encryptionKeyId: 'master-key',
        createdBy: null,
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('decrypts secret values returned from the repository', async () => {
    const record: SecretValueRecord = {
      secretId: 'secret-1',
      version: 2,
      encryptedValue: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      encryptionKeyId: 'master-key',
    };
    repository.findValueBySecretId.mockResolvedValue(record);
    encryption.decrypt.mockResolvedValue('decrypted-value');

    const result = await service.getSecretValue(authContext, 'secret-1');

    expect(repository.findValueBySecretId).toHaveBeenCalledWith('secret-1', undefined, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(encryption.decrypt).toHaveBeenCalledWith({
      ciphertext: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'master-key',
    });
    expect(result).toEqual({
      secretId: 'secret-1',
      version: 2,
      value: 'decrypted-value',
    });
  });

  it('requests a specific version when provided', async () => {
    repository.findByName.mockResolvedValue(sampleSummary);
    repository.findValueBySecretId.mockResolvedValue({
      secretId: 'secret-1',
      version: 2,
      encryptedValue: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      encryptionKeyId: 'master-key',
    });
    encryption.decrypt.mockResolvedValue('value');

    const result = await service.getSecretValueByName(authContext, 'database-password', 2);

    expect(repository.findByName).toHaveBeenCalledWith('database-password', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(repository.findValueBySecretId).toHaveBeenCalledWith('secret-1', 2, {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(result.value).toBe('value');
  });

  it('normalizes and forwards update payload to the repository', async () => {
    repository.findById.mockResolvedValue(sampleSummary);
    repository.updateSecret.mockResolvedValue(sampleSummary);

    const result = await service.updateSecret(authContext, 'secret-1', {
      name: '  db-password  ',
      description: 'Primary DB password',
      tags: ['  prod  ', '  critical '],
    });

    expect(repository.updateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        name: 'db-password',
        description: 'Primary DB password',
        tags: ['prod', 'critical'],
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
    expect(result).toBe(sampleSummary);
  });

  it('allows clearing optional metadata when updating', async () => {
    repository.findById.mockResolvedValue(sampleSummary);
    repository.updateSecret.mockResolvedValue(sampleSummary);

    await service.updateSecret(authContext, 'secret-1', {
      name: 'database-password',
      description: null,
      tags: [],
    });

    expect(repository.updateSecret).toHaveBeenCalledWith(
      'secret-1',
      {
        name: 'database-password',
        description: null,
        tags: null,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID },
    );
  });

  it('returns the existing secret when no updates are provided', async () => {
    repository.findById.mockResolvedValue(sampleSummary);

    const updated = await service.updateSecret(authContext, 'secret-1', {});

    expect(updated).toBe(sampleSummary);
    expect(repository.findById).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('deletes a secret via the repository', async () => {
    await service.deleteSecret(authContext, 'secret-1');
    expect(repository.deleteSecret).toHaveBeenCalledWith('secret-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });
});
