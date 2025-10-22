import { Injectable } from '@nestjs/common';

import { BadRequestException } from '@nestjs/common';

import { SecretsEncryptionService } from './secrets.encryption';
import { SecretsRepository, type SecretSummary, type SecretUpdateData } from './secrets.repository';

export interface CreateSecretInput {
  name: string;
  description?: string | null;
  tags?: string[] | null;
  value: string;
  createdBy?: string | null;
}

export interface RotateSecretInput {
  value: string;
  createdBy?: string | null;
}

export interface UpdateSecretInput {
  name?: string;
  description?: string | null;
  tags?: string[] | null;
}

export interface SecretValue {
  secretId: string;
  version: number;
  value: string;
}

@Injectable()
export class SecretsService {
  constructor(
    private readonly repository: SecretsRepository,
    private readonly encryption: SecretsEncryptionService,
  ) {}

  async listSecrets(): Promise<SecretSummary[]> {
    return this.repository.listSecrets();
  }

  async getSecret(secretId: string): Promise<SecretSummary> {
    return this.repository.findById(secretId);
  }

  async createSecret(input: CreateSecretInput): Promise<SecretSummary> {
    const material = await this.encryption.encrypt(input.value);

    return this.repository.createSecret(
      {
        name: input.name,
        description: input.description ?? null,
        tags: input.tags ?? null,
      },
      {
        encryptedValue: material.ciphertext,
        iv: material.iv,
        authTag: material.authTag,
        encryptionKeyId: material.keyId,
        createdBy: input.createdBy ?? null,
      },
    );
  }

  async rotateSecret(secretId: string, input: RotateSecretInput): Promise<SecretSummary> {
    const material = await this.encryption.encrypt(input.value);

    return this.repository.rotateSecret(secretId, {
      encryptedValue: material.ciphertext,
      iv: material.iv,
      authTag: material.authTag,
      encryptionKeyId: material.keyId,
      createdBy: input.createdBy ?? null,
    });
  }

  async getSecretValue(secretId: string, version?: number): Promise<SecretValue> {
    const record = await this.repository.findValueBySecretId(secretId, version);
    const value = await this.encryption.decrypt({
      ciphertext: record.encryptedValue,
      iv: record.iv,
      authTag: record.authTag,
      keyId: record.encryptionKeyId,
    });

    return {
      secretId: record.secretId,
      version: record.version,
      value,
    };
  }

  async updateSecret(secretId: string, input: UpdateSecretInput): Promise<SecretSummary> {
    const updates: SecretUpdateData = {};

    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      if (trimmedName.length === 0) {
        throw new BadRequestException('Secret name cannot be empty');
      }
      updates.name = trimmedName;
    }
    if (input.description !== undefined) {
      if (input.description === null) {
        updates.description = null;
      } else {
        const trimmedDescription = input.description.trim();
        updates.description = trimmedDescription.length > 0 ? trimmedDescription : null;
      }
    }
    if (input.tags !== undefined) {
      if (input.tags === null) {
        updates.tags = null;
      } else {
        const normalizedTags = input.tags
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        updates.tags = normalizedTags.length > 0 ? normalizedTags : null;
      }
    }

    return this.repository.updateSecret(secretId, updates);
  }

  async deleteSecret(secretId: string): Promise<void> {
    await this.repository.deleteSecret(secretId);
  }
}
