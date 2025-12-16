import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export interface ApiKeyPermissions {
  workflows: {
    run: boolean;
    list: boolean;
    read: boolean;
  };
  runs: {
    read: boolean;
    cancel: boolean;
  };
}

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),

    // The hashed API key (never store plaintext)
    keyHash: text('key_hash').notNull().unique(),

    // Prefix for key identification (e.g., "sk_live_")
    keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),

    // Last 4 characters for display purposes
    keyHint: varchar('key_hint', { length: 8 }).notNull(),

    // Permissions and scoping
    permissions: jsonb('permissions').$type<ApiKeyPermissions>().notNull(),
    scopes: jsonb('scopes').$type<string[]>().default([]),

    // Organization scoping
    organizationId: varchar('organization_id', { length: 191 }).notNull(),

    // Ownership
    createdBy: varchar('created_by', { length: 191 }).notNull(),

    // Status
    isActive: boolean('is_active').notNull().default(true),

    // Expiration
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Usage tracking
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').notNull().default(0),

    // Rate limiting
    rateLimit: integer('rate_limit'), // requests per minute

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('api_keys_org_idx').on(table.organizationId),
    activeIdx: index('api_keys_active_idx').on(table.isActive, table.organizationId),
    createdByIdx: index('api_keys_created_by_idx').on(table.createdBy),
    keyHashIdx: index('api_keys_hash_idx').on(table.keyHash),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
