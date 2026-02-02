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
} from 'drizzle-orm/pg-core';

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
    transportType: varchar('transport_type', { length: 32 }).notNull(), // 'http' | 'stdio' | 'sse' | 'websocket'
    endpoint: text('endpoint'), // URL for http/sse/websocket transports
    command: text('command'), // Command for stdio transport
    args: jsonb('args').$type<string[] | null>().default(null), // Args for stdio command

    // Authentication (encrypted using AES-256-GCM, same pattern as integrations)
    headers: jsonb('headers').$type<{
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    } | null>().default(null),

    // Status and settings
    enabled: boolean('enabled').notNull().default(true),
    healthCheckUrl: text('health_check_url'), // Optional custom health endpoint

    // Health tracking
    lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
    lastHealthStatus: varchar('last_health_status', { length: 32 }), // 'healthy' | 'unhealthy' | 'unknown'

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
    nameOrgUnique: uniqueIndex('mcp_servers_name_org_uidx').on(table.name, table.organizationId),
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
export type McpServerRecord = typeof mcpServers.$inferSelect;
export type NewMcpServerRecord = typeof mcpServers.$inferInsert;

export type McpServerToolRecord = typeof mcpServerTools.$inferSelect;
export type NewMcpServerToolRecord = typeof mcpServerTools.$inferInsert;
