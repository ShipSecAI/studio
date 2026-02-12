import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const integrationTokens = pgTable(
  'integration_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    credentialType: varchar('credential_type', { length: 32 }).notNull().default('oauth'),
    displayName: varchar('display_name', { length: 191 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    accessToken: jsonb('access_token')
      .$type<{
        ciphertext: string;
        iv: string;
        authTag: string;
        keyId: string;
      }>()
      .notNull(),
    refreshToken: jsonb('refresh_token')
      .$type<{
        ciphertext: string;
        iv: string;
        authTag: string;
        keyId: string;
      } | null>()
      .default(null),
    tokenType: varchar('token_type', { length: 32 }).default('Bearer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastValidationStatus: varchar('last_validation_status', { length: 16 }),
    lastValidationError: text('last_validation_error'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('integration_tokens_user_idx').on(table.userId),
    orgIdx: index('integration_tokens_org_idx').on(table.organizationId),
    orgProviderTypeNameUnique: uniqueIndex('integration_tokens_org_provider_type_name_uidx').on(
      table.organizationId,
      table.provider,
      table.credentialType,
      table.displayName,
    ),
  }),
);

export const integrationOAuthStates = pgTable(
  'integration_oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    state: text('state').notNull(),
    userId: varchar('user_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }),
    codeVerifier: text('code_verifier'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stateIdx: uniqueIndex('integration_oauth_states_state_uidx').on(table.state),
  }),
);

export const integrationProviderConfigs = pgTable('integration_provider_configs', {
  provider: varchar('provider', { length: 64 }).primaryKey(),
  clientId: varchar('client_id', { length: 191 }).notNull(),
  clientSecret: jsonb('client_secret')
    .$type<{
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    }>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type IntegrationTokenRecord = typeof integrationTokens.$inferSelect;
export type NewIntegrationTokenRecord = typeof integrationTokens.$inferInsert;
export type IntegrationOAuthStateRecord = typeof integrationOAuthStates.$inferSelect;
export type IntegrationProviderConfigRecord = typeof integrationProviderConfigs.$inferSelect;
