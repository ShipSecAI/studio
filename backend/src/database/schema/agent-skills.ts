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
 * Agent Skills table.
 * Stores skill definitions (SKILL.md content) that can be injected into AI agents
 * to extend their capabilities with domain-specific knowledge and instructions.
 */
export const agentSkills = pgTable(
  'agent_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Multi-tenancy
    organizationId: varchar('organization_id', { length: 191 }),

    // Identity
    name: varchar('name', { length: 64 }).notNull(),
    description: text('description').notNull(),

    // Skill content (the SKILL.md body after frontmatter)
    content: text('content').notNull(),

    // Optional metadata
    license: varchar('license', { length: 191 }),
    compatibility: varchar('compatibility', { length: 500 }),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>().default(null),
    allowedTools: varchar('allowed_tools', { length: 1000 }),

    // Status
    isEnabled: boolean('is_enabled').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('agent_skills_org_idx').on(table.organizationId),
    enabledIdx: index('agent_skills_enabled_idx').on(table.isEnabled),
    nameOrgUnique: uniqueIndex('agent_skills_name_org_uidx').on(table.name, table.organizationId),
  }),
);

// Type exports for use in repositories and services
export type AgentSkillRecord = typeof agentSkills.$inferSelect;
export type NewAgentSkillRecord = typeof agentSkills.$inferInsert;
