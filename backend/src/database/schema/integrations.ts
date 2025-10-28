import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from 'drizzle-orm/pg-core';

export const integrationTokens = pgTable(
  'integration_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    accessToken: jsonb('access_token').$type<{
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    }>().notNull(),
    refreshToken: jsonb('refresh_token')
      .$type<
        | {
            ciphertext: string;
            iv: string;
            authTag: string;
            keyId: string;
          }
        | null
      >()
      .default(null),
    tokenType: varchar('token_type', { length: 32 }).default('Bearer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userProviderIdx: index('integration_tokens_user_idx').on(table.userId),
    userProviderUnique: uniqueIndex('integration_tokens_user_provider_uidx').on(
      table.userId,
      table.provider,
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
    codeVerifier: text('code_verifier'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stateIdx: uniqueIndex('integration_oauth_states_state_uidx').on(table.state),
  }),
);

export const integrationProviderConfigs = pgTable(
  'integration_provider_configs',
  {
    provider: varchar('provider', { length: 64 }).primaryKey(),
    clientId: varchar('client_id', { length: 191 }).notNull(),
    clientSecret: jsonb('client_secret').$type<{
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    }>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type IntegrationTokenRecord = typeof integrationTokens.$inferSelect;
export type NewIntegrationTokenRecord = typeof integrationTokens.$inferInsert;
export type IntegrationOAuthStateRecord = typeof integrationOAuthStates.$inferSelect;
export type IntegrationProviderConfigRecord = typeof integrationProviderConfigs.$inferSelect;
