import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { secrets, secretVersions, type NewSecret, type NewSecretVersion } from '../database/schema';

export interface SecretSummary {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  activeVersion?: {
    id: string;
    version: number;
    createdAt: Date;
    createdBy?: string | null;
  } | null;
}

export interface SecretValueRecord {
  secretId: string;
  version: number;
  encryptedValue: string;
  iv: string;
  authTag: string;
  encryptionKeyId: string;
}

export interface SecretUpdateData {
  name?: string;
  description?: string | null;
  tags?: string[] | null;
}

@Injectable()
export class SecretsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listSecrets(): Promise<SecretSummary[]> {
    const rows = await this.db
      .select({
        id: secrets.id,
        name: secrets.name,
        description: secrets.description,
        tags: secrets.tags,
        createdAt: secrets.createdAt,
        updatedAt: secrets.updatedAt,
        versionId: secretVersions.id,
        version: secretVersions.version,
        versionCreatedAt: secretVersions.createdAt,
        versionCreatedBy: secretVersions.createdBy,
      })
      .from(secrets)
      .leftJoin(
        secretVersions,
        and(eq(secretVersions.secretId, secrets.id), eq(secretVersions.isActive, true)),
      )
      .orderBy(secrets.name);

    return rows.map((row) => this.mapSummary(row));
  }

  async findById(secretId: string): Promise<SecretSummary> {
    const rows = await this.db
      .select({
        id: secrets.id,
        name: secrets.name,
        description: secrets.description,
        tags: secrets.tags,
        createdAt: secrets.createdAt,
        updatedAt: secrets.updatedAt,
        versionId: secretVersions.id,
        version: secretVersions.version,
        versionCreatedAt: secretVersions.createdAt,
        versionCreatedBy: secretVersions.createdBy,
      })
      .from(secrets)
      .leftJoin(
        secretVersions,
        and(eq(secretVersions.secretId, secrets.id), eq(secretVersions.isActive, true)),
      )
      .where(eq(secrets.id, secretId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Secret ${secretId} not found`);
    }

    return this.mapSummary(row);
  }

  async findValueBySecretId(secretId: string, version?: number): Promise<SecretValueRecord> {
    let condition = eq(secretVersions.secretId, secretId);

    if (typeof version === 'number') {
      condition = and(condition, eq(secretVersions.version, version));
    } else {
      condition = and(condition, eq(secretVersions.isActive, true));
    }

    const rows = await this.db
      .select({
        secretId: secretVersions.secretId,
        version: secretVersions.version,
        encryptedValue: secretVersions.encryptedValue,
        iv: secretVersions.iv,
        authTag: secretVersions.authTag,
        encryptionKeyId: secretVersions.encryptionKeyId,
      })
      .from(secretVersions)
      .where(condition)
      .limit(1);

    const record = rows[0];
    if (!record) {
      throw new NotFoundException('Secret value not found');
    }

    return record;
  }

  async createSecret(
    secretData: Omit<NewSecret, 'id' | 'createdAt' | 'updatedAt'>,
    versionData: Omit<NewSecretVersion, 'id' | 'secretId' | 'version' | 'createdAt' | 'isActive'>,
  ): Promise<SecretSummary> {
    try {
      return await this.db.transaction(async (tx) => {
        const [secret] = await tx.insert(secrets).values(secretData).returning();

        const newVersionNumber = 1;

        const [insertedVersion] = await tx
          .insert(secretVersions)
          .values({
            ...versionData,
            secretId: secret.id,
            version: newVersionNumber,
            isActive: true,
          })
          .returning();

        const [updatedSecret] = await tx
          .update(secrets)
          .set({ updatedAt: sql`now()` })
          .where(eq(secrets.id, secret.id))
          .returning();

        return this.mapSummary({
          id: updatedSecret.id,
          name: updatedSecret.name,
          description: updatedSecret.description,
          tags: updatedSecret.tags,
          createdAt: updatedSecret.createdAt,
          updatedAt: updatedSecret.updatedAt,
          versionId: insertedVersion.id,
          version: insertedVersion.version,
          versionCreatedAt: insertedVersion.createdAt,
          versionCreatedBy: insertedVersion.createdBy,
        });
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`Secret name '${secretData.name}' already exists`);
      }
      throw error;
    }
  }

  async rotateSecret(
    secretId: string,
    versionData: Omit<NewSecretVersion, 'secretId' | 'version' | 'createdAt' | 'isActive'>,
  ): Promise<SecretSummary> {
    return this.db.transaction(async (tx) => {
      const [secret] = await tx.select().from(secrets).where(eq(secrets.id, secretId)).limit(1);

      if (!secret) {
        throw new NotFoundException(`Secret ${secretId} not found`);
      }

      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number>`COALESCE(max(${secretVersions.version}), 0)` })
        .from(secretVersions)
        .where(eq(secretVersions.secretId, secretId));

      const newVersionNumber = (maxVersion ?? 0) + 1;

      await tx
        .update(secretVersions)
        .set({ isActive: false })
        .where(eq(secretVersions.secretId, secretId));

      const [insertedVersion] = await tx
        .insert(secretVersions)
        .values({
          ...versionData,
          secretId,
          version: newVersionNumber,
          isActive: true,
        })
        .returning();

      const [updatedSecret] = await tx
        .update(secrets)
        .set({ updatedAt: sql`now()` })
        .where(eq(secrets.id, secretId))
        .returning();

      return this.mapSummary({
        id: updatedSecret.id,
        name: updatedSecret.name,
        description: updatedSecret.description,
        tags: updatedSecret.tags,
        createdAt: updatedSecret.createdAt,
        updatedAt: updatedSecret.updatedAt,
        versionId: insertedVersion.id,
        version: insertedVersion.version,
        versionCreatedAt: insertedVersion.createdAt,
        versionCreatedBy: insertedVersion.createdBy,
      });
    });
  }

  async updateSecret(secretId: string, updates: SecretUpdateData): Promise<SecretSummary> {
    await this.ensureSecretExists(secretId);

    const updatePayload: Partial<Omit<NewSecret, 'id' | 'createdAt' | 'updatedAt'>> = {};

    if (updates.name !== undefined) {
      updatePayload.name = updates.name;
    }

    if (updates.description !== undefined) {
      updatePayload.description = updates.description;
    }

    if (updates.tags !== undefined) {
      updatePayload.tags = updates.tags;
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.findById(secretId);
    }

    try {
      await this.db
        .update(secrets)
        .set({
          ...updatePayload,
          updatedAt: sql`now()`,
        })
        .where(eq(secrets.id, secretId));
    } catch (error: any) {
      if (error?.code === '23505' && updates.name) {
        throw new ConflictException(`Secret name '${updates.name}' already exists`);
      }
      throw error;
    }

    return this.findById(secretId);
  }

  async deleteSecret(secretId: string): Promise<void> {
    const deleted = await this.db
      .delete(secrets)
      .where(eq(secrets.id, secretId))
      .returning({ id: secrets.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Secret ${secretId} not found`);
    }
  }

  private mapSummary(row: {
    id: string;
    name: string;
    description: string | null;
    tags: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    versionId: string | null;
    version: number | null;
    versionCreatedAt: Date | null;
    versionCreatedBy: string | null;
  }): SecretSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      activeVersion:
        row.versionId && row.version
          ? {
              id: row.versionId,
              version: row.version,
              createdAt: row.versionCreatedAt ?? row.updatedAt,
              createdBy: row.versionCreatedBy,
            }
          : null,
    };
  }

  private async ensureSecretExists(secretId: string): Promise<void> {
    const rows = await this.db.select({ id: secrets.id }).from(secrets).where(eq(secrets.id, secretId)).limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Secret ${secretId} not found`);
    }
  }
}
