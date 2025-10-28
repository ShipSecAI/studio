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
  scopes: string[];
  accessToken: SecretEncryptionMaterial;
  refreshToken: SecretEncryptionMaterial | null;
  tokenType: string;
  expiresAt?: Date | null;
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

  async findByProvider(userId: string, provider: string): Promise<IntegrationTokenRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(integrationTokens)
      .where(
        and(
          eq(integrationTokens.userId, userId),
          eq(integrationTokens.provider, provider),
        ),
      )
      .limit(1);
    return record;
  }

  async upsertConnection(input: UpsertIntegrationTokenInput): Promise<IntegrationTokenRecord> {
    const payload = {
      userId: input.userId,
      provider: input.provider,
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
        target: [integrationTokens.userId, integrationTokens.provider],
        set: payload,
      })
      .returning();

    return record;
  }

  async deleteConnection(id: string, userId: string): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(
        and(eq(integrationTokens.id, id), eq(integrationTokens.userId, userId)),
      );
  }

  async deleteByProvider(userId: string, provider: string): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(
        and(
          eq(integrationTokens.userId, userId),
          eq(integrationTokens.provider, provider),
        ),
      );
  }

  async createOAuthState(payload: {
    state: string;
    userId: string;
    provider: string;
    codeVerifier?: string | null;
  }): Promise<IntegrationOAuthStateRecord> {
    const [record] = await this.db
      .insert(integrationOAuthStates)
      .values({
        state: payload.state,
        userId: payload.userId,
        provider: payload.provider,
        codeVerifier: payload.codeVerifier ?? null,
      })
      .onConflictDoUpdate({
        target: integrationOAuthStates.state,
        set: {
          userId: payload.userId,
          provider: payload.provider,
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

    await this.db
      .delete(integrationOAuthStates)
      .where(eq(integrationOAuthStates.id, record.id));

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
