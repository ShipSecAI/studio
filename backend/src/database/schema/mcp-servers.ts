import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * MCP Groups table.
 * Defines logical groupings of MCP servers with shared credentials and configurations.
 * Groups provide a way to bundle servers that work well together (e.g., "GitHub Tools", "Data Analysis").
 */
export const mcpGroups = pgTable(
  'mcp_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 191 }).notNull().unique(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),

    // Credential configuration
    credentialContractName: varchar('credential_contract_name', { length: 191 }).notNull(),
    credentialMapping: jsonb('credential_mapping')
      .$type<Record<string, unknown> | null>()
      .default(null),

    // Default Docker image for servers in this group
    defaultDockerImage: varchar('default_docker_image', { length: 255 }),

    // Template tracking (for seeded groups from templates)
    templateHash: varchar('template_hash', { length: 64 }),

    // Status
    enabled: boolean('enabled').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index('mcp_groups_slug_idx').on(table.slug),
    enabledIdx: index('mcp_groups_enabled_idx').on(table.enabled),
  }),
);

/**
 * MCP Server configurations table.
 * Stores configuration for Model Context Protocol servers that can be used by AI agents.
 */
export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),

    // Transport configuration
    transportType: varchar('transport_type', { length: 32 }).notNull(), // 'http' | 'stdio'
    endpoint: text('endpoint'), // URL for http/sse/websocket transports
    command: text('command'), // Command for stdio transport
    args: jsonb('args').$type<string[] | null>().default(null), // Args for stdio command

    // Authentication (encrypted using AES-256-GCM, same pattern as integrations)
    headers: jsonb('headers')
      .$type<{
        ciphertext: string;
        iv: string;
        authTag: string;
        keyId: string;
      } | null>()
      .default(null),

    // Status and settings
    enabled: boolean('enabled').notNull().default(true),
    healthCheckUrl: text('health_check_url'), // Optional custom health endpoint

    // Health tracking
    lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
    lastHealthStatus: varchar('last_health_status', { length: 32 }), // 'healthy' | 'unhealthy' | 'unknown'

    // Group association (nullable - servers can exist independently)
    groupId: uuid('group_id').references(() => mcpGroups.id, { onDelete: 'set null' }),

    // Multi-tenancy
    organizationId: varchar('organization_id', { length: 191 }),
    createdBy: varchar('created_by', { length: 191 }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('mcp_servers_org_idx').on(table.organizationId),
    enabledIdx: index('mcp_servers_enabled_idx').on(table.enabled),
    groupIdx: index('mcp_servers_group_idx').on(table.groupId),
    nameOrgUnique: uniqueIndex('mcp_servers_name_org_uidx').on(table.name, table.organizationId),
  }),
);

/**
 * MCP Group to Server junction table.
 * Defines which servers belong to which groups, with metadata about recommendations
 * and default selection behavior.
 */
export const mcpGroupServers = pgTable(
  'mcp_group_servers',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => mcpGroups.id, { onDelete: 'cascade' }),
    serverId: uuid('server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),

    // Metadata about the relationship
    recommended: boolean('recommended').notNull().default(false),
    defaultSelected: boolean('default_selected').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.serverId] }),
    groupIdx: index('mcp_group_servers_group_idx').on(table.groupId),
    serverIdx: index('mcp_group_servers_server_idx').on(table.serverId),
  }),
);

/**
 * Cached tool definitions discovered from MCP servers.
 * Tools are discovered via the MCP protocol and cached here for quick lookup.
 */
export const mcpServerTools = pgTable(
  'mcp_server_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    toolName: varchar('tool_name', { length: 191 }).notNull(),
    description: text('description'),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown> | null>().default(null),
    enabled: boolean('enabled').notNull().default(true),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serverIdx: index('mcp_server_tools_server_idx').on(table.serverId),
    serverToolUnique: uniqueIndex('mcp_server_tools_server_tool_uidx').on(
      table.serverId,
      table.toolName,
    ),
  }),
);

// Type exports for use in repositories and services
export type McpGroupRecord = typeof mcpGroups.$inferSelect;
export type NewMcpGroupRecord = typeof mcpGroups.$inferInsert;

export type McpGroupServerRecord = typeof mcpGroupServers.$inferSelect;
export type NewMcpGroupServerRecord = typeof mcpGroupServers.$inferInsert;

export type McpServerRecord = typeof mcpServers.$inferSelect;
export type NewMcpServerRecord = typeof mcpServers.$inferInsert;

export type McpServerToolRecord = typeof mcpServerTools.$inferSelect;
export type NewMcpServerToolRecord = typeof mcpServerTools.$inferInsert;
