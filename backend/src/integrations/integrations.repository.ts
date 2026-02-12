import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SecretEncryptionMaterial } from '@shipsec/shared';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  integrationTokens,
  integrationOAuthStates,
  integrationProviderConfigs,
  type IntegrationTokenRecord,
  type IntegrationOAuthStateRecord,
  type IntegrationProviderConfigRecord,
} from '../database/schema';

interface UpsertIntegrationTokenInput {
  userId: string;
  provider: string;
  organizationId: string;
  credentialType: string;
  displayName: string;
  scopes: string[];
  accessToken: SecretEncryptionMaterial;
  refreshToken: SecretEncryptionMaterial | null;
  tokenType: string;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

interface InsertConnectionInput {
  userId: string;
  provider: string;
  organizationId: string;
  credentialType: string;
  displayName: string;
  scopes?: string[];
  accessToken: SecretEncryptionMaterial;
  refreshToken?: SecretEncryptionMaterial | null;
  tokenType?: string;
  expiresAt?: Date | null;
  lastValidatedAt?: Date | null;
  lastValidationStatus?: string | null;
  lastValidationError?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IntegrationsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listConnections(userId: string): Promise<IntegrationTokenRecord[]> {
    return await this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.userId, userId))
      .orderBy(integrationTokens.provider);
  }

  async findById(id: string): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.id, id))
      .limit(1);
    return record;
  }

  async findByUserAndProvider(
    userId: string,
    provider: string,
  ): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(and(eq(integrationTokens.userId, userId), eq(integrationTokens.provider, provider)))
      .limit(1);
    return record;
  }

  async findByOrgAndProvider(
    organizationId: string,
    provider: string,
  ): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(
        and(
          eq(integrationTokens.organizationId, organizationId),
          eq(integrationTokens.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async listConnectionsByOrg(
    organizationId: string,
    provider?: string,
  ): Promise<IntegrationTokenRecord[]> {
    const conditions = [eq(integrationTokens.organizationId, organizationId)];
    if (provider) {
      conditions.push(eq(integrationTokens.provider, provider));
    }
    return await this.db
      .select()
      .from(integrationTokens)
      .where(and(...conditions))
      .orderBy(integrationTokens.provider);
  }

  async upsertConnection(input: UpsertIntegrationTokenInput): Promise<IntegrationTokenRecord> {
    const payload = {
      userId: input.userId,
      provider: input.provider,
      organizationId: input.organizationId,
      credentialType: input.credentialType,
      displayName: input.displayName,
      scopes: input.scopes,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenType: input.tokenType,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    };

    const [record] = await this.db
      .insert(integrationTokens)
      .values({
        ...payload,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          integrationTokens.organizationId,
          integrationTokens.provider,
          integrationTokens.credentialType,
          integrationTokens.displayName,
        ],
        set: payload,
      })
      .returning();

    return record;
  }

  /**
   * Insert a new connection (no upsert). For non-OAuth connection types.
   * On unique constraint violation, catches the error and returns the existing connection (D12).
   */
  async insertConnection(input: InsertConnectionInput): Promise<IntegrationTokenRecord> {
    try {
      const [record] = await this.db
        .insert(integrationTokens)
        .values({
          userId: input.userId,
          provider: input.provider,
          organizationId: input.organizationId,
          credentialType: input.credentialType,
          displayName: input.displayName,
          scopes: input.scopes ?? [],
          accessToken: input.accessToken,
          refreshToken: input.refreshToken ?? null,
          tokenType: input.tokenType ?? 'Bearer',
          expiresAt: input.expiresAt ?? null,
          lastValidatedAt: input.lastValidatedAt ?? null,
          lastValidationStatus: input.lastValidationStatus ?? null,
          lastValidationError: input.lastValidationError ?? null,
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return record;
    } catch (error: any) {
      // Unique constraint violation — return existing connection (D12 natural idempotency)
      if (error?.code === '23505') {
        const existing = await this.db
          .select()
          .from(integrationTokens)
          .where(
            and(
              eq(integrationTokens.organizationId, input.organizationId),
              eq(integrationTokens.provider, input.provider),
              eq(integrationTokens.credentialType, input.credentialType),
              eq(integrationTokens.displayName, input.displayName),
            ),
          )
          .limit(1);

        if (existing[0]) {
          return existing[0];
        }
      }
      throw error;
    }
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.delete(integrationTokens).where(eq(integrationTokens.id, id));
  }

  async deleteByProvider(userId: string, provider: string): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(and(eq(integrationTokens.userId, userId), eq(integrationTokens.provider, provider)));
  }

  async updateConnectionHealth(
    id: string,
    health: {
      lastValidatedAt: Date;
      lastValidationStatus: string;
      lastValidationError?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const setClause: Record<string, any> = {
      lastValidatedAt: health.lastValidatedAt,
      lastValidationStatus: health.lastValidationStatus,
      lastValidationError: health.lastValidationError ?? null,
      updatedAt: new Date(),
    };
    if (health.metadata) {
      setClause.metadata = health.metadata;
    }
    await this.db.update(integrationTokens).set(setClause).where(eq(integrationTokens.id, id));
  }

  async updateLastUsedAt(id: string): Promise<void> {
    await this.db
      .update(integrationTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(integrationTokens.id, id));
  }

  async createOAuthState(payload: {
    state: string;
    userId: string;
    provider: string;
    organizationId?: string | null;
    codeVerifier?: string | null;
  }): Promise<IntegrationOAuthStateRecord> {
    const [record] = await this.db
      .insert(integrationOAuthStates)
      .values({
        state: payload.state,
        userId: payload.userId,
        provider: payload.provider,
        organizationId: payload.organizationId ?? null,
        codeVerifier: payload.codeVerifier ?? null,
      })
      .onConflictDoUpdate({
        target: integrationOAuthStates.state,
        set: {
          userId: payload.userId,
          provider: payload.provider,
          organizationId: payload.organizationId ?? null,
          codeVerifier: payload.codeVerifier ?? null,
          createdAt: new Date(),
        },
      })
      .returning();

    return record;
  }

  async consumeOAuthState(state: string): Promise<IntegrationOAuthStateRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationOAuthStates)
      .where(eq(integrationOAuthStates.state, state))
      .limit(1);

    if (!record) {
      return undefined;
    }

    await this.db.delete(integrationOAuthStates).where(eq(integrationOAuthStates.id, record.id));

    return record;
  }

  async upsertProviderConfig(input: {
    provider: string;
    clientId: string;
    clientSecret: SecretEncryptionMaterial;
  }): Promise<IntegrationProviderConfigRecord> {
    const payload = {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      updatedAt: new Date(),
    };

    const [record] = await this.db
      .insert(integrationProviderConfigs)
      .values({
        provider: input.provider,
        ...payload,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: integrationProviderConfigs.provider,
        set: payload,
      })
      .returning();

    return record;
  }

  async findProviderConfig(provider: string): Promise<IntegrationProviderConfigRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationProviderConfigs)
      .where(eq(integrationProviderConfigs.provider, provider))
      .limit(1);

    return record;
  }

  async listProviderConfigs(): Promise<IntegrationProviderConfigRecord[]> {
    return await this.db.select().from(integrationProviderConfigs);
  }

  async deleteProviderConfig(provider: string): Promise<void> {
    await this.db
      .delete(integrationProviderConfigs)
      .where(eq(integrationProviderConfigs.provider, provider));
  }
}
