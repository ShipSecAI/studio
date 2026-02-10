import { Injectable } from '@nestjs/common';

import { BadRequestException } from '@nestjs/common';

import { SecretsEncryptionService } from './secrets.encryption';
import { SecretsRepository, type SecretSummary, type SecretUpdateData } from './secrets.repository';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import { AuditLogService } from '../audit/audit-log.service';

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
    private readonly auditLogService: AuditLogService,
  ) {}

  private resolveOrganizationId(auth: AuthContext | null): string {
    return auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  }

  private assertOrganizationId(auth: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return organizationId;
  }

  async listSecrets(auth: AuthContext | null): Promise<SecretSummary[]> {
    const organizationId = this.assertOrganizationId(auth);
    return this.repository.listSecrets({ organizationId });
  }

  async getSecret(auth: AuthContext | null, secretId: string): Promise<SecretSummary> {
    const organizationId = this.assertOrganizationId(auth);
    return this.repository.findById(secretId, { organizationId });
  }

  async getSecretByName(auth: AuthContext | null, secretName: string): Promise<SecretSummary> {
    const organizationId = this.assertOrganizationId(auth);
    return this.repository.findByName(secretName, { organizationId });
  }

  async createSecret(auth: AuthContext | null, input: CreateSecretInput): Promise<SecretSummary> {
    const organizationId = this.assertOrganizationId(auth);
    const material = await this.encryption.encrypt(input.value);

    const created = await this.repository.createSecret(
      {
        name: input.name,
        description: input.description ?? null,
        tags: input.tags ?? null,
        organizationId,
      },
      {
        encryptedValue: material.ciphertext,
        iv: material.iv,
        authTag: material.authTag,
        encryptionKeyId: material.keyId,
        createdBy: input.createdBy ?? null,
        organizationId,
      },
    );

    this.auditLogService.record(auth, {
      action: 'secret.create',
      resourceType: 'secret',
      resourceId: created.id,
      resourceName: created.name,
    });

    return created;
  }

  async rotateSecret(
    auth: AuthContext | null,
    secretId: string,
    input: RotateSecretInput,
  ): Promise<SecretSummary> {
    const organizationId = this.assertOrganizationId(auth);
    const material = await this.encryption.encrypt(input.value);

    const rotated = await this.repository.rotateSecret(
      secretId,
      {
        encryptedValue: material.ciphertext,
        iv: material.iv,
        authTag: material.authTag,
        encryptionKeyId: material.keyId,
        createdBy: input.createdBy ?? null,
        organizationId,
      },
      { organizationId },
    );

    this.auditLogService.record(auth, {
      action: 'secret.rotate',
      resourceType: 'secret',
      resourceId: rotated.id,
      resourceName: rotated.name,
    });

    return rotated;
  }

  private async getSecretValueInternal(
    auth: AuthContext | null,
    secretId: string,
    version?: number,
    resourceName?: string | null,
  ): Promise<SecretValue> {
    const organizationId = this.assertOrganizationId(auth);
    const record = await this.repository.findValueBySecretId(secretId, version, { organizationId });

    this.auditLogService.record(auth, {
      action: 'secret.access',
      resourceType: 'secret',
      resourceId: record.secretId,
      resourceName: resourceName ?? null,
      metadata: {
        requestedVersion: version ?? null,
        resolvedVersion: record.version,
      },
    });

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

  async getSecretValue(
    auth: AuthContext | null,
    secretId: string,
    version?: number,
  ): Promise<SecretValue> {
    return this.getSecretValueInternal(auth, secretId, version, null);
  }

  async getSecretValueByName(
    auth: AuthContext | null,
    secretName: string,
    version?: number,
  ): Promise<SecretValue> {
    // First find the secret by name to get its ID
    const organizationId = this.assertOrganizationId(auth);
    const secret = await this.repository.findByName(secretName, { organizationId });
    // Then get the value using the ID
    return this.getSecretValueInternal(auth, secret.id, version, secret.name);
  }

  async updateSecret(
    auth: AuthContext | null,
    secretId: string,
    input: UpdateSecretInput,
  ): Promise<SecretSummary> {
    const organizationId = this.assertOrganizationId(auth);
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
        const normalizedTags = input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        updates.tags = normalizedTags.length > 0 ? normalizedTags : null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.repository.findById(secretId, { organizationId });
    }

    const updated = await this.repository.updateSecret(secretId, updates, { organizationId });
    this.auditLogService.record(auth, {
      action: 'secret.update',
      resourceType: 'secret',
      resourceId: updated.id,
      resourceName: updated.name,
      metadata: {
        updatedFields: Object.keys(updates),
      },
    });
    return updated;
  }

  async deleteSecret(auth: AuthContext | null, secretId: string): Promise<void> {
    const organizationId = this.assertOrganizationId(auth);
    let existing: SecretSummary | null = null;
    try {
      existing = await this.repository.findById(secretId, { organizationId });
    } catch {
      existing = null;
    }
    await this.repository.deleteSecret(secretId, { organizationId });
    this.auditLogService.record(auth, {
      action: 'secret.delete',
      resourceType: 'secret',
      resourceId: secretId,
      resourceName: (existing as any)?.name ?? null,
    });
  }
}
