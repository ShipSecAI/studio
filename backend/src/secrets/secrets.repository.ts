import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { secrets, secretVersions, type NewSecret, type NewSecretVersion } from '../database/schema';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

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

export interface SecretQueryOptions {
  organizationId?: string | null;
}

@Injectable()
export class SecretsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listSecrets(options: SecretQueryOptions = {}): Promise<SecretSummary[]> {
    const baseQuery = this.db
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
      );

    const conditions: SQL[] = [];
    if (options.organizationId) {
      conditions.push(eq(secrets.organizationId, options.organizationId));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery).orderBy(
      secrets.name,
    );

    return rows.map((row) => this.mapSummary(row));
  }

  async findByName(secretName: string, options: SecretQueryOptions = {}): Promise<SecretSummary> {
    const conditions: SQL[] = [eq(secrets.name, secretName)];
    if (options.organizationId) {
      conditions.push(eq(secrets.organizationId, options.organizationId));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

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
      .where(whereClause)
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Secret with name '${secretName}' not found`);
    }

    return this.mapSummary(row);
  }

  async findById(secretId: string, options: SecretQueryOptions = {}): Promise<SecretSummary> {
    const conditions: SQL[] = [eq(secrets.id, secretId)];
    if (options.organizationId) {
      conditions.push(eq(secrets.organizationId, options.organizationId));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

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
      .where(whereClause)
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Secret ${secretId} not found`);
    }

    return this.mapSummary(row);
  }

  async findValueBySecretId(
    secretId: string,
    version?: number,
    options: SecretQueryOptions = {},
  ): Promise<SecretValueRecord> {
    const conditions: SQL[] = [eq(secretVersions.secretId, secretId)];

    if (typeof version === 'number') {
      conditions.push(eq(secretVersions.version, version));
    } else {
      conditions.push(eq(secretVersions.isActive, true));
    }

    if (options.organizationId) {
      conditions.push(eq(secretVersions.organizationId, options.organizationId));
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
      .where(and(...conditions))
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
        const [secret] = await tx
          .insert(secrets)
          .values({
            ...secretData,
            organizationId: secretData.organizationId ?? DEFAULT_ORGANIZATION_ID,
          })
          .returning();

        const newVersionNumber = 1;

        const [insertedVersion] = await tx
          .insert(secretVersions)
          .values({
            ...versionData,
            secretId: secret.id,
            version: newVersionNumber,
            isActive: true,
            organizationId:
              versionData.organizationId ?? secret.organizationId ?? DEFAULT_ORGANIZATION_ID,
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
    options: SecretQueryOptions = {},
  ): Promise<SecretSummary> {
    return this.db.transaction(async (tx) => {
      const orgId = options.organizationId ?? DEFAULT_ORGANIZATION_ID;
      const [secret] = await tx
        .select()
        .from(secrets)
        .where(and(eq(secrets.id, secretId), eq(secrets.organizationId, orgId)))
        .limit(1);

      if (!secret) {
        throw new NotFoundException(`Secret ${secretId} not found`);
      }

      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number>`COALESCE(max(${secretVersions.version}), 0)` })
        .from(secretVersions)
        .where(
          and(eq(secretVersions.secretId, secretId), eq(secretVersions.organizationId, orgId)),
        );

      const newVersionNumber = (maxVersion ?? 0) + 1;

      await tx
        .update(secretVersions)
        .set({ isActive: false })
        .where(
          and(eq(secretVersions.secretId, secretId), eq(secretVersions.organizationId, orgId)),
        );

      const [insertedVersion] = await tx
        .insert(secretVersions)
        .values({
          ...versionData,
          secretId,
          version: newVersionNumber,
          isActive: true,
          organizationId: versionData.organizationId ?? orgId,
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

  async updateSecret(
    secretId: string,
    updates: SecretUpdateData,
    options: SecretQueryOptions = {},
  ): Promise<SecretSummary> {
    await this.ensureSecretExists(secretId, options);

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
      return this.findById(secretId, options);
    }

    try {
      const conditions: SQL[] = [eq(secrets.id, secretId)];
      if (options.organizationId) {
        conditions.push(eq(secrets.organizationId, options.organizationId));
      }

      await this.db
        .update(secrets)
        .set({
          ...updatePayload,
          updatedAt: sql`now()`,
        })
        .where(and(...conditions));
    } catch (error: any) {
      if (error?.code === '23505' && updates.name) {
        throw new ConflictException(`Secret name '${updates.name}' already exists`);
      }
      throw error;
    }

    return this.findById(secretId, options);
  }

  async deleteSecret(secretId: string, options: SecretQueryOptions = {}): Promise<void> {
    const conditions: SQL[] = [eq(secrets.id, secretId)];
    if (options.organizationId) {
      conditions.push(eq(secrets.organizationId, options.organizationId));
    }

    const deleted = await this.db
      .delete(secrets)
      .where(and(...conditions))
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

  private async ensureSecretExists(
    secretId: string,
    options: SecretQueryOptions = {},
  ): Promise<void> {
    const conditions: SQL[] = [eq(secrets.id, secretId)];
    if (options.organizationId) {
      conditions.push(eq(secrets.organizationId, options.organizationId));
    }
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const rows = await this.db.select({ id: secrets.id }).from(secrets).where(whereClause).limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Secret ${secretId} not found`);
    }
  }
}
